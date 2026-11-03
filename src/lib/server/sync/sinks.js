import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { contentHash, canonical } from './identity.js';
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

/** @param {any} route @param {any[]} catalog @param {any} schema */
export function validateRoute(route, catalog, schema) {
  if (!['file', 'record', 'both'].includes(route.mode)) throw new Error('Invalid destination mode');
  if (
    route.mode !== 'record' &&
    (!route.folder?.startsWith('/') ||
      route.folder.includes('\\') ||
      /%2e|%2f|%5c/i.test(route.folder) ||
      route.folder.split('/').some(/** @param {string} s */ (s) => s === '..' || s === '.') ||
      route.folder.includes('\0'))
  )
    throw new Error('Invalid destination folder');
  if (route.mode !== 'file') {
    const type = catalog.find(
      (x) => x.id === route.recordType && x.fulcra_userid === route.ownerId
    );
    if (!type) throw new Error('Destination owner mismatch');
    if (!type.queryable) throw new Error('Destination must be queryable for readback');
    if (!type.recordable || type.api_version !== 'v1')
      throw new Error('Destination is not recordable v1');
    if (!schema?.properties?.payload) throw new Error('Destination schema must declare payload');
    ajv.compile(schema);
  }
  return route;
}
/** @param {{record:any,files:any[]}} output @param {any} route @param {any} schema */
export function validateOutput(output, route, schema) {
  if (route.mode !== 'file' && !ajv.validate(schema, output.record))
    throw new Error('Record does not match destination schema');
}
/** @param {{record:any,files:any[]}} output @param {any} route @param {any} client @param {any} schema @param {any[]} existing @param {(receipt:any)=>Promise<any>} onReceipt */
export async function deliver(
  output,
  route,
  client,
  schema,
  existing = [],
  onReceipt = async () => {}
) {
  validateOutput(output, route, schema);
  /** @type {any[]} */ const receipts = [];
  const plans =
    route.mode === 'record'
      ? []
      : output.files.map((file) => {
          if (
            file.path.startsWith('/') ||
            file.path.includes('\\') ||
            file.path.split('/').some((/** @type {string} */ s) => s === '..' || s === '.') ||
            /%2e|%2f|%5c/i.test(file.path)
          )
            throw new Error('Invalid artifact path');
          const path = route.folder.replace(/\/$/, '') + '/' + file.path;
          const previous = existing.find((x) => x.sink === 'file' && x.path === path);
          if (previous && previous.hash !== contentHash(file.content))
            throw new Error(
              'Artifact content changed for a retained revision; reconcile the original delivery before retry'
            );
          return { file, path, previous };
        });
  for (const { file, path, previous } of plans) {
    if (
      previous &&
      ['verified', 'pending'].includes(previous.status) &&
      previous.inputId &&
      !previous.transfer
    ) {
      receipts.push(previous);
      continue;
    }
    const receipt = previous
      ? { ...previous }
      : { sink: 'file', path, hash: contentHash(file.content), status: 'uncertain', inputId: '' };
    await onReceipt(receipt); // Durable intent precedes any remote side effect.
    if (client.findFileByHash) {
      let found;
      try {
        found = await client.findFileByHash(path, receipt.hash);
      } catch {
        receipts.push(receipt);
        continue;
      }
      if (found) {
        receipt.inputId = found.id;
        receipt.status = 'verified';
        delete receipt.transfer;
        await onReceipt(receipt);
        receipts.push(receipt);
        continue;
      }
    }
    if (client.allocateFile && client.transferFile) {
      if (!receipt.transfer) {
        const upload = await client.allocateFile(path, file.content, file.contentType);
        receipt.inputId = upload.file.id;
        receipt.transfer = { url: upload.url };
        receipt.status = 'uncertain';
        await onReceipt(receipt);
      }
      let succeeded = false;
      try {
        await client.transferFile(receipt.transfer, file.content, file.contentType);
        succeeded = true;
      } catch {
        /* Preserve the allocated ID and encrypted URL for reconciliation/resume. */
      }
      if (succeeded) {
        receipt.status = 'pending';
        delete receipt.transfer;
      }
    } else {
      try {
        const upload = await client.uploadFile(path, file.content, file.contentType);
        receipt.inputId = upload.id;
        receipt.status = 'pending';
      } catch {
        receipt.status = 'uncertain';
      }
    }
    receipts.push(receipt);
    await onReceipt(receipt);
  }
  if (route.mode !== 'file') {
    const previous = existing.find((x) => x.sink === 'record' && x.id === output.record.id);
    if (
      previous &&
      (previous.status === 'verified' || (previous.status === 'pending' && previous.uploadId))
    ) {
      receipts.push(previous);
    } else {
      const fields = Object.keys(output.record).filter(
        (key) => !['sources', 'tags', 'start_time', 'end_time'].includes(key)
      );
      const receipt = previous
        ? { ...previous }
        : {
            sink: 'record',
            dataType: route.recordType,
            id: output.record.id,
            fields,
            hash: contentHash(
              canonical(Object.fromEntries(fields.map((key) => [key, output.record[key]])))
            ),
            status: 'uncertain',
            uploadId: ''
          };
      await onReceipt(receipt);
      if (client.readRecord) {
        let record;
        try {
          record = await client.readRecord(receipt.dataType, receipt.id);
        } catch {
          receipts.push(receipt);
          return receipts;
        }
        if (record) {
          receipt.status =
            contentHash(
              canonical(
                Object.fromEntries(
                  receipt.fields.map((/** @type {string} */ key) => [key, record[key]])
                )
              )
            ) === receipt.hash
              ? 'verified'
              : 'failed';
          await onReceipt(receipt);
          receipts.push(receipt);
          return receipts;
        }
        if (previous && previous.status !== 'failed' && (previous.uncertainChecks ?? 0) < 3) {
          receipt.uncertainChecks = (previous.uncertainChecks ?? 0) + 1;
          await onReceipt(receipt);
          receipts.push(receipt);
          return receipts;
        }
      }
      try {
        const upload = await client.writeRecords(route.recordType, [output.record]);
        receipt.uploadId = upload.upload_id;
        receipt.status = 'pending';
      } catch {
        receipt.status = 'uncertain';
      }
      receipts.push(receipt);
      await onReceipt(receipt);
    }
  }
  return receipts;
}
/** @param {any} receipt @param {any} client */
export async function verify(receipt, client) {
  if (receipt.sink === 'file') {
    if (!receipt.inputId) return 'pending';
    const bytes = await client.readFileBytes(receipt.inputId);
    return contentHash(bytes) === receipt.hash ? 'verified' : 'failed';
  }
  const record = await client.readRecord(receipt.dataType, receipt.id);
  if (!record) return 'pending';
  const sourceContent = Object.fromEntries(
    receipt.fields.map(/** @param {string} key */ (key) => [key, record[key]])
  );
  return contentHash(canonical(sourceContent)) === receipt.hash ? 'verified' : 'failed';
}
