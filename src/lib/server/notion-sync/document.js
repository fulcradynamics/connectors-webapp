import { contentHash, canonical } from '../sync/identity.js';
export const MAX_MARKDOWN_BYTES = 24 * 1024;
/** @param {any} value */
export function normalizeDocument(value) {
  if (!value || Object.keys(value).some((k) => !['title', 'markdown', 'archived'].includes(k)))
    throw Error('Invalid document fields');
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200)
    throw Error('Choose a title between 1 and 200 characters');
  if (typeof value.markdown !== 'string' || /\0/.test(value.markdown))
    throw Error('Invalid Markdown content');
  if (Buffer.byteLength(value.markdown) > MAX_MARKDOWN_BYTES)
    throw Error('Markdown exceeds the 24 KiB bound');
  if (typeof value.archived !== 'boolean') throw Error('Invalid archive flag');
  return {
    title: value.title,
    markdown: value.markdown.replace(/\r\n?/g, '\n').trimEnd(),
    archived: value.archived
  };
}
/** @param {any} value */
export function encodeDocument(value) {
  const doc = normalizeDocument(value);
  return `---\nfulcra_notion: 1\ntitle: ${JSON.stringify(doc.title)}\narchived: ${doc.archived}\n---\n${doc.markdown}\n`;
}
/** @param {string} text */
export function decodeDocument(text) {
  const match = text.replace(/\r\n?/g, '\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw Error('Invalid working-file metadata');
  const fields = /** @type {Record<string,any>} */ ({});
  for (const line of match[1].split('\n')) {
    const pair = line.match(/^(fulcra_notion|title|archived): (.+)$/);
    if (!pair || Object.hasOwn(fields, pair[1])) throw Error('Invalid working-file metadata');
    try {
      fields[pair[1]] = JSON.parse(pair[2]);
    } catch {
      throw Error('Invalid working-file metadata');
    }
  }
  if (fields.fulcra_notion !== 1 || Object.keys(fields).length !== 3)
    throw Error('Invalid working-file metadata');
  return normalizeDocument({ title: fields.title, markdown: match[2], archived: fields.archived });
}
/** @param {any} doc */
export const documentHash = (doc) => contentHash(canonical(normalizeDocument(doc)));
/** @param {{notion:string,fulcra:string}|null} base @param {{notion:any,fulcra:any}} sides */
export function decideSync(base, { notion, fulcra }) {
  if (!notion) return 'inaccessible';
  if (!fulcra) return base ? 'missing' : 'pull';
  const n = documentHash(notion),
    f = documentHash(fulcra);
  if (n === f) return base?.notion === n && base?.fulcra === f ? 'noop' : 'converge';
  if (!base) return 'conflict';
  const nc = n !== base.notion,
    fc = f !== base.fulcra;
  return nc && fc ? 'conflict' : nc ? 'pull' : fc ? 'push' : 'conflict';
}
