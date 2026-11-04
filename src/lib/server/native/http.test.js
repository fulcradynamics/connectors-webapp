import { it, expect, vi } from 'vitest';
import { unseal } from '../secrets.js';
const { start, getRun, getHookByToken, requireOwner, readMarker } = vi.hoisted(() => ({
  start: vi.fn(),
  getRun: vi.fn(),
  getHookByToken: vi.fn(
    /** @returns {Promise<any>} */ async () => {
      throw Error('missing');
    }
  ),
  requireOwner: vi.fn(async () => ({ userId: 'owner', accessToken: 'synthetic-owner-token' })),
  readMarker: vi.fn(async () => '')
}));
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
vi.mock('../owner.js', () => ({ requireOwner }));
vi.mock('workflow/api', () => ({
  start,
  getRun,
  getHookByToken
}));
vi.mock('../fulcra.js', () => ({
  FulcraClient: class {
    async readFile() {
      return readMarker();
    }
  }
}));
import { nativeHTTP, readSnapshot, nativeBodyLimit } from './http.js';
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
    const getReadable = vi.fn(() => ({ getReader: () => reader, getTailIndex: async () => 42 }));
    getRun.mockReturnValue({ getReadable });
    const assertion = expect(readSnapshot('retained-run')).resolves.toEqual(snapshot);
    await vi.advanceTimersByTimeAsync(9001);
    await assertion;
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(getReadable).toHaveBeenCalledWith({ namespace: 'state', startIndex: 42 });
  } finally {
    vi.useRealTimers();
  }
});

it('fails closed with a retryable status when retained state cannot be read', async () => {
  vi.useFakeTimers();
  try {
    const reader = { read: () => new Promise(() => {}), cancel: vi.fn(async () => {}) };
    const getReadable = vi.fn(() => ({ getReader: () => reader, getTailIndex: async () => 42 }));
    getRun.mockReturnValue({ getReadable });
    const assertion = expect(readSnapshot('retained-run')).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(20001);
    await assertion;
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(getReadable).toHaveBeenCalledWith({ namespace: 'state', startIndex: 42 });
  } finally {
    vi.useRealTimers();
  }
});

