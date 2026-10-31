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
  const fetchImpl = vi.fn(async () =>
    Response.json({ markdown: 'New', unknown_block_ids: [], truncated: false })
  );
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
