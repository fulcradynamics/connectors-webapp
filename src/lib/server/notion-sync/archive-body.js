import { decodeDocument, documentHash } from './document.js';
/** Notion hides trashed-page Markdown. Preserve verified bytes until restore exposes it again.
 * This cached body never authorizes replacing newly visible content after a restore.
 * @param {any} remote @param {any} entry @param {any} client @param {any} pending */
export async function retainArchivedBody(remote, entry, client, pending = null) {
  if (!remote.bodyUnavailable || !remote.document.archived) return remote;
  let retained =
    pending?.kind === 'notion' && pending.entryId === entry.localId ? pending.expected : null;
  const fileId = entry.baselineFileId ?? entry.fileId;
  if (!retained && entry.baseline && fileId) {
    const bytes = await client.readFileBytes(fileId, 64 * 1024);
    const candidate = decodeDocument(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (documentHash(candidate) === entry.baseline.fulcra) retained = candidate;
  }
  if (!retained) return { ...remote, supported: false };
  return { ...remote, document: { ...remote.document, markdown: retained.markdown } };
}
