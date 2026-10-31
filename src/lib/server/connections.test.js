import { it, expect, vi } from 'vitest';
import { validateConfig, previewConnection, enableConnection } from './connections.js';
const config = {
  resources: ['selected'],
  backfillSince: '2026-10-01T00:00:00Z',
  intervalSeconds: 300,
  route: { mode: 'file', folder: '/connectors/test' }
};
it('requires discovered sources and rejects invalid intervals or secret-bearing config', () => {
  expect(() => validateConfig({ ...config, intervalSeconds: 1 }, ['selected'], 'owner')).toThrow(
    /interval/i
  );
  expect(() =>
    validateConfig({ ...config, resources: ['unmatched'] }, ['selected'], 'owner')
  ).toThrow(/source/i);
  expect(() => validateConfig({ ...config, token: 'private' }, ['selected'], 'owner')).toThrow(
    /configuration/i
  );
  expect(validateConfig(config, ['selected'], 'owner').route.ownerId).toBe('owner');
});
it('preview reads a bounded source page without sink writes, jobs, or checkpoint commits', async () => {
  const adapter = {
    readPage: vi.fn().mockResolvedValue({
      changes: [
        {
          id: 'one',
          version: 'v1',
          timestamp: '2026-10-01T00:00:00Z',
          payload: { title: 'Preview' }
        }
      ]
    })
  };
  const result = await previewConnection(
    { id: 'connection', connector: 'test', account_id: 'account', config },
    adapter,
    {},
    'owner'
  );
  expect(result.outputs[0].record.payload.title).toBe('Preview');
  expect(result.writesPerformed).toBe(false);
  expect(adapter.readPage).toHaveBeenCalledWith(expect.objectContaining({ checkpoint: null }));
});
it('enable requires explicit preview confirmation and a separately enrolled background grant', async () => {
  const store = {
    getGrant: vi.fn().mockResolvedValue(null),
    changeGeneration: vi.fn(),
    enqueue: vi.fn()
  };
  await expect(enableConnection(store, 'id', false, {})).rejects.toThrow(/preview/i);
  await expect(enableConnection(store, 'id', true, {})).rejects.toThrow(/authorization/i);
  expect(store.enqueue).not.toHaveBeenCalled();
});
it('unchanged and interval-only edits preserve progress and revision identity', async () => {
  const { configurationUpdate } = await import('./connections.js');
  const old = { ...config, routeVersion: 4, route: { ...config.route, ownerId: 'owner' } };
  const unchanged = configurationUpdate(old, { ...old }, ['selected'], 'owner');
  expect(unchanged.changed).toBe(false);
  expect(unchanged.resetCheckpoint).toBe(false);
  const interval = configurationUpdate(
    old,
    { ...old, intervalSeconds: 600 },
    ['selected'],
    'owner'
  );
  expect(interval.config.routeVersion).toBe(4);
  expect(interval.resetCheckpoint).toBe(false);
  const moved = configurationUpdate(
    old,
    { ...old, route: { ...old.route, folder: '/new' } },
    ['selected'],
    'owner'
  );
  expect(moved.config.routeVersion).toBe(5);
  expect(moved.resetCheckpoint).toBe(true);
});

it('accepts 23 discovered pages and reports the bounded selection limit separately', () => {
  const pages = Array.from({ length: 51 }, (_, i) => `page-${i}`);
  expect(
    validateConfig({ ...config, resources: pages.slice(0, 23) }, pages, 'owner').resources
  ).toHaveLength(23);
  expect(
    validateConfig({ ...config, resources: pages.slice(0, 50) }, pages, 'owner').resources
  ).toHaveLength(50);
  expect(() => validateConfig({ ...config, resources: pages }, pages, 'owner')).toThrow(
    /at most 50 sources/i
  );
  expect(() => validateConfig({ ...config, resources: ['not-shared'] }, pages, 'owner')).toThrow(
    /discovered sources/i
  );
});
it('requires an explicit selected parent and file output for two-way configuration', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const input = { ...config, resources: [id], twoWay: { enabled: true, parentId: id } };
  expect(validateConfig(input, [id], 'owner').twoWay?.parentId).toBe(id);
  expect(() =>
    validateConfig(
      { ...input, twoWay: { enabled: true, parentId: '22222222-2222-4222-8222-222222222222' } },
      [id],
      'owner'
    )
  ).toThrow(/parent/i);
  expect(() =>
    validateConfig({ ...input, route: { mode: 'record', recordType: 'Event/test' } }, [id], 'owner')
  ).toThrow(/file/i);
  expect(() =>
    validateConfig(
      { ...input, twoWay: { enabled: true, parentId: id, token: 'forbidden' } },
      [id],
      'owner'
    )
  ).toThrow(/configuration/i);
});
it('previews two-way Markdown paths without any mutation or sink writes', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const adapter = {
    readDocument: vi.fn(async () => ({
      supported: true,
      document: { title: 'Demo', markdown: 'Hello', archived: false }
    })),
    readPage: vi.fn(),
    setBody: vi.fn()
  };
  const result = await previewConnection(
    {
      id: '33333333-3333-4333-8333-333333333333',
      config: { ...config, resources: [id], twoWay: { enabled: true, parentId: id } }
    },
    adapter,
    {},
    'owner'
  );
  expect(result.writesPerformed).toBe(false);
  expect(result.outputs[0].path).toContain('/live/33333333-3333-4333-8333-333333333333/');
  expect(adapter.readPage).not.toHaveBeenCalled();
  expect(adapter.setBody).not.toHaveBeenCalled();
});
