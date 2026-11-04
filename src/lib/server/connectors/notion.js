import { createNotionPages } from '../notion-sync/notion.js';
import { providerHTTP, rateAware, selectedResources } from './http.js';
import { notionList, notionPage } from './notion-response.js';
const version = '2026-03-11';
/** @param {any[]} rich */
const text = (rich) => (rich ?? []).map((t) => t.plain_text ?? t.text?.content ?? '').join('');
/** @param {any} block */
export function renderBlock(block) {
  const type = block.type,
    data = block[type] ?? {},
    value = text(data.rich_text);
  if (/^heading_[1-3]$/.test(type)) return '#'.repeat(Number(type.slice(-1))) + ' ' + value;
  if (
    [
      'paragraph',
      'toggle',
      'callout',
      'quote',
      'bulleted_list_item',
      'numbered_list_item'
    ].includes(type)
  )
    return (type === 'quote' ? '> ' : type.endsWith('list_item') ? '- ' : '') + value;
  if (type === 'to_do') return `- [${data.checked ? 'x' : ' '}] ${value}`;
  if (type === 'code') return '```' + (data.language ?? '') + '\n' + value + '\n```';
  if (type === 'child_page') return '## ' + data.title;
  if (type === 'divider') return '---';
  if (type === 'table_row') return '| ' + (data.cells ?? []).map(text).join(' | ') + ' |';
  if (['column', 'column_list', 'table', 'synced_block'].includes(type)) return '';
  if (type === 'equation') return '$$' + data.expression + '$$';
  if (
    ['image', 'file', 'pdf', 'video', 'audio', 'bookmark', 'embed', 'link_preview'].includes(type)
  )
    return `[${type}](${data.external?.url ?? data.file?.url ?? data.url ?? ''})`;
  return `[Unsupported block: ${type}]`;
}
/** @param {{fetchImpl?:typeof fetch}} options */
export function createNotion({ fetchImpl = fetch } = {}) {
  /** @param {any} credential @param {number} deadline */
  const http = (credential, deadline) =>
    providerHTTP({
      base: 'https://api.notion.com/v1/',
      credential,
      headers: { 'Notion-Version': version },
      fetchImpl,
      deadline
    });
  /** @param {any} input */
  async function listResources({ credential, cursor = null, deadline = Date.now() + 10000 }) {
    const { data } = await http(credential, deadline)('search', {
      method: 'POST',
      body: JSON.stringify({
        filter: { property: 'object', value: 'page' },
        page_size: 50,
        ...(cursor ? { start_cursor: cursor } : {})
      })
    });
    const list = notionList(data, cursor, 'page');
    return {
      resources: list.results.map((/** @type {any} */ p) => ({
        id: p.id,
        name:
          text(
            Object.values(p.properties ?? {}).find((/** @type {any} */ v) => v.type === 'title')
              ?.title ?? []
          ) || p.id,
        kind: 'page'
      })),
      nextCursor: list.cursor
    };
  }
  /** @param {any} input */
  async function readPage({ connection, credential, checkpoint, deadline }) {
    return rateAware(async () => {
      const resources = selectedResources(connection),
        cp = structuredClone(checkpoint ?? { index: 0 }),
        index = cp.index ?? 0,
        root = cp.root ?? resources[index % resources.length];
      if (!resources.includes(root)) throw new Error('Traversal outside selected root');
      const req = http(credential, deadline);
      const lost = () => ({
        changes: [
          {
            id: root,
            version: 'access_lost',
            timestamp: cp.page?.last_edited_time ?? new Date().toISOString(),
            operation: 'access_lost',
            payload: { id: root, status: 'access_lost' }
          }
        ],
        candidateCheckpoint: { index: (index + 1) % resources.length }
      });
      if (!cp.frontier?.length) {
        const response = await req('pages/' + encodeURIComponent(root), {}, [404]);
        if (response.status === 404) return lost();
        notionPage(response.data, root);
        cp.root = root;
        cp.page = response.data;
        cp.blocks = [];
        cp.frontier = [{ id: root, cursor: null }];
        cp.seen = [];
      }
      notionPage(cp.page, root);
      const current = cp.frontier.shift();
      const query = new URLSearchParams({ page_size: '50' });
      if (current.cursor) query.set('start_cursor', current.cursor);
      const response = await req(
        `blocks/${encodeURIComponent(current.id)}/children?${query}`,
        {},
        [404]
      );
      if (response.status === 404) return lost();
      const data = response.data;
      const list = notionList(data, current.cursor, 'block', current.cursors ?? []);
      for (const block of list.results) {
        if (typeof block.has_children !== 'boolean')
          throw Error('Invalid Notion block children response');
        if (cp.seen.includes(block.id)) continue;
        cp.seen.push(block.id);
        cp.blocks.push({ parentId: current.id, block });
        if (block.has_children) cp.frontier.push({ id: block.id, cursor: null });
      }
      if (list.cursor)
        cp.frontier.unshift({
          id: current.id,
          cursor: list.cursor,
          cursors: [...(current.cursors ?? []), list.cursor]
        });
      if (cp.blocks.length > 5000 || JSON.stringify(cp).length > 2_000_000)
        throw new Error('Notion traversal exceeds configured bound; select smaller roots');
      if (cp.frontier.length) return { changes: [], candidateCheckpoint: cp, continuation: true };
      /** @param {string} parent @param {Set<string>} seen */
      const render = (parent, seen = new Set()) => {
        if (seen.has(parent)) return '';
        seen.add(parent);
        return cp.blocks
          .filter((/** @type {any} */ b) => b.parentId === parent)
          .map((/** @type {any} */ b) => renderBlock(b.block) + '\n\n' + render(b.block.id, seen))
          .join('\n');
      };
      const title =
        text(
          Object.values(cp.page.properties ?? {}).find((/** @type {any} */ v) => v.type === 'title')
            ?.title ?? []
        ) || root;
      const body = '# ' + title + '\n\n' + render(root);
      const payload = {
        id: root,
        title,
        properties: cp.page.properties,
        url: cp.page.url,
        blocks: cp.blocks,
        complete: true
      };
      const changes = [
        {
          id: root,
          version: cp.page.last_edited_time,
          timestamp: cp.page.last_edited_time,
          operation: cp.page.in_trash || cp.page.archived ? 'deleted' : 'upsert',
          payload,
          files: [{ name: 'document.md', content: body, contentType: 'text/markdown' }]
        }
      ];
      const next = (index + 1) % resources.length;
      return { changes, candidateCheckpoint: { index: next }, continuation: next !== 0 };
    });
  }
  return {
    listResources,
    readPage,
    readDocument: createNotionPages({ fetchImpl }).read,
    validate: async (/** @type {any} */ credential) => {
      const { data } = await http(credential, Date.now() + 10000)('users/me');
      return { accountId: data.bot?.workspace_name ? data.id : data.id };
    }
  };
}
export const notion = createNotion();
