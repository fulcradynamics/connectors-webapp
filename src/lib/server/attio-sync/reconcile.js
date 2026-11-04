import { decodeDocument, encodeDocument } from '../../attio-documents.js';
import { canonical, contentHash } from '../sync/identity.js';
/** @param {any} value */
const hash = (value) => contentHash(canonical(value));
/** @param {any} value */
const normalized = (value) => decodeDocument(encodeDocument(value));
/** @typedef {{schemaHash:string, protectedHash:string, fields:Record<string,string>}} Baseline */
/** @param {any} doc @returns {Baseline} */
export function baselineFor(doc) {
  const document = normalized(doc);
  const common = { version: document.version, kind: document.kind, binding: document.binding };
  if (document.kind === 'note') {
    return {
      schemaHash: hash({
        ...common,
        headNoteId: document.headNoteId,
        representation: document.representation
      }),
      protectedHash: hash({
        ...common,
        headNoteId: document.headNoteId,
        url: document.url,
        representation: document.representation
      }),
      fields: { title: hash(document.title), text: hash(document.text) }
    };
  }
  const schema = document.attributes.map((/** @type {any} */ a) => ({
    id: a.id,
    type: a.type,
    multiple: a.multiple,
    writable: a.writable,
    required: a.required,
    ...(a.options
      ? {
          options: a.options
            .map((/** @type {any} */ option) => ({
              id: option.id,
              archived: option.archived === true
            }))
            .sort((/** @type {any} */ a, /** @type {any} */ b) => a.id.localeCompare(b.id))
        }
      : {}),
    ...(a.targetObjectIds ? { targetObjectIds: [...a.targetObjectIds].sort() } : {})
  }));
  const fields = /** @type {Record<string,string>} */ ({}),
    readonly = /** @type {Record<string,any>} */ ({});
  for (const a of document.attributes) {
    if (a.writable) fields[a.id] = hash(document.values[a.id]);
    else if (Object.hasOwn(document.values, a.id)) readonly[a.id] = document.values[a.id];
  }
  return {
    schemaHash: hash({ ...common, attributes: schema }),
    protectedHash: hash({
      ...common,
      title: document.title,
      url: document.url,
      values: readonly,
      protected: document.protected
    }),
    fields
  };
}
/**
 * Pure per-field three-way merge. The caller persists evidence and rereads the provider
 * before any mutation; these hashes do not claim cross-service compare-and-swap.
 * Missing initial local data can be imported. A lost established copy stays missing.
 * @param {{baseline:Baseline|null, local:any, remote:any}} input
 * @returns {{kind:'pull'|'push'|'conflict'|'noop'|'missing'|'schema_conflict',document:any,changedIds:string[],conflicts:string[]}}
 */
export function reconcile({ baseline, local, remote }) {
  if (!remote)
    return { kind: 'missing', document: local ?? null, changedIds: [], conflicts: ['remote'] };
  const source = normalized(remote);
  if (!local)
    return baseline
      ? { kind: 'missing', document: source, changedIds: [], conflicts: ['local'] }
      : { kind: 'pull', document: source, changedIds: [], conflicts: [] };
  const working = normalized(local),
    left = baselineFor(working),
    right = baselineFor(source);
  const result = (
    /** @type {'pull'|'push'|'conflict'|'noop'|'missing'|'schema_conflict'} */ kind,
    /** @type {any} */ document,
    /** @type {string[]} */ changedIds = [],
    /** @type {string[]} */ conflicts = []
  ) => ({ kind, document, changedIds, conflicts });
  if (left.schemaHash !== right.schemaHash) return result('schema_conflict', working);
  if (!baseline) {
    if (encodeDocument(working) === encodeDocument(source)) return result('noop', source);
    return result(
      'conflict',
      working,
      [],
      Object.keys(left.fields).filter((id) => left.fields[id] !== right.fields[id])
    );
  }
  const validHash = (/** @type {any} */ value) =>
    typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (
    !validHash(baseline.schemaHash) ||
    !validHash(baseline.protectedHash) ||
    !baseline.fields ||
    Array.isArray(baseline.fields) ||
    Object.keys(baseline.fields).some((id) => !validHash(baseline.fields[id])) ||
    canonical(Object.keys(baseline.fields).sort()) !== canonical(Object.keys(left.fields).sort())
  )
    throw Error('Invalid Attio baseline');
  // A queued edit cannot silently adopt a changed schema or a forged working binding.
  // Fresh provider-only protected values may be pulled alongside approved field edits.
  if (baseline.schemaHash !== left.schemaHash || baseline.protectedHash !== left.protectedHash)
    return result('schema_conflict', working);
  const document = structuredClone(source),
    changedIds = [],
    conflicts = [];
  for (const id of Object.keys(left.fields)) {
    const localChanged = left.fields[id] !== baseline.fields[id];
    const remoteChanged = right.fields[id] !== baseline.fields[id];
    if (left.fields[id] === right.fields[id] || !localChanged) continue;
    if (remoteChanged) {
      conflicts.push(id);
      continue;
    }
    if (document.kind === 'note') document[id] = working[id];
    else document.values[id] = structuredClone(working.values[id]);
    changedIds.push(id);
  }
  if (conflicts.length) return result('conflict', working, [], conflicts);
  if (changedIds.length) return result('push', document, changedIds);
  return result(encodeDocument(working) === encodeDocument(source) ? 'noop' : 'pull', source);
}
