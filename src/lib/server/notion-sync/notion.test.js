import { it, expect, vi } from 'vitest';
import { createNotionPages, markerTitle } from './notion.js';
const id = '11111111-1111-4111-8111-111111111111';
const local = '22222222-2222-4222-8222-222222222222';
const credential = { token: 'synthetic' };
const page = (extra = {}) => ({
  id,
  properties: { Name: { id: 'title', type: 'title', title: [{ plain_text: 'Demo' }] } },
  last_edited_time: '2026-10-31T00:00:00Z',
  in_trash: false,
  ...extra
});
it('reads Markdown v2 and flags incomplete or unsupported representations', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(Response.json(page()))
    .mockResolvedValueOnce(
      Response.json({ markdown: '## Hello\n', truncated: false, unknown_block_ids: [] })
    );
  const result = await createNotionPages({ fetchImpl }).read(id, credential);
  expect(result.document).toEqual({ title: 'Demo', markdown: '## Hello', archived: false });
  expect(result.supported).toBe(true);
  expect(String(fetchImpl.mock.calls[1][0])).toContain('markdown_version=v2');
  expect(fetchImpl.mock.calls[0][1].headers['Notion-Version']).toBe('2026-03-11');
  const incomplete = createNotionPages({
    fetchImpl: async (url) =>
      Response.json(
        String(url).includes('/markdown')
          ? { markdown: '<unknown>…</unknown>', truncated: true, unknown_block_ids: [local] }
          : page()
      )
  });
  expect((await incomplete.read(id, credential)).supported).toBe(false);
});
it('uses guarded body edits and explicit title/archive writes without child deletion', async () => {
  const fetchImpl = vi.fn(async (/** @type {any} */ _url, /** @type {any} */ _init) => {
    void _url;
    void _init;
    return Response.json({ markdown: 'New', unknown_block_ids: [], truncated: false });
  });
  const adapter = createNotionPages({ fetchImpl });
  await adapter.setBody(id, 'Old', 'New', credential);
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
    type: 'update_content',
    markdown_version: 'v2',
    update_content: {
      content_updates: [{ old_str: 'Old', new_str: 'New' }],
      allow_deleting_content: false
    }
  });
  await adapter.setBody(id, '', 'New', credential);
  expect(JSON.parse(fetchImpl.mock.calls[1][1].body).type).toBe('replace_content');
  await adapter.setTitle(id, 'title', 'Renamed', credential);
  expect(JSON.parse(fetchImpl.mock.calls[2][1].body).properties.title.title[0].text.content).toBe(
    'Renamed'
  );
  await adapter.setArchived(id, true, credential);
  expect(JSON.parse(fetchImpl.mock.calls[3][1].body)).toEqual({ in_trash: true });
});
it('creates a deterministic recovery marker and enumerates actual page children', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(Response.json(page({ parent: { page_id: local } })))
    .mockResolvedValueOnce(
      Response.json({
        results: [
          { id, type: 'child_page', child_page: { title: markerTitle(local) } },
          { id: local, type: 'child_database' }
        ],
        has_more: false
      })
    );
  const adapter = createNotionPages({ fetchImpl });
  expect((await adapter.createMarker(local, local, credential)).id).toBe(id);
  const request = JSON.parse(fetchImpl.mock.calls[0][1].body);
  expect(request.parent.page_id).toBe(local);
  expect(request.properties.title.title[0].text.content).toBe(markerTitle(local));
  expect((await adapter.children(local, credential)).pages).toEqual([
    { id, title: markerTitle(local) }
  ]);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  await expect(adapter.read('../foreign', credential)).rejects.toThrow(/page ID/);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it('marks a trashed page body as unavailable instead of authoritative empty content', async () => {
  const adapter = createNotionPages({
    fetchImpl: async (url) =>
      Response.json(
        String(url).includes('/markdown')
          ? { markdown: '', truncated: false, unknown_block_ids: [] }
          : page({ in_trash: true })
      )
  });
  const result = await adapter.read(id, credential);
  expect(result.document.archived).toBe(true);
  expect(result.bodyUnavailable).toBe(true);
});

it('uses a complete block-preserving projection for incomplete Markdown and patches only editable text', async () => {
  const opaque = '33333333-3333-4333-8333-333333333333';
  const block = {
    id: local,
    type: 'paragraph',
    parent: { type: 'page_id', page_id: id },
    has_children: false,
    paragraph: {
      rich_text: [{ type: 'text', text: { content: 'Original', link: null }, annotations: {} }],
      color: 'default'
    }
  };
  const protectedBlock = {
    id: opaque,
    type: 'embed',
    parent: { type: 'page_id', page_id: id },
    has_children: false,
    embed: { url: 'https://example.invalid/embed' }
  };
  const writes = /** @type {any[]} */ ([]);
  const fetchImpl = vi.fn(async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    if (path === `/v1/pages/${id}`) return Response.json(page());
    if (path.endsWith('/markdown'))
      return Response.json({
        markdown: 'Original\n<unknown/>',
        truncated: true,
        unknown_block_ids: [opaque]
      });
    if (path === `/v1/blocks/${id}/children`)
      return Response.json({ results: [block, protectedBlock], has_more: false });
    if (path === `/v1/blocks/${local}`) {
      if (init.method === 'PATCH') writes.push(JSON.parse(init.body));
      return Response.json(block);
    }
    throw Error('Unexpected path ' + path);
  });
  const adapter = createNotionPages({ fetchImpl }),
    remote = await adapter.read(id, credential);
  expect(remote.supported).toBe(true);
  if (!remote.managed) throw Error('Expected managed projection');
  expect(remote.managed.blocks[1].editable).toBe(false);
  const desired = structuredClone(remote.managed);
  desired.blocks[0].texts = ['Edited'];
  const { encodeManaged } = await import('../../notion-managed.js');
  await adapter.setBody(
    id,
    remote.document.markdown,
    encodeManaged(desired),
    credential,
    undefined,
    remote
  );
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ paragraph: { rich_text: [{ text: { content: 'Edited' } }] } });
  expect(JSON.stringify(writes)).not.toMatch(/children|embed/);
});
it('keeps a literal reserved managed document in provider Markdown from authorizing block updates', async () => {
  const adapter = createNotionPages({
    fetchImpl: async (url) =>
      Response.json(
        String(url).includes('/markdown')
          ? {
              markdown: '<!-- fulcra-notion-managed:1 -->\n```json\n{}\n```',
              truncated: false,
              unknown_block_ids: []
            }
          : page()
      )
  });
  const remote = await adapter.read(id, credential);
  expect(remote.supported).toBe(false);
  expect(remote.unsupportedReason).toMatch(/reserved/i);
});

