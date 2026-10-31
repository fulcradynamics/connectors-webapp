import { it, expect, vi } from 'vitest';
import { FulcraClient } from '../fulcra.js';
it('reads the exact latest working-file version and retains intervening version identities', async () => {
  const fetchImpl = vi.fn(async (url) =>
    String(url).endsWith('/download')
      ? new Response('latest body')
      : Response.json({
          files: [
            {
              id: 'old',
              path: '/sync',
              name: 'doc.md',
              state: 'uploaded',
              created_at: '2026-10-30T00:00:00Z'
            },
            {
              id: 'new',
              path: '/sync',
              name: 'doc.md',
              state: 'uploaded',
              created_at: '2026-10-31T00:00:00Z'
            },
            { id: 'foreign', path: '/other', name: 'doc.md', state: 'uploaded' },
            { id: 'unuploaded', path: '/sync', name: 'doc.md', state: 'pending' }
          ]
        })
  );
  const client = new FulcraClient({
    endpoint: 'https://api.example/',
    accessToken: 'test',
    fetchImpl
  });
  const latest = await client.latestFile('/sync/doc.md');
  if (!latest) throw Error('Expected a working file');
  expect(latest.id).toBe('new');
  expect(latest.content).toBe('latest body');
  expect(latest.versions.map((/** @type {any} */ v) => v.id)).toEqual(['new', 'old']);
  expect(String(fetchImpl.mock.calls[1][0])).toContain('/new/download');
});
it('bounds working-file listings and content rather than treating absence as deletion', async () => {
  const client = new FulcraClient({
    endpoint: 'https://api.example/',
    accessToken: 'test',
    fetchImpl: async () => Response.json({ files: [] })
  });
  expect(await client.latestFile('/sync/missing.md')).toBe(null);
  client.fetch = async () =>
    Response.json({ files: Array.from({ length: 501 }, (_, i) => ({ id: i })) });
  await expect(client.listFiles('/sync')).rejects.toThrow(/capacity/i);
});
