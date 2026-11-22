import { workingFolder } from './notion-sync/state.js';
import { MAX_SELECTED_SOURCES } from '../connectors/setup.js';
import { canonical, contentHash } from './sync/identity.js';
import { prepareOutput } from './sync/runner.js';
import { unseal } from './secrets.js';
const ATTIO_UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
/** @param {any} value */
function configurationObject(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}
/** @param {any} input @param {string[]} resources */
function attioConfiguration(input, resources) {
  if (
    !configurationObject(input) ||
    Object.keys(input).length !== 3 ||
    Object.keys(input).some(
      (key) => !['twoWay', 'includeNotes', 'writableAttributes'].includes(key)
    ) ||
    typeof input.twoWay !== 'boolean' ||
    typeof input.includeNotes !== 'boolean' ||
    !configurationObject(input.writableAttributes)
  )
    throw Error('Invalid Attio configuration');
  const selectedObjects = new Set(resources.map((id) => id.split(':')[0]));
  const writableAttributes = /** @type {Record<string,string[]>} */ ({});
  for (const objectId of Object.keys(input.writableAttributes).sort()) {
    const attributes = input.writableAttributes[objectId];
    if (
      !ATTIO_UUID.test(objectId) ||
      !selectedObjects.has(objectId) ||
      !Array.isArray(attributes) ||
      attributes.length > 32 ||
      new Set(attributes).size !== attributes.length ||
      Array.from(attributes).some((id) => typeof id !== 'string' || !ATTIO_UUID.test(id))
    )
      throw Error('Invalid Attio selected object or writable attribute UUIDs');
    writableAttributes[objectId] = [...attributes].sort();
  }
  if (!input.twoWay && Object.keys(writableAttributes).length)
    throw Error('One-way Attio configuration cannot select writable attributes');
  return { twoWay: input.twoWay, includeNotes: input.includeNotes, writableAttributes };
}
/** Only this allowlist is persisted as non-secret configuration.
 * @param {any} input @param {string[]} discovered @param {string} ownerId @param {string} connector */