it('does not start a late stream read after its metadata deadline expires', async () => {
  vi.useFakeTimers();
  try {
    const getReader = vi.fn();
    const getReadable = vi.fn(() => ({
      getReader,
      getTailIndex: () => new Promise((resolve) => setTimeout(() => resolve(42), 25000))
    }));
    getRun.mockReturnValue({ getReadable });
    const assertion = expect(readSnapshot('retained-run')).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(25001);
    await assertion;
    expect(getReader).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

const attioConnectionId = '11111111-1111-4111-8111-111111111111';
const notionConnectionId = '22222222-2222-4222-8222-222222222222';
const missingConnectionId = '33333333-3333-4333-8333-333333333333';
const controllerRunId = 'wrun_' + '0'.repeat(26);
const snapshotView = {
  connections: {
    [attioConnectionId]: { id: attioConnectionId, connector: 'attio' },
    [notionConnectionId]: { id: notionConnectionId, connector: 'notion' }
  }
};
const largeAttioConfig = JSON.stringify({
  resources: Array.from(
    { length: 1000 },
    (_, n) =>
      `44444444-4444-4444-8444-444444444444:55555555-5555-4555-8555-${String(n).padStart(12, '0')}`
  ),
  attio: { twoWay: true, includeNotes: false, writableAttributes: {} },
  route: { mode: 'file', folder: '/attio' },
  intervalSeconds: 300,
  backfillSince: '2026-10-03T00:00:00Z'
});
function readyController() {
  start.mockClear();
  getRun.mockClear();
  requireOwner.mockClear();
  readMarker.mockClear();
  requireOwner.mockResolvedValue({ userId: 'owner', accessToken: 'synthetic-owner-token' });
  readMarker.mockResolvedValue(
    JSON.stringify({ deploymentId: 'test', ownerId: 'owner', runId: controllerRunId })
  );
  getHookByToken.mockResolvedValue({ runId: controllerRunId });
  getRun.mockReturnValue({
    status: 'running',
    getReadable: () => ({
      getTailIndex: async () => 1,
      getReader: () => ({
        read: async () => ({ value: { view: snapshotView } }),
        cancel: async () => {}
      })
    })
  });
  start.mockResolvedValue({ runId: 'wrun_' + '1'.repeat(26) });
}
function configEvent(
  id = attioConnectionId,
  body = largeAttioConfig,
  origin = 'https://app.example'
) {
  const request = new Request(`https://app.example/api/connections/${id}`, {
    method: 'PUT',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body
  });
  return { request, url: new URL(request.url), cookies: {} };
}

it('uses the larger body bound only for an exact PUT to an existing server-identified Attio connection', () => {
  const attioPath = `/api/connections/${attioConnectionId}`;
  expect(nativeBodyLimit(attioPath, 'PUT', snapshotView)).toBe(128000);
  expect(nativeBodyLimit(attioPath, 'POST', snapshotView)).toBe(32000);
  expect(nativeBodyLimit(attioPath, 'PUT', null)).toBe(32000);
  expect(nativeBodyLimit(`/api/connections/${notionConnectionId}`, 'PUT', snapshotView)).toBe(
    32000
  );
  expect(nativeBodyLimit(`/api/connections/${missingConnectionId}`, 'PUT', snapshotView)).toBe(
    32000
  );
  expect(nativeBodyLimit(attioPath + '/credentials', 'POST', snapshotView)).toBe(32000);
  expect(nativeBodyLimit(attioPath + '/documents', 'POST', snapshotView)).toBe(64000);
  expect(nativeBodyLimit('/api/webhooks/slack/fixture', 'POST', null)).toBe(128000);
});

it('admits a same-origin owner’s 1,000-record Attio config through the actual native command envelope', async () => {
  readyController();
  const event = configEvent();
  expect(Buffer.byteLength(largeAttioConfig)).toBeGreaterThan(64000);
  const response = await nativeHTTP(event);
  expect(response?.status).toBe(202);
  expect(start).toHaveBeenCalledOnce();
  expect(getRun).toHaveBeenCalledWith(controllerRunId);
  expect(requireOwner).toHaveBeenCalledOnce();
  const envelope = start.mock.calls[0][1][2];
  const admitted = unseal(envelope, 'test:owner:native-command', {
    key: Buffer.alloc(32, 7).toString('base64'),
    keyId: 'v1'
  });
  expect(admitted.body).toBe(largeAttioConfig);
  expect(JSON.parse(admitted.body).resources).toHaveLength(1000);
});

it.each([notionConnectionId, missingConnectionId])(
  'retains 32k admission for a large non-Attio or unknown connection %s',
  async (id) => {
    readyController();
    await expect(nativeHTTP(configEvent(id))).rejects.toMatchObject({ status: 413 });
    expect(start).not.toHaveBeenCalled();
  }
);

it('rejects an Attio config beyond 128k without starting a command', async () => {
  readyController();
  await expect(
    nativeHTTP(configEvent(attioConnectionId, 'x'.repeat(128001)))
  ).rejects.toMatchObject({ status: 413 });
  expect(start).not.toHaveBeenCalled();
});

it.each([401, 403])(
  'requires owner authorization (%s) before consulting a connection snapshot or reading a large config body',
  async (status) => {
    readyController();
    requireOwner.mockRejectedValueOnce(Object.assign(Error('Unauthorized'), { status }));
    const event = configEvent();
    await expect(nativeHTTP(event)).rejects.toMatchObject({ status });
    expect(event.request.bodyUsed).toBe(false);
    expect(getRun).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  }
);

it('rejects foreign-origin owner writes before reading the Attio body or snapshot', async () => {
  readyController();
  const event = configEvent(attioConnectionId, largeAttioConfig, 'https://other.example');
  await expect(nativeHTTP(event)).rejects.toMatchObject({ status: 403 });
  expect(event.request.bodyUsed).toBe(false);
  expect(getRun).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});

it('fails closed when the authenticated connection snapshot is unavailable instead of trusting submitted Attio config', async () => {
  readyController();
  getRun.mockReturnValue({
    status: 'running',
    getReadable: () => ({
      getTailIndex: async () => 1,
      getReader: () => ({ read: async () => ({ value: null }), cancel: async () => {} })
    })
  });
  const event = configEvent();
  await expect(nativeHTTP(event)).rejects.toMatchObject({ status: 503 });
  expect(event.request.bodyUsed).toBe(false);
  expect(start).not.toHaveBeenCalled();
});
