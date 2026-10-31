import { it, expect, vi } from 'vitest';
const { start, getRun } = vi.hoisted(() => ({ start: vi.fn(), getRun: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({
  env: {
    CONNECTORS_BACKEND: 'workflow',
    CONNECTORS_DEPLOYMENT_ID: 'test',
    OWNER_USER_ID: 'owner',
    CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64')
  }
}));
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_FULCRA_API_ENDPOINT: 'https://api.example/' }
}));
vi.mock('../owner.js', () => ({
  requireOwner: async () => ({ userId: 'owner', accessToken: 'token' })
}));
vi.mock('workflow/api', () => ({
  start,
  getRun,
  getHookByToken: vi.fn(async () => {
    throw Error('missing');
  })
}));
vi.mock('../fulcra.js', () => ({
  FulcraClient: class {
    async readFile() {
      return '';
    }
  }
}));
import { nativeHTTP, readSnapshot } from './http.js';
it('missing marker on ordinary setup fails closed without starting an empty controller', async () => {
  const request = new Request('https://app.example/api/setup');
  await expect(
    nativeHTTP({ request, url: new URL(request.url), cookies: {} })
  ).rejects.toMatchObject({ status: 503 });
  expect(start).not.toHaveBeenCalled();
});
it('does not expose stale-snapshot canary cancellation', async () => {
  const request = new Request('https://app.example/api/native/canary/stop', { method: 'POST' });
  expect(await nativeHTTP({ request, url: new URL(request.url), cookies: {} })).toBeUndefined();
  expect(start).not.toHaveBeenCalled();
});

it('accepts a slow but valid retained snapshot instead of timing out after eight seconds', async () => {
  vi.useFakeTimers();
  try {
    const snapshot = {
      view: { connections: { retained: true } },
      server: { encrypted: 'retained' }
    };
    const reader = {
      read: () => new Promise((resolve) => setTimeout(() => resolve({ value: snapshot }), 9000)),
      cancel: vi.fn(async () => {})
    };
    getRun.mockReturnValue({ getReadable: () => ({ getReader: () => reader }) });
    const assertion = expect(readSnapshot('retained-run')).resolves.toEqual(snapshot);
    await vi.advanceTimersByTimeAsync(9001);
    await assertion;
    expect(reader.cancel).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

it('fails closed with a retryable status when retained state cannot be read', async () => {
  vi.useFakeTimers();
  try {
    const reader = { read: () => new Promise(() => {}), cancel: vi.fn(async () => {}) };
    getRun.mockReturnValue({ getReadable: () => ({ getReader: () => reader }) });
    const assertion = expect(readSnapshot('retained-run')).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(20001);
    await assertion;
    expect(reader.cancel).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
