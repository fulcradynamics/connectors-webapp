import { isManaged, encodeManaged } from '../../notion-managed.js';
import { readManagedCapsule, applyManagedEdit } from './managed.js';
import { providerHTTP } from '../connectors/http.js';
import { normalizeDocument, MAX_MARKDOWN_BYTES } from './document.js';
/** @param {string} value */
export function pageId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value))
    throw Error('Invalid Notion page ID');
  return value.toLowerCase();
}
/** @param {string} id */
export const markerTitle = (id) => `Fulcra sync ${pageId(id)}`;
/** Explicit sources follow their selected ID; discovered/created children stay under the parent.
 * @param {any} connection @param {any} entry @param {any} remote */
export function assertNotionPageScope(connection, entry, remote) {
  if (entry.origin !== 'selected' && remote.parentId !== connection.config.twoWay.parentId)
    throw Object.assign(Error('Notion page moved outside the configured creation parent'), {
      code: 'NOTION_SCOPE_MOVED'
    });
}
/** @param {{fetchImpl?:typeof fetch}} options */
export function createNotionPages({ fetchImpl = fetch } = {}) {
  /** @param {any} credential @param {number} deadline */
  const http = (credential, deadline) => {
    const request = providerHTTP({
      base: 'https://api.notion.com/v1/',
      credential,
      headers: { 'Notion-Version': '2026-03-11' },
      fetchImpl,
      deadline
    });
    let nextAt = 0;
    return async (/** @type {string} */ path, /** @type {RequestInit} */ init = {}) => {
      const wait = Math.max(0, nextAt - Date.now());
      if (Date.now() + wait + 500 >= deadline) throw Error('Notion request deadline exceeded');
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      nextAt = Date.now() + 350;
      return request(path, init);
    };
  };
  /** @param {string} id @param {any} credential @param {number} deadline @param {string|null} expectedParent */
  async function read(id, credential, deadline = Date.now() + 25000, expectedParent = null) {
    id = pageId(id);
    const req = http(credential, deadline);
    const { data: page } = await req('pages/' + id);
    const parentId =
      page.parent?.type === 'page_id' && page.parent.page_id ? pageId(page.parent.page_id) : null;
    if (expectedParent !== null)
      assertNotionPageScope(
        { config: { twoWay: { parentId: expectedParent } } },
        { origin: 'child' },
        { parentId }
      );
    const title = Object.entries(page.properties ?? {}).find(
      ([, v]) => /** @type {any} */ (v).type === 'title'
    );
    const property = /** @type {any} */ (title?.[1]);
    const titleText = (property?.title ?? [])
      .map((/** @type {any} */ r) => r.plain_text ?? r.text?.content ?? '')
      .join('');
    const { data } = await req(`pages/${id}/markdown?markdown_version=v2`);
    let supported =
      (titleText || 'Untitled').length <= 200 &&
      typeof data.markdown === 'string' &&
      !data.truncated &&
      !data.unknown_block_ids?.length &&
      !data.warnings?.length &&
      !/<unknown\b/i.test(data.markdown) &&
      Buffer.byteLength(data.markdown) <= MAX_MARKDOWN_BYTES;
    let managed = null,
      unsupportedReason = null;
    let markdown = typeof data.markdown === 'string' ? data.markdown : '';
    if (supported && isManaged(markdown)) {
      supported = false;
      unsupportedReason =
        'Page starts with a reserved connector document marker; edit that text in Notion.';
    } else if (
      !supported &&
      (titleText || 'Untitled').length <= 200 &&
      !page.in_trash &&
      !page.archived
    ) {
      try {
        managed = await readManagedCapsule(req, id);
        const ids = new Set();
        const collect = (/** @type {any[]} */ blocks) => {
          for (const b of blocks) {
            ids.add(b.id);
            if (b.snapshot?.children) collect(b.snapshot.children);
          }
        };
        collect(managed.blocks);
        if ((data.unknown_block_ids ?? []).some((/** @type {string} */ x) => !ids.has(pageId(x))))
          throw Error('Incomplete managed block projection');
        markdown = encodeManaged(managed);
        supported = true;
      } catch (cause) {
        if (
          !(cause instanceof Error) ||
          !/^(Managed|Invalid managed|Incomplete managed|Repeated managed|Unsupported managed|Invalid repeated)/.test(
            cause.message
          )
        )
          throw cause;
        unsupportedReason =
          'Page cannot fit a complete protected-block projection: ' + cause.message;
      }
    }
    return {
      id,
      parentId,
      bodyUnavailable: !!(page.in_trash || page.archived),
      titleProperty: property?.id ?? title?.[0] ?? 'title',
      revision: page.last_edited_time,
      supported,
      managed,
      unsupportedReason,
      document: supported
        ? normalizeDocument({
            title: titleText || 'Untitled',
            markdown,
            archived: !!(page.in_trash || page.archived)
          })
        : {
            title: titleText || 'Untitled',
            markdown: typeof data.markdown === 'string' ? data.markdown : '',
            archived: !!(page.in_trash || page.archived)
          }
    };
  }
  /** @param {string} parent @param {any} credential @param {string|null} cursor @param {number} deadline */
  async function children(parent, credential, cursor = null, deadline = Date.now() + 25000) {
    const query = new URLSearchParams({
      page_size: '50',
      ...(cursor ? { start_cursor: cursor } : {})
    });
    const { data } = await http(credential, deadline)(`blocks/${pageId(parent)}/children?${query}`);
    return {
      pages: (data.results ?? [])
        .filter((/** @type {any} */ b) => b.type === 'child_page')
        .map((/** @type {any} */ b) => ({ id: pageId(b.id), title: b.child_page.title })),
      cursor: data.has_more ? data.next_cursor : null
    };
  }
  /** @param {string} parent @param {string} localId @param {any} credential @param {number} deadline */
  async function createMarker(parent, localId, credential, deadline = Date.now() + 25000) {
    const { data } = await http(credential, deadline)('pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { page_id: pageId(parent) },
        properties: {
          title: { title: [{ type: 'text', text: { content: markerTitle(localId) } }] }
        }
      })
    });
    return { id: pageId(data.id) };
  }
  /** @param {string} id @param {string} titleProperty @param {string} title @param {any} credential @param {number} deadline */
  async function setTitle(id, titleProperty, title, credential, deadline = Date.now() + 25000) {
    normalizeDocument({ title, markdown: '', archived: false });
    const { data } = await http(credential, deadline)('pages/' + pageId(id), {
      method: 'PATCH',
      body: JSON.stringify({
        properties: { [titleProperty]: { title: [{ type: 'text', text: { content: title } }] } }
      })
    });
    return data;
  }
  /** @param {string} id @param {string} before @param {string} after @param {any} credential @param {number} deadline @param {any} remote */
  async function setBody(
    id,
    before,
    after,
    credential,
    deadline = Date.now() + 25000,
    remote = null
  ) {
    normalizeDocument({ title: 'body', markdown: after, archived: false });
    if (isManaged(before) || isManaged(after))
      return applyManagedEdit(
        http(credential, deadline),
        pageId(id),
        before,
        after,
        remote?.managed
      );
    const command = before
      ? {
          type: 'update_content',
          update_content: {
            content_updates: [{ old_str: before, new_str: after }],
            allow_deleting_content: false
          }
        }
      : {
          type: 'replace_content',
          replace_content: { new_str: after, allow_deleting_content: false }
        };
    const { data } = await http(credential, deadline)(`pages/${pageId(id)}/markdown`, {
      method: 'PATCH',
      body: JSON.stringify({ ...command, markdown_version: 'v2' })
    });
    if (data.object === 'async_task') throw Error('Notion Markdown write outcome pending');
    if (
      data.truncated ||
      data.unknown_block_ids?.length ||
      data.warnings?.length ||
      typeof data.markdown !== 'string'
    )
      throw Error('Notion Markdown write requires readback reconciliation');
    return data.markdown.replace(/\r\n?/g, '\n').trimEnd();
  }
  /** @param {string} id @param {boolean} archived @param {any} credential @param {number} deadline */
  async function setArchived(id, archived, credential, deadline = Date.now() + 25000) {
    if (typeof archived !== 'boolean') throw Error('Invalid archive flag');
    const { data } = await http(credential, deadline)('pages/' + pageId(id), {
      method: 'PATCH',
      body: JSON.stringify({ in_trash: archived })
    });
    return data;
  }
  return { read, children, createMarker, setTitle, setBody, setArchived };
}
