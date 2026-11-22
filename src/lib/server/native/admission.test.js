import { it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  start: vi.fn(async () => ({ runId: 'wrun_' + '1'.repeat(26) })),
  getRun: vi.fn(() => {
    throw Error('Snapshot unavailable');
  }),
  getHookByToken: vi.fn(() => {
    throw Error('Snapshot unavailable');
  })
}));
vi.mock('$env/dynamic/private', () => ({
  env: {
    CONNECTORS_BACKEND: 'workflow',
    CONNECTORS_DEPLOYMENT_ID: 'test',
    OWNER_USER_ID: 'owner',
    CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    CONNECTORS_NATIVE_ROOT_RUN_ID: 'wrun_' + '0'.repeat(26)
  }
}));
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_FULCRA_API_ENDPOINT: 'https://api.example/' }
}));
vi.mock('../owner.js', () => ({
  requireOwner: async () => ({ userId: 'owner', accessToken: 'synthetic' })
}));
vi.mock('workflow/api', () => mocks);
import { nativeHTTP } from './http.js';
it('admits authenticated document commands without depending on the dashboard snapshot', async () => {
  for (const method of ['GET', 'POST']) {
    const url = new URL(
      'https://app.example/api/connections/11111111-1111-4111-8111-111111111111/documents'
    );
    const request = new Request(url, {
      method,
      headers: { Origin: url.origin },
      ...(method === 'POST' ? { body: JSON.stringify({ operation: 'sync' }) } : {})
    });
    const response = await nativeHTTP({ url, request, cookies: {} });
    expect(response?.status).toBe(202);
    expect((await response?.json()).pending).toBe(true);
  }
  expect(mocks.start).toHaveBeenCalledTimes(2);
  expect(mocks.getRun).not.toHaveBeenCalled();
  expect(mocks.getHookByToken).not.toHaveBeenCalled();
});