it('stops a provider read before issuing requests after its deadline', async () => {
  let calls = 0;
  const api = createNotionPages({
    fetchImpl: async () => {
      calls++;
      return new Response('{}');
    }
  });
  await expect(api.read(id, { token: 'fixture' }, Date.now() - 1)).rejects.toThrow(/deadline/i);
  expect(calls).toBe(0);
});

it('reads actual current parent metadata for page-scope checks', async () => {
  const api = createNotionPages({
    fetchImpl: async (url) =>
      Response.json(
        String(url).includes('/markdown')
          ? { markdown: 'Text', truncated: false, unknown_block_ids: [] }
          : page({ parent: { type: 'page_id', page_id: local } })
      )
  });
  expect((await api.read(id, credential)).parentId).toBe(local);
});

it('quarantines a moved child from metadata without reading its content', async () => {
  const fetchImpl = vi.fn(async (/** @type {any} */ url) => {
    void url;
    return Response.json(page({ parent: { type: 'page_id', page_id: local } }));
  });
  const api = createNotionPages({ fetchImpl });
  await expect(api.read(id, credential, Date.now() + 25000, id)).rejects.toMatchObject({
    code: 'NOTION_SCOPE_MOVED'
  });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(String(fetchImpl.mock.calls[0][0])).toMatch(new RegExp('/pages/' + id + '$'));
});
