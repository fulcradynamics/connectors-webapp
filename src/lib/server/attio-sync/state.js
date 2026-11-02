import { seal, unseal } from '../secrets.js';
import { canonical, contentHash } from '../sync/identity.js';
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export const MAX_MANIFEST_BYTES = 512 * 1024;
export const MAX_BUCKET_BYTES = 128 * 1024;
/** @param {any} c */
export function folder(c) {
  const path = c.config.route?.folder;
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    /[\\\0]/.test(path) ||
    path.split('/').some((x) => x === '..' || x === '.') ||
    !uuid.test(c.id)
  )
    throw Error('Invalid Attio folder configuration');
  return path.replace(/\/$/, '') + '/live/' + c.id;
}
/** @param {any} c @param {string} kind @param {string} source */
export function localId(c, kind, source) {
  const h = contentHash(canonical(['attio', c.id, c.account_id, kind, source]));
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** @param {string} id */
export function bucketId(id) {
  if (!uuid.test(id)) throw Error('Invalid Attio document ID');
  return contentHash(id).slice(0, 2);
}
/** @param {any} c */
export function scopeHash(c) {
  if (c.connector !== 'attio' || !uuid.test(c.account_id) || !c.config.attio?.twoWay)
    throw Error('Enable verified Attio two-way configuration first');
  return contentHash(
    canonical({
      workspace: c.account_id,
      resources: [...c.config.resources].sort(),
      attio: c.config.attio,
      route: c.config.route,
      folder: folder(c)
    })
  );
}
/** @param {any} store @param {any} c @param {string} suffix */
const context = (store, c, suffix) =>
  `${store.deploymentId}:${store.ownerId}:attio:${c.id}:${suffix}`;
/** @param {any} store @param {any} c @param {any} crypto @returns {Promise<any>} */
export async function loadManifest(store, c, crypto) {
  if (!store.supportsTwoWay) throw Error('Attio two-way sync requires the native Workflow backend');
  const scope = scopeHash(c),
    key = 'attio-sync:' + c.id,
    saved = await store.getGrant(key);
  if (saved) {
    const m = unseal(saved.encrypted, context(store, c, 'manifest'), crypto);
    if (m.version !== 1 || m.scopeHash !== scope)
      throw Error('Attio scope configuration changed; use a separate connection');
    return m;
  }
  return {
    version: 1,
    scopeHash: scope,
    buckets: {},
    queue: [],
    pending: null,
    activeBucket: null,
    cursor: { record: 0, mode: 'record', notes: null },
    ownedNotes: {},
    counts: { records: 0, notes: 0 },
    index: { state: 'pending' },
    warnings: []
  };
}
/** @param {any} store @param {any} c @param {any} m @param {any} crypto */
export async function saveManifest(store, c, m, crypto) {
  if (m.scopeHash !== scopeHash(c) || m.version !== 1)
    throw Error('Attio scope configuration changed');
  if (m.queue.length > 5 || Buffer.byteLength(JSON.stringify(m)) > MAX_MANIFEST_BYTES)
    throw Error('Attio recovery state capacity reached; retained work requires attention');
  await store.saveGrant('attio-sync:' + c.id, {
    encrypted: seal(m, context(store, c, 'manifest'), crypto),
    status: 'ready'
  });
}
/** Reserve space for one active bucket and four representations of the accepted candidate.
 * @param {any} m @param {any} document */
export function reserveEdit(m, document) {
  const base = { ...m, activeBucket: null, pending: null };
  if (
    m.queue.length >= 5 ||
    Buffer.byteLength(JSON.stringify(base)) +
      Buffer.byteLength(JSON.stringify(document)) * 4 +
      224 * 1024 >
      MAX_MANIFEST_BYTES
  )
    throw Error('Attio edit capacity reached; wait for retained edits to finish');
}
/** @param {any} bucket */
function validateBucket(bucket) {
  if (
    !bucket ||
    bucket.version !== 1 ||
    !/^[a-f0-9]{2}$/.test(bucket.prefix) ||
    !bucket.entries ||
    Array.isArray(bucket.entries)
  )
    throw Error('Invalid Attio bucket');
  if (
    Object.keys(bucket.entries).length > 64 ||
    Buffer.byteLength(JSON.stringify(bucket)) > MAX_BUCKET_BYTES
  )
    throw Error('Attio bucket capacity exceeded');
  for (const [id, e] of Object.entries(bucket.entries)) {
    if (bucketId(id) !== bucket.prefix || /** @type {any} */ (e).id !== id)
      throw Error('Invalid Attio bucket binding');
  }
  return bucket;
}
/** @param {any} store @param {any} c @param {any} bucket @param {any} crypto */
export function bucketEnvelope(store, c, bucket, crypto) {
  validateBucket(bucket);
  const semanticHash = contentHash(canonical(bucket)),
    content =
      JSON.stringify(seal(bucket, context(store, c, 'bucket:' + bucket.prefix), crypto)) + '\n';
  return { content, hash: contentHash(content), semanticHash };
}
/** @param {any} m @param {string} prefix @param {any} client @param {any} store @param {any} c @param {any} crypto @returns {Promise<any>} */
export async function loadBucket(m, prefix, client, store, c, crypto) {
  if (!/^[a-f0-9]{2}$/.test(prefix)) throw Error('Invalid Attio bucket ID');
  if (m.activeBucket?.prefix === prefix) return validateBucket(m.activeBucket);
  const ref = m.buckets[prefix];
  if (!ref) return { version: 1, prefix, entries: {} };
  const bytes = await client.readFileBytes(ref.fileId, 192 * 1024);
  const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (contentHash(content) !== ref.hash) throw Error('Attio bucket evidence changed');
  const value = validateBucket(
    unseal(JSON.parse(content), context(store, c, 'bucket:' + prefix), crypto)
  );
  if (value.prefix !== prefix || contentHash(canonical(value)) !== ref.semanticHash)
    throw Error('Attio bucket scope or evidence changed');
  return value;
}
