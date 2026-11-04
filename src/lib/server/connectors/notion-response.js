/** Validate only the consumed provider contract. Cursors remain opaque strings.
 * A malformed response must never be interpreted as an empty complete read.
 * @param {any} value */
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {any} value @returns {boolean} */
const nonempty = (value) => typeof value === 'string' && value.length > 0;
const textTypes = new Set([
  'heading_1',
  'heading_2',
  'heading_3',
  'paragraph',
  'toggle',
  'callout',
  'quote',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'code'
]);
/** @param {any} rich */
function richText(rich) {
  if (
    !Array.isArray(rich) ||
    rich.some(
      (value) =>
        !record(value) ||
        (typeof value.plain_text !== 'string' && typeof value.text?.content !== 'string')
    )
  )
    throw Error('Invalid Notion rich text response');
}
/** Validate known fields before rendering; future block types remain visible/protected.
 * @param {any} block */
function blockContent(block) {
  const type = block.type,
    data = block[type];
  if (textTypes.has(type)) {
    if (!record(data)) throw Error('Invalid Notion block content response');
    richText(data.rich_text);
    if (
      (type === 'to_do' && typeof data.checked !== 'boolean') ||
      (type === 'code' && typeof data.language !== 'string')
    )
      throw Error('Invalid Notion block attributes response');
  } else if (type === 'table_row') {
    if (!record(data) || !Array.isArray(data.cells))
      throw Error('Invalid Notion table row response');
    data.cells.forEach(richText);
  } else if (type === 'equation') {
    if (!record(data) || typeof data.expression !== 'string')
      throw Error('Invalid Notion equation response');
  } else if (
    ['image', 'file', 'pdf', 'video', 'audio', 'bookmark', 'embed', 'link_preview'].includes(type)
  ) {
    if (!record(data) || !nonempty(data.external?.url ?? data.file?.url ?? data.url))
      throw Error('Invalid Notion media response');
  } else if (
    ['divider', 'column', 'column_list', 'table', 'synced_block'].includes(type) &&
    !record(data)
  )
    throw Error('Invalid Notion block container response');
}
/** @param {any} data @param {string|null} cursor @param {'block'|'page'} kind @param {string[]} seen */
export function notionList(data, cursor = null, kind = 'block', seen = []) {
  if (
    !record(data) ||
    !Array.isArray(data.results) ||
    typeof data.has_more !== 'boolean' ||
    (data.object !== undefined && data.object !== 'list')
  )
    throw Error('Invalid Notion list response');
  const next = data.next_cursor;
  if (data.has_more ? !nonempty(next) || next === cursor || seen.includes(next) : next != null)
    throw Error('Invalid Notion pagination cursor response');
  for (const item of data.results) {
    if (!record(item) || !nonempty(item.id)) throw Error('Invalid Notion result response');
    if (kind === 'page') notionPage(item);
    else if (
      !nonempty(item.type) ||
      (item.has_children !== undefined && typeof item.has_children !== 'boolean') ||
      (item.type === 'child_page' &&
        (!record(item.child_page) || typeof item.child_page.title !== 'string'))
    )
      throw Error('Invalid Notion block response');
    if (kind === 'block') blockContent(item);
  }
  return { results: data.results, cursor: data.has_more ? next : null };
}
/** @param {any} page @param {string|null} expectedId */
export function notionPage(page, expectedId = null) {
  if (
    !record(page) ||
    !nonempty(page.id) ||
    !record(page.properties) ||
    typeof page.last_edited_time !== 'string' ||
    !Number.isFinite(Date.parse(page.last_edited_time)) ||
    (page.object !== undefined && page.object !== 'page') ||
    (expectedId !== null &&
      page.id.replaceAll('-', '').toLowerCase() !== expectedId.replaceAll('-', '').toLowerCase()) ||
    ['archived', 'in_trash'].some(
      (key) => page[key] !== undefined && typeof page[key] !== 'boolean'
    )
  )
    throw Error('Invalid Notion page response');
  for (const property of Object.values(page.properties)) {
    if (
      !record(property) ||
      typeof property.type !== 'string' ||
      (property.type === 'title' &&
        (!Array.isArray(property.title) ||
          property.title.some(
            (/** @type {any} */ rich) =>
              !record(rich) ||
              (typeof rich.plain_text !== 'string' && typeof rich.text?.content !== 'string')
          )))
    )
      throw Error('Invalid Notion page properties response');
  }
  return page;
}
/** @param {any} data @param {string} expectedId */
export function notionMarkdown(data, expectedId) {
  if (
    !record(data) ||
    typeof data.markdown !== 'string' ||
    typeof data.truncated !== 'boolean' ||
    !Array.isArray(data.unknown_block_ids) ||
    data.unknown_block_ids.some(
      (/** @type {any} */ id) =>
        typeof id !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)
    ) ||
    (data.object !== undefined && data.object !== 'page_markdown') ||
    (data.id !== undefined && data.id !== expectedId) ||
    (data.warnings !== undefined &&
      (!Array.isArray(data.warnings) ||
        data.warnings.some(
          (/** @type {any} */ w) =>
            !record(w) || typeof w.code !== 'string' || typeof w.message !== 'string'
        )))
  )
    throw Error('Invalid Notion Markdown response');
  return data;
}
