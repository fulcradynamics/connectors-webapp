import { randomUUID } from 'node:crypto';
import { decodeDocument, validateEdit } from '../../attio-documents.js';
import {
  loadManifest,
  saveManifest,
  loadBucket,
  bucketId,
  localId,
  folder,
  reserveEdit,
  MAX_BUCKET_BYTES
} from './state.js';
import { contentHash, canonical } from '../sync/identity.js';
import { baselineFor } from './reconcile.js';
import { indexStatus } from './index.js';
import { readRemoteDocument, providerHash, assertBinding } from './projection.js';
import { attioAPI, parseResource } from './provider.js';
/** Owner operations queue bounded intents; provider mutation belongs only to the durable worker.
 * @param {any} options */
export function createAttioDocumentService({
  store,
  connection: c,
  crypto,
  client,
  credential,
  api = attioAPI
}) {
  const manifest = () => loadManifest(store, c, crypto);
  /** @param {any} m @param {string} id */
  async function selected(m, id) {
    const prefix = bucketId(id),
      bucket = await loadBucket(m, prefix, client, store, c, crypto),
      entry = bucket.entries[id];
    if (!entry) throw Error('Document is outside the selected connection scope');
    assertBinding(entry, c, entry.binding, entry.kind === 'note' ? entry.binding.noteId : null);
    if (
      id !== localId(c, entry.kind, entry.kind === 'note' ? entry.binding.noteId : entry.resourceId)
    )
      throw Error('Document mapping scope changed');
    return { entry, bucket };
  }
  /** @param {any} e */
  const pathFor = (e) =>
    `${folder(c)}/${e.kind === 'note' ? 'notes' : 'records'}/${bucketId(e.id)}/${e.id}.json`;
  /** @param {any} ref */
  async function snapshot(ref) {
    if (!ref?.fileId) throw Error('Retained evidence is unavailable');
    const bytes = await client.readFileBytes(ref.fileId, 64 * 1024);
    if (bytes.length > 64 * 1024) throw Error('Retained evidence exceeds bound');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (ref.hash && contentHash(text) !== ref.hash) throw Error('Retained evidence changed');
    return decodeDocument(text);
  }
  /** Schemas are allowed before enablement only for an exact discovered or selected record.
   * @param {string} resource */
  async function schema(resource) {
    parseResource(resource);
    if (c.connector !== 'attio') throw Error('Attio schema requires Attio connection');
    const discovered = await store.getResources(c.id);
    if (
      !c.config.resources?.includes(resource) &&
      !discovered.some((/** @type {any} */ r) => r.id === resource)
    )
      throw Error('Schema source is outside discovered scope');
    return {
      resourceId: resource,
      attributes: await api.schema(resource, credential, c.account_id, Date.now() + 25000)
    };
  }
  /** @param {string|null} cursor */
  async function list(cursor = null) {
    const m = await manifest(),
      prefixes = [
        ...new Set([...Object.keys(m.buckets), ...(m.activeBucket ? [m.activeBucket.prefix] : [])])
      ].sort();
    if (cursor !== null && (!/^[a-f0-9]{2}$/.test(cursor) || !prefixes.includes(cursor)))
      throw Error('Invalid document cursor');
    const offset = cursor === null ? 0 : prefixes.indexOf(cursor),
      prefix = prefixes[offset],
      bucket = prefix ? await loadBucket(m, prefix, client, store, c, crypto) : null;
    return {
      documents: bucket
        ? Object.values(bucket.entries).map((/** @type {any} */ e) => {
            assertBinding(e, c, e.binding, e.kind === 'note' ? e.binding.noteId : null);
            return {
              id: e.id,
              title: e.title,
              kind: e.kind,
              status: m.queue.some((/** @type {any} */ q) => q.id === e.id) ? 'queued' : e.status,
              conflictId: e.conflict?.id ?? null,
              error: e.error ?? null,
              sourceUrl: e.sourceUrl ?? ''
            };
          })
        : [],
      nextCursor: prefixes[offset + 1] ?? null,
      index: indexStatus(m, c),
      queued: m.queue.length,
      pending: m.pending ? { phase: m.pending.phase } : null
    };
  }
  /** @param {string} id @param {string} view */
  async function read(id, view = 'current') {
    if (!['current', 'provider', 'fulcra', 'working'].includes(view))
      throw Error('Invalid conflict view');
    const m = await manifest(),
      { entry: e } = await selected(m, id),
      retained =
        m.queue.find((/** @type {any} */ q) => q.id === id)?.document ??
        (m.pending?.entryId === id ? m.pending.accepted : null) ??
        e.recovery?.document;
    let file,
      workingReadUnavailable = false;
    try {
      file = await client.latestFile(pathFor(e));
      if (file) decodeDocument(file.content);
    } catch (cause) {
      if (!retained) throw cause;
      workingReadUnavailable = true;
      file = null;
    }
    let document = retained ?? (file ? decodeDocument(file.content) : null);
    if (!document) throw Error('Document is waiting for its first verified working copy');
    let expectedProvider = null,
      providerReadUnavailable = false,
      sourceReadUnavailable = false,
      sourceDocument;
    if (e.conflict) {
      try {
        expectedProvider = providerHash(await readRemoteDocument(e, c, credential, { api }));
      } catch {
        providerReadUnavailable = true;
      }
      if (view === 'working') {
        const fileId = e.recovery?.interveningFileIds?.[0];
        if (!fileId) throw Error('No retained intervening working version');
        document = await snapshot({ fileId });
      } else if (view !== 'current')
        document = await snapshot(e.conflict.paths.find((/** @type {any} */ p) => p.view === view));
    } else if (view !== 'current') throw Error('Document has no active conflict');
    if (e.sourceSnapshot)
      try {
        sourceDocument = await snapshot(e.sourceSnapshot);
      } catch {
        sourceReadUnavailable = true;
      }
    return {
      id,
      document,
      path: pathFor(e),
      revision: file?.id ?? null,
      workingReadUnavailable: workingReadUnavailable || !file,
      queued: m.queue.some((/** @type {any} */ q) => q.id === id) || m.pending?.entryId === id,
      status: e.status,
      conflict: e.conflict ? { id: e.conflict.id } : null,
      expectedProvider,
      ...(e.recovery?.interveningFileIds?.length
        ? { interveningVersion: { fileId: e.recovery.interveningFileIds[0] } }
        : {}),
      providerReadUnavailable,
      sourceReadUnavailable,
      ...(e.sourceSnapshot
        ? { sourceReference: { fileId: e.sourceSnapshot.fileId, hash: e.sourceSnapshot.hash } }
        : {}),
      ...(sourceDocument ? { sourceDocument } : {})
    };
  }
  /** @param {any} input */
  async function mutate(input) {
    const fields = /** @type {Record<string,string[]>} */ ({
      save: ['id', 'expectedRevision', 'document'],
      resolve: ['id', 'choice', 'expectedRevision', 'expectedProvider', 'conflictId'],
      sync: ['id']
    });
    if (
      !input ||
      !fields[input.operation] ||
      Object.keys(input).some((k) => !['operation', ...fields[input.operation]].includes(k))
    )
      throw Error('Invalid document action fields');
    const m = await manifest();
    if (c.status !== 'ready') throw Error('Enable the verified two-way connection before editing');
    if (input.operation === 'sync') {
      if (input.id) await selected(m, input.id);
      m.scanRequested = true;
      await saveManifest(store, c, m, crypto);
      await store.enqueue(c.id);
      return { queued: true };
    }
    const { entry: e, bucket } = await selected(m, input.id),
      file = await client.latestFile(pathFor(e));
    if (!file || typeof input.expectedRevision !== 'string' || input.expectedRevision !== file.id)
      throw Error('Document changed: reload the current working revision');
    if (m.pending?.entryId === e.id || m.queue.some((/** @type {any} */ q) => q.id === e.id))
      throw Error('Document already syncing; wait and reload');
    const before = decodeDocument(file.content);
    assertBinding(e, c, before.binding, e.kind === 'note' ? e.binding.noteId : null);
    if (before.kind !== e.kind || canonical(before.binding) !== canonical(e.binding))
      throw Error('Document binding scope changed');
    if (input.operation === 'save') {
      const baseline = baselineFor(before);
      if (
        !e.baseline ||
        baseline.schemaHash !== e.baseline.schemaHash ||
        baseline.protectedHash !== e.baseline.protectedHash
      )
        throw Error('Document schema or protected metadata changed; sync and review conflict');
    }
    let document, resolution;
    if (input.operation === 'resolve') {
      if (
        !e.conflict ||
        e.conflict.id !== input.conflictId ||
        !['provider', 'fulcra', 'working'].includes(input.choice)
      )
        throw Error('Conflict changed; reload');
      const remote = await readRemoteDocument(e, c, credential, { api }),
        expected = providerHash(remote);
      if (
        expected !== input.expectedProvider ||
        expected !== e.conflict.expectedProvider ||
        file.id !== e.conflict.expectedRevision
      )
        throw Error('Conflict changed: sync and reload current versions');
      const chosen =
        input.choice === 'working'
          ? await snapshot({ fileId: e.recovery?.interveningFileIds?.[0] })
          : await snapshot(
              e.conflict.paths.find((/** @type {any} */ p) => p.view === input.choice)
            );
      if (canonical(chosen.binding) !== canonical(remote.binding) || chosen.kind !== remote.kind)
        throw Error('Conflict binding changed');
      document = structuredClone(remote);
      if (document.kind === 'note') {
        document.title = chosen.title;
        document.text = chosen.text;
      } else
        for (const a of document.attributes)
          if (a.writable && Object.hasOwn(chosen.values, a.id))
            document.values[a.id] = structuredClone(chosen.values[a.id]);
      document = validateEdit(remote, document, c.config.resources).document;
      resolution = { conflictId: e.conflict.id, expectedProvider: expected, choice: input.choice };
    } else {
      if (e.conflict || e.recovery) throw Error('Resolve retained conflict before editing');
      document = validateEdit(before, input.document, c.config.resources).document;
    }
    reserveEdit(m, document);
    const recoveryBucket = structuredClone(bucket);
    recoveryBucket.entries[e.id].recovery = { ...e.recovery, document };
    if (
      Buffer.byteLength(JSON.stringify(recoveryBucket)) +
        4096 +
        (document.kind === 'note' ? Buffer.byteLength(document.text) + 3 * 1024 : 0) >
      MAX_BUCKET_BYTES
    )
      throw Error('Attio bucket edit capacity reached; retained work requires attention');
    m.queue.push({
      id: e.id,
      document,
      expectedRevision: file.id,
      operationId: randomUUID(),
      ...(resolution ? { resolution } : {})
    });
    await saveManifest(store, c, m, crypto);
    await store.enqueue(c.id);
    return { id: e.id, queued: true };
  }
  return { schema, list, read, mutate };
}
