import { it, expect, vi } from 'vitest';
import { freshState } from './state.js';
import { seal } from '../secrets.js';
import { advanceWorker } from './worker.js';
const crypto = { key: Buffer.alloc(32, 7).toString('base64'), keyId: 'v1' };
it('routes opted-in Notion connections through persisted two-way phases without changing other adapters', async () => {
  const state = freshState('deployment', 'owner');
  state.grants.fulcra = {
    status: 'ready',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    encrypted: seal({ access_token: 'synthetic' }, 'deployment:owner:fulcra', crypto)
  };
  const id = '33333333-3333-4333-8333-333333333333',
    parentId = '11111111-1111-4111-8111-111111111111';
  state.connections[id] = {
    id,
    connector: 'notion',
    status: 'ready',
    generation: 1,
    nextDue: 0,
    config: {
      resources: [parentId],
      route: { mode: 'file', folder: '/notion' },
      intervalSeconds: 60,
      twoWay: { enabled: true, parentId }
    }
  };
  const children = vi.fn(async () => ({ pages: [], cursor: null }));
  const legacy = vi.fn(async () => {
    throw Error('Legacy reader must not run');
  });
  const deps = {
    crypto,
    provider: async () => ({}),
    client: {},
    notion: { children },
    adapters: { notion: { readPage: legacy } }
  };
  await advanceWorker(state, deps);
  await advanceWorker(state, deps);
  expect(children).toHaveBeenCalledTimes(1);
  expect(legacy).not.toHaveBeenCalled();
  expect(state.grants['notion-sync:' + id]).toBeTruthy();
  expect(state.connections[id].twoWayStatus.mapped).toBe(1);
});
