import { it, expect, vi } from 'vitest';
import { connectorRequest } from './connector-api.js';
it('waits for an applied operation and unwraps its original response', async () => {
  const replies = [
    new Response(JSON.stringify({ pending: true, statusUrl: '/api/native/operations/ref' }), {
      status: 202
    }),
    new Response(JSON.stringify({ done: false })),
    new Response(
      JSON.stringify({ done: true, httpStatus: 201, body: { connection: { id: 'one' } } })
    )
  ];
  const fetchImpl = vi.fn(async () => replies.shift());
  expect(
    await connectorRequest(
      '/api/connections',
      { method: 'POST' },
      { fetchImpl: /** @type {any} */ (fetchImpl), delay: async () => {} }
    )
  ).toEqual({ connection: { id: 'one' } });
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});
it('propagates operation errors instead of treating202 as success', async () => {
  const replies = [
    new Response(JSON.stringify({ pending: true, statusUrl: '/api/native/operations/ref' }), {
      status: 202
    }),
    new Response(JSON.stringify({ done: true, httpStatus: 403, body: { message: 'Denied' } }))
  ];
  await expect(
    connectorRequest(
      '/api/connections',
      { method: 'POST' },
      { fetchImpl: /** @type {any} */ (async () => replies.shift()), delay: async () => {} }
    )
  ).rejects.toThrow('Denied');
});
it('isolates saved completion operations by enrollment instead of replaying an older approval', async () => {
  const storage = new Map([
    [
      'fulcra.connector.pending:POST:/api/background-auth/complete',
      JSON.stringify({ pending: true, statusUrl: '/api/native/operations/legacy' })
    ],
    [
      'fulcra.connector.pending:POST:/api/background-auth/complete:older',
      JSON.stringify({ pending: true, statusUrl: '/api/native/operations/older' })
    ]
  ]);
  vi.stubGlobal('sessionStorage', {
    getItem: /** @param {string} key */ (key) => storage.get(key) ?? null,
    setItem: /** @param {string} key @param {string} value */ (key, value) =>
      storage.set(key, value),
    removeItem: /** @param {string} key */ (key) => storage.delete(key)
  });
  const fetchImpl = vi.fn(async (path) =>
    Response.json(
      path.includes('/operations/')
        ? { done: true, httpStatus: 200, body: { status: 'ready' } }
        : { status: 'pending', interval: 5 }
    )
  );
  expect(
    await connectorRequest(
      '/api/background-auth/complete',
      { method: 'POST', body: JSON.stringify({ enrollmentId: 'newer' }) },
      { fetchImpl, operationScope: 'newer', delay: async () => {} }
    )
  ).toEqual({ status: 'pending', interval: 5 });
  expect(fetchImpl.mock.calls[0][0]).toBe('/api/background-auth/complete');
  vi.unstubAllGlobals();
});
it('resumes the same enrollment operation after a lost response without another POST', async () => {
  const key = 'fulcra.connector.pending:POST:/api/background-auth/complete:same';
  const storage = new Map([
    [key, JSON.stringify({ pending: true, statusUrl: '/api/native/operations/same' })]
  ]);
  vi.stubGlobal('sessionStorage', {
    getItem: /** @param {string} key */ (key) => storage.get(key) ?? null,
    setItem: /** @param {string} key @param {string} value */ (key, value) =>
      storage.set(key, value),
    removeItem: /** @param {string} key */ (key) => storage.delete(key)
  });
  const fetchImpl = vi.fn(async (_path) =>
    Response.json({ done: true, httpStatus: 200, body: { status: 'ready' } })
  );
  expect(
    await connectorRequest(
      '/api/background-auth/complete',
      { method: 'POST', body: JSON.stringify({ enrollmentId: 'same' }) },
      { fetchImpl, operationScope: 'same', delay: async () => {} }
    )
  ).toEqual({ status: 'ready' });
  expect(fetchImpl.mock.calls[0][0]).toBe('/api/native/operations/same');
  expect(storage.has(key)).toBe(false);
  vi.unstubAllGlobals();
});
it('retains the original command identity across lost initial responses without storing credentials', async () => {
  const storage = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: /** @param {string} k */ (k) => storage.get(k) ?? null,
    setItem: /** @param {string} k @param {string} v */ (k, v) => storage.set(k, v),
    removeItem: /** @param {string} k */ (k) => storage.delete(k)
  });
  /** @type {string[]} */
  const ids = [];
  let calls = 0;
  const fetchImpl = vi.fn(async (_path, init) => {
    ids.push(init.headers['X-Command-ID']);
    if (++calls <= 2) throw Error('lost response');
    return Response.json({ connection: { id: 'one' } });
  });
  const init = { method: 'POST', body: JSON.stringify({ token: 'private-credential-sentinel' }) };
  await expect(connectorRequest('/api/connections', init, { fetchImpl })).rejects.toThrow(
    'lost response'
  );
  expect(JSON.stringify([...storage.values()])).not.toContain('private-credential-sentinel');
  expect(await connectorRequest('/api/connections', init, { fetchImpl })).toEqual({
    connection: { id: 'one' }
  });
  expect(new Set(ids).size).toBe(1);
  vi.unstubAllGlobals();
});
it('retries an interrupted operation using its original command ID', async () => {
  const storage = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: /** @param {string} k */ (k) => storage.get(k) ?? null,
    setItem: /** @param {string} k @param {string} v */ (k, v) => storage.set(k, v),
    removeItem: /** @param {string} k */ (k) => storage.delete(k)
  });
  /** @type {string[]} */
  const ids = [];
  let post = 0;
  const fetchImpl = vi.fn(async (path, init) => {
    if (path.includes('/operations/'))
      return Response.json({
        done: true,
        httpStatus: 503,
        body: { uncertain: true, retrySameCommand: true, message: 'Interrupted' }
      });
    ids.push(init.headers['X-Command-ID']);
    return ++post === 1
      ? Response.json({ pending: true, statusUrl: '/api/native/operations/test' }, { status: 202 })
      : Response.json({ created: true });
  });
  const init = { method: 'POST', body: '{}' },
    options = { fetchImpl, delay: async () => {} };
  await expect(connectorRequest('/api/test', init, options)).rejects.toThrow('Interrupted');
  expect(await connectorRequest('/api/test', init, options)).toEqual({ created: true });
  expect(new Set(ids).size).toBe(1);
  vi.unstubAllGlobals();
});
it('retains an uncertain type creation reference and never sends a new creation', async () => {
  const storage = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: /** @param {string} k */ (k) => storage.get(k) ?? null,
    setItem: /** @param {string} k @param {string} v */ (k, v) => storage.set(k, v),
    removeItem: /** @param {string} k */ (k) => storage.delete(k)
  });
  let creates = 0;
  const fetchImpl = vi.fn(async (path) => {
    if (path.includes('/operations/'))
      return Response.json({
        done: true,
        httpStatus: 503,
        body: { uncertain: true, message: 'Creation outcome uncertain' }
      });
    creates++;
    return Response.json(
      { pending: true, statusUrl: '/api/native/operations/type' },
      { status: 202 }
    );
  });
  const init = { method: 'POST', body: JSON.stringify({ name: 'Research updates' }) };
  for (let n = 0; n < 2; n++)
    await expect(
      connectorRequest('/api/destinations/types', init, {
        fetchImpl,
        delay: async () => {}
      })
    ).rejects.toThrow('Creation outcome uncertain');
  expect(creates).toBe(1);
  expect(
    JSON.parse(storage.get('fulcra.connector.pending:POST:/api/destinations/types')).statusUrl
  ).toBe('/api/native/operations/type');
  vi.unstubAllGlobals();
});
it('recovers a transient initial server error with the same command and payload', async () => {
  const replies = [
    Response.json({ message: 'Internal Error' }, { status: 500 }),
    Response.json({ created: true })
  ];
  const fetchImpl = vi.fn(async (_path, _init) => replies.shift());
  const init = {
    method: 'POST',
    body: JSON.stringify({
      operation: 'create',
      document: { title: 'Demo', markdown: 'Demo', archived: false }
    })
  };
  expect(
    await connectorRequest(
      '/api/connections/00000000-0000-4000-8000-000000000001/documents',
      init,
      {
        fetchImpl: /** @type {any} */ (fetchImpl),
        delay: async () => {}
      }
    )
  ).toEqual({ created: true });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(fetchImpl.mock.calls[0][1]).toEqual(fetchImpl.mock.calls[1][1]);
});

it('does not replay mutations whose backend may not deduplicate commands', async () => {
  const fetchImpl = vi.fn(async () =>
    Response.json({ message: 'Gateway failure' }, { status: 502 })
  );
  await expect(
    connectorRequest(
      '/api/connections',
      { method: 'POST', body: '{}' },
      { fetchImpl, delay: async () => {} }
    )
  ).rejects.toThrow('Gateway failure');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('retries an implicit GET read after a transient server failure', async () => {
  const replies = [
    Response.json({ message: 'Unavailable' }, { status: 503 }),
    Response.json({ documents: [] })
  ];
  const fetchImpl = vi.fn(async () => replies.shift());
  expect(
    await connectorRequest(
      '/api/connections/example/documents',
      {},
      { fetchImpl: /** @type {any} */ (fetchImpl), delay: async () => {} }
    )
  ).toEqual({ documents: [] });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
