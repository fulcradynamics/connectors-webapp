import { projectRecord, projectNote } from '../../attio-documents.js';
import { canonical, contentHash } from '../sync/identity.js';
import { attioAPI } from './provider.js';
import { stripRevision } from './note-revisions.js';

/** @param {any} document */
export const providerHash = (document) => contentHash(canonical(document));

/** Exact selected parent and workspace are checked even for injected transports.
 * @param {any} entry @param {any} c @param {any} binding @param {string|null} noteId */
export function assertBinding(entry, c, binding, noteId = null) {
  if (
    !c.config.resources.includes(entry.resourceId) ||
    binding?.workspaceId !== c.account_id ||
    `${binding?.objectId}:${binding?.recordId}` !== entry.resourceId ||
    (noteId !== null && binding?.noteId !== noteId)
  )
    throw Error('Attio source workspace or parent binding changed');
}

/** The source observation is separate from the current revision, so a changed original
 * creates a visible branch rather than silently becoming a replacement head.
 * @param {any} entry @param {any} c @param {any} credential
 * @param {{api?:any,deadline?:number}} options */
export async function readRemoteObservation(
  entry,
  c,
  credential,
  { api = attioAPI, deadline = Date.now() + 25000 } = {}
) {
  if (entry.kind === 'record') {
    const projection = await api.readRecord(entry.resourceId, credential, c.account_id, deadline);
    assertBinding(entry, c, projection.binding);
    return {
      document: projectRecord(
        projection,
        c.config.attio.writableAttributes[projection.binding.objectId] ?? [],
        c.config.resources
      ),
      source: null,
      sourceHash: null,
      branchChanged: false
    };
  }
  const originalId = entry.binding.noteId,
    headId = entry.headNoteId ?? originalId;
  const source = await api.readNote(
    originalId,
    entry.resourceId,
    credential,
    c.account_id,
    deadline
  );
  assertBinding(entry, c, source.binding, originalId);
  const sourceDocument = projectNote(source),
    sourceHash = providerHash(sourceDocument);
  let head = source;
  if (headId !== originalId) {
    head = await api.readNote(headId, entry.resourceId, credential, c.account_id, deadline);
    assertBinding(entry, c, head.binding, headId);
    head = stripRevision(head, entry.headRevision);
  }
  const branchChanged =
    headId !== originalId && !!entry.sourceHash && entry.sourceHash !== sourceHash;
  // A reviewed original branch is the provider choice. Its protected lineage remains
  // bound to the established current head until a new linked revision is verified.
  const projected = branchChanged ? { ...source, url: head.url } : head;
  return {
    document: projectNote(projected, { originalNoteId: originalId, headNoteId: headId }),
    source: sourceDocument,
    sourceHash,
    branchChanged
  };
}

/** @param {any} entry @param {any} c @param {any} credential @param {{api?:any,deadline?:number}} options */
export async function readRemoteDocument(entry, c, credential, options = {}) {
  return (await readRemoteObservation(entry, c, credential, options)).document;
}
