import { it, expect, vi } from 'vitest';
import { createNotion } from './notion.js';
import { previewConnection } from '../connections.js';
const connection = { config: { resources: ['root'], backfillSince: '2026-01-01T00:00:00Z' } };
/** @param {any} fetchImpl @param {any} checkpoint */
const read = (fetchImpl, checkpoint = null) =>
  createNotion({ fetchImpl }).readPage({
    connection,
    credential: { token: 'test' },
    checkpoint,
    deadline: Date.now() + 10000
  });
it('persists nested traversal and pagination instead of treating search metadata as content', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        id: 'root',
        last_edited_time: '2026-10-01T00:00:00Z',
        properties: { Name: { type: 'title', title: [{ plain_text: 'Root' }] } }
      })
    )
    .mockResolvedValueOnce(
      Response.json({
        results: [
          {
            id: 'child',
            type: 'toggle',
            has_children: true,
            toggle: { rich_text: [{ plain_text: 'Section' }] }
          }
        ],
        has_more: true,
        next_cursor: 'next'
      })
    );
  const page = await read(fetchImpl);
  expect(page.changes).toEqual([]);
  expect(page.candidateCheckpoint.frontier).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'root', cursor: 'next' }),
      expect.objectContaining({ id: 'child' })
    ])
  );
  expect(page.continuation).toBe(true);
  expect(fetchImpl.mock.calls[0][1].headers['Notion-Version']).toBe('2026-03-11');
});
it('renders unsupported blocks visibly and only emits a document after traversal completes', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ id: 'root', last_edited_time: '2026-10-01T00:00:00Z', properties: {} })
    )
    .mockResolvedValueOnce(
      Response.json({
        results: [{ id: 'block', type: 'future_unknown', has_children: false }],
        has_more: false,
        next_cursor: null
      })
    );
  const page = await read(fetchImpl);
  expect(page.changes[0].files[0].content).toContain('[Unsupported block: future_unknown]');
  expect(page.changes[0].payload.complete).toBe(true);
});
it('refuses traversal state outside selected roots and records lost access explicitly', async () => {
  const fetchImpl = vi.fn();
  await expect(read(fetchImpl, { root: 'other', frontier: [{ id: 'other' }] })).rejects.toThrow(
    /selected root/
  );
  expect(fetchImpl).not.toHaveBeenCalled();
  const page = await read(async () => Response.json({}, { status: 404 }));
  expect(page.changes[0].operation).toBe('access_lost');
});

it('previews a discovered 23-page selection and retains a bounded source guard', async () => {
  const resources = Array.from({ length: 23 }, (_, i) => `page-${i}`);
  const fetchImpl = vi.fn(async (url) =>
    String(url).includes('/pages/')
      ? Response.json({
          id: resources[0],
          properties: {},
          last_edited_time: '2026-10-01T00:00:00Z'
        })
      : Response.json({ results: [], has_more: false })
  );
  const selected = {
    id: 'connection',
    connector: 'notion',
    account_id: 'account',
    config: { ...connection.config, resources, route: { mode: 'file', folder: '/test' } }
  };
  const preview = await previewConnection(
    selected,
    createNotion({ fetchImpl }),
    { token: 'test' },
    'owner'
  );
  expect(preview.complete).toBe(true);
  expect(preview.writesPerformed).toBe(false);
  expect(preview.outputs[0].record.payload.id).toBe('page-0');
  await expect(
    createNotion({ fetchImpl }).readPage({
      connection: { config: { resources: Array.from({ length: 51 }, (_, i) => `page-${i}`) } },
      credential: { token: 'test' },
      checkpoint: null,
      deadline: Date.now() + 10000
    })
  ).rejects.toThrow(/required_configuration/);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
