import { it, expect, vi } from 'vitest';
import { readManagedCapsule, applyManagedEdit, mutableBlock } from './managed.js';
import { encodeManaged, planManagedEdit } from '$lib/notion-managed.js';
const page = '11111111-1111-4111-8111-111111111111',
  text = '22222222-2222-4222-8222-222222222222',
  opaque = '33333333-3333-4333-8333-333333333333',
  child = '44444444-4444-4444-8444-444444444444';
const run = (/** @type {string} */ content) => ({
  type: 'text',
  text: { content, link: null },
  annotations: { bold: true },
  plain_text: content
});
/** @returns {any} */
const block = (
  /** @type {string} */ id,
  /** @type {string} */ type,
  /** @type {any} */ payload,
  /** @type {any} */ extra = {}
) => ({
  id,
  type,
  parent: { type: 'page_id', page_id: page },
  has_children: false,
  [type]: payload,
  ...extra
});
const paragraph = () => block(text, 'paragraph', { rich_text: [run('Hello')], color: 'default' });
const template = () =>
  block(opaque, 'template', { rich_text: [run('Do not rebuild')] }, { has_children: true });
function fixture() {
  const nodes = /** @type {Map<string,any>} */ (
    new Map([
      [text, paragraph()],
      [opaque, template()],
      [
        child,
        block(
          child,
          'paragraph',
          { rich_text: [run('Template child')] },
          { parent: { type: 'block_id', block_id: opaque } }
        )
      ]
    ])
  );
  const writes = /** @type {any[]} */ ([]);
  const req = vi.fn(async (path, init = {}) => {
    if (path === `blocks/${page}/children?page_size=100`)
      return { data: { results: [nodes.get(text)], has_more: true, next_cursor: 'next' } };
    if (path === `blocks/${page}/children?page_size=100&start_cursor=next`)
      return { data: { results: [nodes.get(opaque)], has_more: false, next_cursor: null } };
    if (path === `blocks/${opaque}/children?page_size=100`)
      return { data: { results: [nodes.get(child)], has_more: false, next_cursor: null } };
    const id = path.split('/')[1];
    if (init.method === 'PATCH') {
      const body = JSON.parse(init.body);
      writes.push({ id, body });
      nodes.set(id, { ...nodes.get(id), ...body });
    }
    if (nodes.has(id)) return { data: structuredClone(nodes.get(id)) };
    throw Error('Unexpected request ' + path);
  });
  return { nodes, writes, req };
}
it('reads every cursor and protects complete opaque descendants while exposing leaf text', async () => {
  const f = fixture(),
    capsule = await readManagedCapsule(f.req, page);
  expect(capsule.blocks.map((b) => b.id)).toEqual([text, opaque]);
  expect(capsule.blocks[0]).toMatchObject({ editable: true, texts: ['Hello'] });
  expect(capsule.blocks[1]).toMatchObject({ editable: false });
  expect(JSON.stringify(capsule.blocks[1].snapshot)).toContain('Template child');
  expect(f.req).toHaveBeenCalledTimes(3);
});
it('patches one owned leaf without children or opaque writes and recognizes deterministic intermediate', async () => {
  const f = fixture(),
    capsule = await readManagedCapsule(f.req, page),
    before = encodeManaged(capsule),
    next = structuredClone(capsule);
  next.blocks[0].texts = ['Changed'];
  const after = encodeManaged(next);
  const result = await applyManagedEdit(f.req, page, before, after, capsule);
  expect(result).toBe(planManagedEdit(before, after)?.intermediate);
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0].id).toBe(text);
  expect(f.writes[0].body).toMatchObject({
    paragraph: {
      rich_text: [
        { type: 'text', text: { content: 'Changed', link: null }, annotations: { bold: true } }
      ]
    }
  });
  expect(f.nodes.get(opaque)).toEqual(template());
  expect(f.nodes.get(child).paragraph.rich_text[0].text.content).toBe('Template child');
});
it('rejects changed protected state, forged page binding and a third target value before any PATCH', async () => {
  const f = fixture(),
    c = await readManagedCapsule(f.req, page),
    before = encodeManaged(c),
    next = structuredClone(c);
  next.blocks[0].texts = ['New'];
  const after = encodeManaged(next);
  const changed = structuredClone(c);
  changed.blocks[1].snapshot.changed = true;
  await expect(applyManagedEdit(f.req, page, before, after, changed)).rejects.toThrow(
    /changed|projection/i
  );
  await expect(applyManagedEdit(f.req, child, before, after, c)).rejects.toThrow(/page|binding/i);
  f.nodes.set(
    text,
    block(text, 'paragraph', { rich_text: [run('Other editor')], color: 'default' })
  );
  await expect(applyManagedEdit(f.req, page, before, after, c)).rejects.toThrow(/changed/i);
  expect(f.writes).toHaveLength(0);
});
it('fails closed on repeated cursors, capacity and missing parent scope', async () => {
  const f = fixture();
  await expect(readManagedCapsule(f.req, page, { maxNodes: 1 })).rejects.toThrow(/bound|capacity/i);
  const repeat = async () => ({ data: { results: [], has_more: true, next_cursor: 'same' } });
  await expect(readManagedCapsule(repeat, page)).rejects.toThrow(/cursor/i);
  const foreign = async () => ({
    data: {
      results: [
        block(
          text,
          'paragraph',
          { rich_text: [run('X')] },
          { parent: { type: 'page_id', page_id: child } }
        )
      ],
      has_more: false
    }
  });
  await expect(readManagedCapsule(foreign, page)).rejects.toThrow(/scope|parent/i);
});
it('protects nontext rich text, containers and stable source snapshots without timestamp churn', async () => {
  const p = paragraph();
  p.paragraph.rich_text = [{ type: 'mention', mention: { type: 'user', user: { id: child } } }];
  expect(mutableBlock(p)).toBeNull();
  const f = fixture(),
    a = await readManagedCapsule(f.req, page);
  f.nodes.get(opaque).last_edited_time = '2099-01-01T00:00:00Z';
  expect(await readManagedCapsule(f.req, page)).toEqual(a);
  f.nodes.get(child).paragraph.rich_text[0].text.content = 'A real child change';
  expect(encodeManaged(await readManagedCapsule(f.req, page))).not.toBe(encodeManaged(a));
});

it('normalizes empty/default styles and adjacent equal-style text so provider normalization does not invent conflicts', () => {
  const empty = paragraph();
  empty.paragraph.rich_text = [];
  expect(mutableBlock(empty).styles[0].annotations).toEqual({
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    code: false,
    color: 'default'
  });
  const split = paragraph();
  split.paragraph.rich_text = [run('Hel'), run('lo')];
  expect(mutableBlock(split).texts).toEqual(['Hello']);
});
