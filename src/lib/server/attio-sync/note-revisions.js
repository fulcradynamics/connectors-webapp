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
/** Attio's API projection removes empty paragraph lines. This is a lossy
 * serialization, not general Markdown equivalence. Derive one expected form only
 * for simple paragraphs; code, lists and other block syntax require exact bytes.
 * @param {string} text */
function paragraphProjection(text) {
  if (
    /[`\t\r|<>\\]/.test(text) ||
    /^ {4}/m.test(text) ||
    / {2,}$/m.test(text) ||
    /^ {0,3}(?:[-+*](?:\s|$)|\d+[.)](?:\s|$)|>|#{1,6}(?:\s|$)|~{3,}|(?:[-=*_] *)+$)/m.test(text) ||
    /^ {0,3}\[[^\]]+\]:/m.test(text)
  )
    return null;
  return text
    .split('\n')
    .filter((line) => line !== '')
    .join('\n');
}
/** Exact parent binding is checked by the caller. Verify the retained original
 * payload and every title/provenance byte before accepting a known projection.
 * Never normalize arbitrary remote Markdown or treat it as the original draft.
 * @param {any} projection @param {any} revision */
export function revisionReadback(projection, revision) {
  if (
    !revision ||
    !revision.marker ||
    typeof revision.marker !== 'object' ||
    Array.isArray(revision.marker) ||
    typeof revision.markdown !== 'string' ||
    typeof revision.footer !== 'string' ||
    !revision.footer.startsWith('\n\n---\n') ||
    !revision.markdown.endsWith(revision.footer) ||
    projection?.title !== revision.title ||
    typeof projection.text !== 'string'
  )
    return null;
  const original = revision.markdown.slice(0, -revision.footer.length);
  const marker = `<!-- fulcra-attio-revision:${Buffer.from(canonical(revision.marker)).toString('base64url')} -->`;
  if (
    !revision.footer.endsWith(marker) ||
    notePayloadHash({ title: revision.draftTitle, text: original }) !== revision.marker?.payloadHash
  )
    return null;
  if (projection.text === revision.markdown)
    return {
      title: revision.draftTitle,
      text: original,
      footer: revision.footer,
      serialization: 'exact'
    };
  const footer = revision.footer.slice(1);
  if (projection.text === original + footer)
    return {
      title: revision.draftTitle,
      text: original,
      footer,
      serialization: 'attio-footer-projection-v1'
    };
  const serialized = paragraphProjection(original);
  if (serialized === null || projection.text !== serialized + footer) return null;
  return {
    title: revision.draftTitle,
    text: serialized,
    footer,
    serialization: 'attio-paragraph-projection-v1'
  };
}
/** @param {any} projection @param {any} revision */
export function matchesRevision(projection, revision) {
  return revisionReadback(projection, revision) !== null;
}
