import { notionList } from '../connectors/notion-response.js';
import { encodeManaged, parseManaged, planManagedEdit } from '../../notion-managed.js';
import { canonical } from '../sync/identity.js';
const editableTypes = new Set([
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'heading_4',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'quote',
  'callout',
  'code'
]);
/** @param {any} value */
function id(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value))
    throw Error('Invalid managed block ID');
  return value.toLowerCase();
}
/** Exclude provider bookkeeping and expiring file capabilities from semantic snapshots.
 * @param {any} value @param {string} field @returns {any} */
function stable(value, field = '') {
  if (Array.isArray(value)) return value.map((x) => stable(x));
  if (value && typeof value === 'object') {
    const result = /** @type {Record<string,any>} */ ({});
    for (const key of Object.keys(value).sort()) {
      if (['__proto__', 'prototype', 'constructor'].includes(key))
        throw Error('Invalid managed source metadata');
      if (key === 'expiry_time') continue;
      if (field === 'file' && key === 'url' && typeof value[key] === 'string') {
        const url = new URL(value[key]);
        result[key] =
          url.protocol === 'https:' &&
          (/(^|\.)notion-static\.com$/.test(url.hostname) ||
            /(^|\.)amazonaws\.com$/.test(url.hostname))
            ? url.origin + url.pathname
            : value[key];
      } else result[key] = stable(value[key], key);
    }
    return result;
  }
  return value;
}
/** @param {any} block @param {string} parent */
function scope(block, parent) {
  const actual = block.parent?.block_id ?? block.parent?.page_id;
  if (!actual || id(actual) !== parent) throw Error('Managed block parent scope changed');
}
/** Only text values of supported root leaf blocks are editable. All style/link/shape metadata stays frozen.
 * @param {any} block @returns {any|null} */
export function mutableBlock(block) {
  if (block.has_children || !editableTypes.has(block.type)) return null;
  const payload = block[block.type],
    runs = payload?.rich_text;
  if (
    !Array.isArray(runs) ||
    runs.some((r) => r.type !== 'text' || typeof r.text?.content !== 'string')
  )
    return null;
  const normalized = runs.length
    ? runs
    : [{ type: 'text', text: { content: '', link: null }, annotations: {} }];
  const texts = [],
    styles = [];
  for (const run of normalized) {
    const style = {
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: 'default',
        ...stable(run.annotations ?? {})
      },
      link: stable(run.text.link ?? null)
    };
    if (styles.length && canonical(styles.at(-1)) === canonical(style))
      texts[texts.length - 1] += run.text.content;
    else {
      styles.push(style);
      texts.push(run.text.content);
    }
  }
  if (texts.some((text) => text.length > 2000)) return null;
  const attributes = { ...payload };
  delete attributes.rich_text;
  return {
    id: id(block.id),
    type: block.type,
    editable: true,
    texts,
    styles,
    attributes: stable(attributes)
  };
}
/** Complete bounded traversal. A failed read never becomes an empty or complete subtree.
 * @param {(path:string,init?:any)=>Promise<any>} request @param {string} pageId @param {{maxNodes?:number,maxRequests?:number,maxDepth?:number}} limits */
export async function readManagedCapsule(request, pageId, limits = {}) {
  pageId = id(pageId);
  const { maxNodes = 160, maxRequests = 16, maxDepth = 8 } = limits;
  let nodes = 0,
    requests = 0;
  const seen = new Set();
  /** @param {string} parent @param {number} depth @returns {Promise<any[]>} */
  async function children(parent, depth) {
    if (depth > maxDepth) throw Error('Managed block depth bound exceeded');
    const result = [],
      cursors = new Set();
    let cursor = null;
    do {
      if (++requests > maxRequests) throw Error('Managed block request bound exceeded');
      const query = new URLSearchParams({
        page_size: '100',
        ...(cursor ? { start_cursor: cursor } : {})
      });
      const { data } = await request(`blocks/${parent}/children?${query}`);
      const list = notionList(data, cursor, 'block', [...cursors]);
      for (const block of list.results) {
        if (typeof block.has_children !== 'boolean')
          throw Error('Invalid Notion block children response');
        if (++nodes > maxNodes) throw Error('Managed block capacity bound exceeded');
        const blockId = id(block.id);
        if (seen.has(blockId)) throw Error('Repeated managed block ID');
        seen.add(blockId);
        scope(block, parent);
        if (typeof block.type !== 'string' || !block[block.type] || block.type === 'unsupported')
          throw Error('Unsupported managed block structure');
        const leaf = depth === 0 ? mutableBlock(block) : null;
        if (leaf) result.push(leaf);
        else {
          const descendants =
            block.has_children && !['child_page', 'child_database'].includes(block.type)
              ? await children(blockId, depth + 1)
              : [];
          const snapshot = {
            id: blockId,
            type: block.type,
            attributes: stable(block[block.type]),
            children: descendants
          };
          result.push({ id: blockId, type: block.type, editable: false, snapshot });
        }
      }
      cursor = list.cursor;
      if (
        data.has_more &&
        (typeof cursor !== 'string' || !cursor || cursor.length > 2000 || cursors.has(cursor))
      )
        throw Error('Invalid repeated managed pagination cursor');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return result;
  }
  const capsule = { version: 1, pageId, blocks: await children(pageId, 0) };
  encodeManaged(capsule); // Validate the entire bounded projection before calling it supported.
  return capsule;
}
/** Apply at most one deterministic block mutation. The native worker persists progress and verifies later.
 * @param {(path:string,init?:any)=>Promise<any>} request @param {string} pageId @param {string} before @param {string} after @param {any} capsule */
export async function applyManagedEdit(request, pageId, before, after, capsule) {
  pageId = id(pageId);
  const previous = parseManaged(before),
    desired = parseManaged(after);
  if (!previous || !desired || previous.pageId !== pageId || desired.pageId !== pageId)
    throw Error('Managed page binding changed');
  if (!capsule || capsule.pageId !== pageId || encodeManaged(capsule) !== encodeManaged(previous))
    throw Error('Notion managed projection changed; sync and review');
  const plan = planManagedEdit(before, after);
  if (!plan) return encodeManaged(previous);
  const expected = capsule.blocks.find((/** @type {any} */ b) => b.id === plan.blockId);
  if (!expected?.editable) throw Error('Managed target scope changed');
  const { data: current } = await request('blocks/' + plan.blockId);
  scope(current, pageId);
  if (canonical(mutableBlock(current)) !== canonical(expected))
    throw Error('Notion managed block changed; sync and review');
  const rich_text = plan.afterTexts.map(
    (/** @type {string} */ content, /** @type {number} */ i) => ({
      type: 'text',
      text: { content, link: expected.styles[i].link },
      annotations: expected.styles[i].annotations
    })
  );
  await request('blocks/' + plan.blockId, {
    method: 'PATCH',
    body: JSON.stringify({ [plan.type]: { rich_text } })
  });
  return plan.intermediate;
}
