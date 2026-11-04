import { it, expect } from 'vitest';
import { createNotionPages } from './notion.js';
import { createNotion } from '../connectors/notion.js';
const id = '11111111-1111-4111-8111-111111111111';
const page = {
  id,
  properties: { title: { id: 'title', type: 'title', title: [] } },
  last_edited_time: '2026-11-04T00:00:00Z',
  archived: false,
  in_trash: false
};
const credential = { token: 'fixture' };
const malformedLists = [
  {},
  { results: [] },
  { has_more: false },
  { results: [], has_more: 'false' },
  { results: [], has_more: true, next_cursor: null },
  { results: [], has_more: true, next_cursor: '' },
  { results: [], has_more: true, next_cursor: 42 },
  { results: [], has_more: true, next_cursor: 'same' },
  { results: [null], has_more: false },
  { results: [{ id, type: 'child_page' }], has_more: false }
];
it.each(malformedLists)('rejects incomplete two-way children responses %j', async (data) => {
  const api = createNotionPages({ fetchImpl: async () => Response.json(data) });
  await expect(api.children(id, credential, 'same')).rejects.toThrow(
    /Notion|response|cursor|block/i
  );
});
it.each(malformedLists.slice(0, 9))(
  'rejects incomplete search and one-way traversal responses %j',
  async (data) => {
    const api = createNotion({
      fetchImpl: async (url) => Response.json(String(url).includes('/pages/') ? page : data)
    });
    await expect(api.listResources({ credential, cursor: 'same' })).rejects.toThrow();
    await expect(
      api.readPage({
        connection: { config: { resources: [id] } },
        credential,
        checkpoint: {
          index: 0,
          root: id,
          page,
          blocks: [],
          seen: [],
          frontier: [{ id, cursor: 'same' }]
        },
        deadline: Date.now() + 10000
      })
    ).rejects.toThrow();
  }
);
it('passes opaque next cursors unchanged and accepts a genuinely empty complete page', async () => {
  const api = createNotionPages({
    fetchImpl: async (url) =>
      Response.json(
        String(url).includes('/children')
          ? { results: [], has_more: false }
          : String(url).includes('/markdown')
            ? { markdown: '', truncated: false, unknown_block_ids: [] }
            : page
      )
  });
  expect(await api.children(id, credential)).toEqual({ pages: [], cursor: null });
  expect((await api.read(id, credential)).document.markdown).toBe('');
  const opaque = 'opaque/+?=cursor';
  const next = createNotionPages({
    fetchImpl: async () => Response.json({ results: [], has_more: true, next_cursor: opaque })
  });
  expect((await next.children(id, credential)).cursor).toBe(opaque);
});
it.each([
  {},
  { markdown: null },
  { markdown: '', truncated: 'false' },
  { markdown: '', truncated: false, unknown_block_ids: 'bad' }
])(
  'does not convert malformed Markdown %j into an editable empty managed page',
  async (markdown) => {
    const api = createNotionPages({
      fetchImpl: async (url) =>
        Response.json(
          String(url).includes('/children')
            ? { results: [], has_more: false }
            : String(url).includes('/markdown')
              ? markdown
              : page
        )
    });
    await expect(api.read(id, credential)).rejects.toThrow(/Notion.*response/i);
  }
);
it.each([
  {},
  { ...page, id: '22222222-2222-4222-8222-222222222222' },
  { ...page, last_edited_time: undefined },
  { ...page, properties: null }
])('rejects incomplete or mismatched page metadata %j', async (metadata) => {
  const api = createNotionPages({
    fetchImpl: async (url) =>
      Response.json(
        String(url).includes('/markdown')
          ? { markdown: '', truncated: false, unknown_block_ids: [] }
          : metadata
      )
  });
  await expect(api.read(id, credential)).rejects.toThrow(/Notion.*response/i);
});
it('rejects longer cursor cycles using retained discovery cursor history', async () => {
  const api = createNotionPages({
    fetchImpl: async () => Response.json({ results: [], has_more: true, next_cursor: 'earlier' })
  });
  await expect(
    api.children(id, credential, 'current', Date.now() + 10000, ['earlier', 'current'])
  ).rejects.toThrow(/cursor/i);
});
it('does not traverse unknown child completeness as a leaf', async () => {
  const api = createNotion({
    fetchImpl: async () =>
      Response.json({ results: [{ id, type: 'future_block' }], has_more: false })
  });
  await expect(
    api.readPage({
      connection: { config: { resources: [id] } },
      credential,
      checkpoint: { root: id, page, blocks: [], seen: [], frontier: [{ id, cursor: null }] },
      deadline: Date.now() + 10000
    })
  ).rejects.toThrow(/children response/i);
});
it.each([
  { id, type: 'paragraph', has_children: false },
  { id, type: 'paragraph', has_children: false, paragraph: { rich_text: [{}] } },
  { id, type: 'to_do', has_children: false, to_do: { rich_text: [] } },
  { id, type: 'table_row', has_children: false, table_row: { cells: [{}] } }
])('keeps malformed known block content %j from one-way completion', async (block) => {
  const api = createNotion({
    fetchImpl: async (url) =>
      Response.json(String(url).includes('/pages/') ? page : { results: [block], has_more: false })
  });
  await expect(
    api.readPage({
      connection: { config: { resources: [id] } },
      credential,
      checkpoint: null,
      deadline: Date.now() + 10000
    })
  ).rejects.toThrow(/Notion.*response/i);
});