export function validateConfig(input, discovered, ownerId, connector = '') {
  if (
    !configurationObject(input) ||
    Object.keys(input).some(
      (k) =>
        ![
          'resources',
          'backfillSince',
          'intervalSeconds',
          'route',
          'routeVersion',
          'twoWay',
          ...(connector === 'attio' ? ['attio'] : [])
        ].includes(k)
    )
  )
    throw new Error('Invalid configuration fields');
  if (
    !Array.isArray(input.resources) ||
    input.resources.length < 1 ||
    input.resources.some(
      (/** @type {any} */ id) => typeof id !== 'string' || !discovered.includes(id)
    )
  )
    throw new Error('Select discovered sources');
  const maximumSources = connector === 'attio' ? 1000 : MAX_SELECTED_SOURCES;
  if (input.resources.length > maximumSources)
    throw new Error(`Select at most ${maximumSources} sources per connection`);
  if (connector === 'attio') {
    if (new Set(input.resources).size !== input.resources.length)
      throw Error('Duplicate Attio selected sources');
    for (const id of input.resources) {
      const parts = id.split(':');
      if (parts.length !== 2 || !parts.every((/** @type {string} */ part) => ATTIO_UUID.test(part)))
        throw Error('Attio resource UUID identity required');
    }
    if (Object.hasOwn(input, 'twoWay'))
      throw Error('Notion two-way configuration is not valid for Attio');
  }
  if (
    !Number.isInteger(input.intervalSeconds) ||
    input.intervalSeconds < 60 ||
    input.intervalSeconds > 86400
  )
    throw new Error('Polling interval must be60–86400 seconds');
  const since = Date.parse(input.backfillSince);
  if (!Number.isFinite(since) || since > Date.now() || since < Date.now() - 366 * 86400000)
    throw new Error('Choose a backfill date within the last year');
  if (
    !input.route ||
    Object.keys(input.route).some((k) => !['mode', 'folder', 'recordType', 'ownerId'].includes(k))
  )
    throw new Error('Invalid destination configuration');
  const attio = Object.hasOwn(input, 'attio')
    ? attioConfiguration(input.attio, input.resources)
    : undefined;
  if (
    attio?.twoWay &&
    (!['file', 'both'].includes(input.route.mode) ||
      typeof input.route.folder !== 'string' ||
      !input.route.folder.trim())
  )
    throw Error('Choose file output and a folder for Attio two-way sync');
  let twoWay;
  if (input.twoWay != null) {
    if (
      Object.keys(input.twoWay).some((k) => !['enabled', 'parentId'].includes(k)) ||
      input.twoWay.enabled !== true
    )
      throw Error('Invalid two-way configuration');
    if (
      typeof input.twoWay.parentId !== 'string' ||
      !input.resources.includes(input.twoWay.parentId) ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(input.twoWay.parentId)
    )
      throw Error('Choose a selected page as the two-way creation parent');
    if (input.route.mode !== 'file') throw Error('Choose file output for two-way sync');
    twoWay = { enabled: true, parentId: input.twoWay.parentId };
  }
  return {
    resources: [...new Set(input.resources)],
    ...(twoWay ? { twoWay } : {}),
    ...(attio ? { attio } : {}),
    backfillSince: new Date(since).toISOString(),
    intervalSeconds: input.intervalSeconds,
    routeVersion: input.routeVersion ?? 1,
    route: {
      mode: input.route.mode,
      folder: input.route.folder,
      recordType: input.route.recordType,
      ownerId
    }
  };
}
/** @param {any} connection @param {any} adapter @param {any} credential @param {string} ownerId */
export async function previewConnection(connection, adapter, credential, ownerId) {
  const deadline = Date.now() + 25000;
  if (connection.config.twoWay?.enabled) {
    if (!adapter.readDocument) throw Error('Two-way preview requires the Notion Markdown adapter');
    const outputs = [];
    for (const id of connection.config.resources.slice(0, 2)) {
      const sample = await adapter.readDocument(id, credential, deadline);
      outputs.push({
        pageId: id,
        title: sample.document.title,
        supported: sample.supported,
        path: workingFolder(connection) + '/' + id + '.md',
        document: sample.supported ? sample.document : null
      });
    }
    return {
      outputs,
      writesPerformed: false,
      complete: true,
      hasMore: connection.config.resources.length > 2,
      detail:
        'Two-way mode writes editable Fulcra copies and can update, create, archive and restore Notion pages. Unsupported documents remain read-only.'
    };
  }
  let checkpoint = null;
  let sampledPages = 0;
  for (let n = 0; n < 4 && Date.now() + 1000 < deadline; n++) {
    /** @type {any} */
    const page = await adapter.readPage({
      connection,
      credential,
      checkpoint,
      deadline,
      hints: []
    });
    if (page.retryAt)
      return { outputs: [], writesPerformed: false, retryAt: page.retryAt, complete: false };
    if (page.resetRequired) throw new Error('Preview requires reconciliation');
    sampledPages++;
    if (page.changes.length || !page.continuation)
      return {
        outputs: page.changes
          .slice(0, 3)
          .map((/** @type {any} */ c) => prepareOutput(connection, c, ownerId)),
        writesPerformed: false,
        hasMore: !!page.continuation || page.changes.length > 3,
        complete: true
      };
    checkpoint = page.candidateCheckpoint;
  }
  // Date-paged sources can have long stretches with no data. A successful bounded
  // sample may be approved without pretending the whole history was traversed.
  // Adapters that require document assembly keep the existing incomplete gate.
  if (adapter.previewPolicy === 'bounded-sample' && sampledPages > 0)
    return {
      outputs: [],
      writesPerformed: false,
      complete: true,
      hasMore: true,
      detail: `Checked ${sampledPages} bounded source pages without finding items. This sample does not cover every selected dataset or history date. Enabling will continue through the remaining history and watch for new data.`
    };
  return {
    outputs: [],
    writesPerformed: false,
    complete: false,
    detail:
      'This source needs more traversal than a bounded preview; select a smaller root or window.'
  };
}
/** @param {any} config */
export const configHash = (config) => contentHash(canonical(config));
/** @param {any} store @param {string} id @param {boolean} confirmed @param {any} crypto */
export async function enableConnection(store, id, confirmed, crypto) {
  if (!confirmed) throw new Error('Confirm the preview before enabling');
  const background = await store.getGrant('fulcra');
  if (background?.status !== 'ready') throw new Error('Background authorization required');
  const provider = await store.getGrant('provider:' + id);
  if (provider?.status !== 'ready') throw new Error('Provider authorization required');
  const connection = await store.getConnection(id),
    key = 'preview:' + id,
    preview = await store.getGrant(key);
  if (!connection || !preview || Date.parse(preview.expiresAt) <= Date.now())
    throw new Error('A recent preview is required');
  const proof = unseal(preview.encrypted, `${store.deploymentId}:${store.ownerId}:${key}`, crypto);
  if (
    proof.hash !== configHash(connection.config) ||
    String(proof.generation) !== String(connection.generation)
  )
    throw new Error('Configuration changed; preview again');
  await store.changeGeneration(id, 'ready', null, connection.generation);
  await store.enqueue(id);
  return { status: 'ready' };
}

/** Distinguish routing identity, source progress and scheduling-only changes.
 * @param {any} old @param {any} input @param {string[]} discovered @param {string} ownerId @param {string} connector */
export function configurationUpdate(old, input, discovered, ownerId, connector = '') {
  const config = validateConfig(input, discovered, ownerId, connector);
  const normalizedOld = {
    ...old,
    backfillSince: old.backfillSince ? new Date(old.backfillSince).toISOString() : undefined
  };
  const routingChanged = canonical(old.route) !== canonical(config.route);
  config.routeVersion = old.routeVersion ? old.routeVersion + (routingChanged ? 1 : 0) : 1;
  const resetCheckpoint =
    routingChanged ||
    canonical(old.twoWay) !== canonical(config.twoWay) ||
    canonical(old.attio) !== canonical(config.attio) ||
    canonical(old.resources) !== canonical(config.resources) ||
    normalizedOld.backfillSince !== config.backfillSince;
  return { config, resetCheckpoint, changed: canonical(normalizedOld) !== canonical(config) };
}
