import { canonical, contentHash } from '../sync/identity.js';

/** @param {any} document */
export const notePayloadHash = (document) =>
  contentHash(canonical({ title: document.title, text: document.text }));
/** @param {any} c @param {any} entry @param {any} document @param {string} operationId @param {string} nonce */
export function prepareRevision(c, entry, document, operationId, nonce) {
  const marker = {
    version: 1,
    connectionId: c.id,
    workspaceId: c.account_id,
    objectId: entry.binding.objectId,
    recordId: entry.binding.recordId,
    originalNoteId: entry.binding.noteId,
    previousNoteId: entry.headNoteId ?? entry.binding.noteId,
    operationId,
    nonce,
    payloadHash: notePayloadHash(document)
  };
  const encoded = Buffer.from(canonical(marker)).toString('base64url'),
    suffix = ` [Fulcra ${operationId}]`;
  const title = document.title.slice(0, 200 - suffix.length) + suffix;
  // The exact title is in provenance because Attio's title limit may truncate a draft.
  const footer = `\n\n---\nFulcra linked revision of note ${marker.originalNoteId}; previous note ${marker.previousNoteId}.\nDraft title: ${JSON.stringify(document.title)}\n<!-- fulcra-attio-revision:${encoded} -->`;
  return { marker, title, markdown: document.text + footer, footer, draftTitle: document.title };
}
/** Strip only the exact connector-owned footer. Source-provided lookalikes confer no authority.
 * @param {any} projection @param {any} revision */
export function stripRevision(projection, revision) {
  if (
    !revision ||
    typeof projection.text !== 'string' ||
    !projection.text.endsWith(revision.footer)
  )
    return projection;
  return {
    ...projection,
    title: projection.title === revision.title ? revision.draftTitle : projection.title,
    text: projection.text.slice(0, -revision.footer.length)
  };
}
/** Parent binding is checked by the caller; this verifies every provenance byte and payload.
 * @param {any} projection @param {any} revision */
export function matchesRevision(projection, revision) {
  return (
    projection.title === revision.title &&
    projection.text === revision.markdown &&
    notePayloadHash(stripRevision(projection, revision)) === revision.marker.payloadHash
  );
}
