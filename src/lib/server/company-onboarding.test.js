import { afterAll, beforeEach, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => {
  const fetchImpl = vi.fn();
  vi.stubGlobal('fetch', fetchImpl);
  return fetchImpl;
});
vi.mock('$env/dynamic/private', () => ({
  env: { OWNER_USER_ID: '00000000-0000-4000-8000-000000000001' }
}));
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_FULCRA_API_ENDPOINT: 'https://api.fulcradynamics.com/' }
}));
import { withRuntime } from './runtime-context.js';
import { freshState, nativeStore } from './native/state.js';
import { seal } from './secrets.js';
import { validateConfig, previewConnection, enableConnection } from './connections.js';
import { previewAttio } from './attio-sync/configuration.js';
import { createNotion } from './connectors/notion.js';
import {
  GET as connections,
  POST as createConnection
} from '../../routes/api/connections/+server.js';
import { POST as preview } from '../../routes/api/preview/+server.js';

/** @param {number} n */
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const company = uuid(1),
  member = uuid(2),
  page = uuid(3),
  workspace = uuid(4),
  object = uuid(5),
  record = uuid(6),
  field = uuid(7);
const crypto = { key: Buffer.alloc(32, 11).toString('base64'), keyId: 'v1' };
beforeEach(() => {
  transport.mockReset();
});
afterAll(() => vi.unstubAllGlobals());
const context = () => {
  const state = freshState(uuid(8), company);
  return { state, store: nativeStore(state), crypto };
};
/** @type {(body?:any, options?:any)=>any} */
const event = (
  body = {},
  { token = 'synthetic-owner', origin = 'https://company.example', method = 'POST' } = {}
) => ({
  cookies: {
    get: (/** @type {string} */ name) => (name === 'fulcra_access_token' ? token : undefined)
  },
  url: new URL('https://company.example/api/preview'),
  request: new Request('https://company.example/api/preview', {
    method,
    headers: { Origin: origin },
    ...(method !== 'GET' ? { body: JSON.stringify(body) } : {})
  })
});

it.each([
  ['shared-folder member', { userid: member, shares: [company], groups: ['company-members'] }, 403],
  [
    'owner-looking email/claims without verified ID',
    { email: 'company@example.invalid', ownerId: company },
    403
  ],
  ['malformed verified identity', { userid: { id: company } }, 403],
  ['identity service failure', 503, 503],
  ['rejected token', 401, 401]
])('denies %s before connection or preview effects', async (_label, identity, status) => {
  const c = context(),
    before = JSON.stringify(c.state);
  transport.mockImplementation(async (url) => {
    expect(String(url)).toBe('https://api.fulcradynamics.com/user/v1alpha1/info');
    return typeof identity === 'number'
      ? new Response('{}', { status: identity })
      : Response.json(identity);
  });
  for (const action of [connections, createConnection, preview])
    await expect(
      withRuntime(c, async () =>
        action(event({ ownerId: company, connector: 'notion', credential: { token: 'synthetic' } }))
      )
    ).rejects.toMatchObject({ status });
  expect(JSON.stringify(c.state)).toBe(before);
});

it('denies absent login and cross-origin owner mutations without provider or store effects', async () => {
  const c = context(),
    before = JSON.stringify(c.state);
  await expect(
    withRuntime(c, async () => createConnection(event({}, { token: '' })))
  ).rejects.toMatchObject({ status: 401 });
  expect(transport).not.toHaveBeenCalled();
  transport.mockResolvedValue(Response.json({ userid: company }));
  await expect(
    withRuntime(c, async () => createConnection(event({}, { origin: 'https://member.example' })))
  ).rejects.toMatchObject({ status: 403 });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(c.state)).toBe(before);
});

it('keeps company and member instances separate and fresh connections disabled', async () => {
  const c = context(),
    own = nativeStore(freshState(uuid(9), member));
  const companyConnection = await c.store.createConnection({
    connector: 'notion',
    label: 'Company',
    accountId: uuid(10),
    config: {}
  });
  const memberConnection = await own.createConnection({
    connector: 'notion',
    label: 'Member',
    accountId: uuid(10),
    config: {}
  });
  expect(companyConnection).toMatchObject({ status: 'draft', nextDue: null });
  expect(memberConnection).toMatchObject({ status: 'draft', nextDue: null });
  expect(await c.store.getConnection(memberConnection.id)).toBeNull();
  transport.mockResolvedValue(Response.json({ userid: company }));
  const response = await withRuntime(c, async () => connections(event({}, { method: 'GET' })));
  expect((await response.json()).connections.map((/** @type {any} */ x) => x.id)).toEqual([
    companyConnection.id
  ]);
  expect(c.state.active).toBeNull();
  expect(c.state.checkpoints).toEqual({});
  expect(c.state.deliveries).toEqual({});
});

it('runs actual Notion preview route with only identity/source reads and a local preview receipt', async () => {
  const c = context();
  const config = validateConfig(
    {
      resources: [page],
      intervalSeconds: 300,
      backfillSince: '2026-11-01T00:00:00Z',
      route: { mode: 'file', folder: '/company/notion' }
    },
    [page],
    company,
    'notion'
  );
  const connection = await c.store.createConnection({
    connector: 'notion',
    label: 'Company',
    accountId: uuid(10),
    config
  });
  const key = 'provider:' + connection.id;
  await c.store.saveGrant(key, {
    status: 'ready',
    encrypted: seal(
      { token: 'synthetic-notion-token' },
      `${c.store.deploymentId}:${company}:${key}`,
      crypto
    )
  });
  /** @type {string[]} */
  const reads = [];
  transport.mockImplementation(async (url, init = {}) => {
    const u = new URL(url);
    reads.push(u.href);
    expect(init.method ?? 'GET').toBe('GET');
    if (u.pathname === '/user/v1alpha1/info') return Response.json({ userid: company });
    if (u.pathname === '/v1/pages/' + page)
      return Response.json({
        id: page,
        last_edited_time: '2026-11-01T00:00:00Z',
        properties: { title: { type: 'title', title: [{ plain_text: 'Demo' }] } }
      });
    if (u.pathname === `/v1/blocks/${page}/children`)
      return Response.json({
        results: [
          {
            id: uuid(11),
            type: 'paragraph',
            has_children: false,
            paragraph: { rich_text: [{ plain_text: 'Demo body' }] }
          }
        ],
        has_more: false
      });
    throw Error('Unexpected preview effect: ' + u.pathname);
  });
  const result = await withRuntime(c, async () => preview(event({ connectionId: connection.id })));
  expect(await result.json()).toMatchObject({ writesPerformed: false, complete: true });
  expect(reads).toHaveLength(3);
  expect(Object.keys(c.state.grants).sort()).toEqual([`preview:${connection.id}`, key].sort());
  expect(c.state.connections[connection.id].status).toBe('draft');
  expect(c.state.deliveries).toEqual({});
  expect(c.state.checkpoints).toEqual({});
  const before = JSON.stringify(c.state);
  await expect(enableConnection(c.store, connection.id, false, crypto)).rejects.toThrow(/preview/i);
  await expect(enableConnection(c.store, connection.id, true, crypto)).rejects.toThrow(
    /authorization/i
  );
  expect(JSON.stringify(c.state)).toBe(before);
});

it('two-way Notion preview reads only selected pages without executing provider writes', async () => {
  const writes = vi.fn(() => {
    throw Error('Preview attempted write');
  });
  const adapter = {
    readDocument: vi.fn(async (/** @type {string} */ id) => ({
      supported: true,
      document: { title: id, markdown: 'Demo' }
    })),
    writeDocument: writes,
    createDocument: writes,
    archive: writes
  };
  const connection = {
    id: uuid(12),
    config: {
      resources: [page],
      route: { mode: 'file', folder: '/company/notion' },
      twoWay: { enabled: true, parentId: page }
    }
  };
  const before = JSON.stringify(connection);
  expect(await previewConnection(connection, adapter, {}, company)).toMatchObject({
    complete: true,
    writesPerformed: false
  });
  expect(adapter.readDocument).toHaveBeenCalledTimes(1);
  expect(adapter.readDocument.mock.calls[0][0]).toBe(page);
  expect(writes).not.toHaveBeenCalled();
  expect(JSON.stringify(connection)).toBe(before);
});

it('inaccessible Notion selection stays access-lost without broadening reads or deleting old copies', async () => {
  const c = context();
  const config = validateConfig(
    {
      resources: [page],
      intervalSeconds: 300,
      backfillSince: '2026-11-01T00:00:00Z',
      route: { mode: 'file', folder: '/company/notion' }
    },
    [page],
    company,
    'notion'
  );
  const connection = await c.store.createConnection({
    connector: 'notion',
    label: 'Restricted',
    accountId: uuid(10),
    config
  });
  const before = JSON.stringify(c.state);
  const fetchImpl = vi.fn(async (url, init) => {
    expect(String(url)).toBe(`https://api.notion.com/v1/pages/${page}`);
    expect(init?.method ?? 'GET').toBe('GET');
    return new Response('{}', { status: 404 });
  });
  const result = await previewConnection(
    connection,
    createNotion({ fetchImpl }),
    { token: 'synthetic-token' },
    company
  );
  expect(result.writesPerformed).toBe(false);
  expect(result.outputs[0].record.payload.status).toBe('access_lost');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(c.state)).toBe(before);
});

it('Attio preview enforces workspace, field and note permissions without publishing edits', async () => {
  const write = vi.fn(() => {
    throw Error('Preview attempted write');
  });
  const attribute = {
    id: field,
    type: 'text',
    writable: true,
    multiple: false,
    required: false,
    title: 'Demo',
    slug: 'demo'
  };
  const connection = {
    id: uuid(13),
    connector: 'attio',
    account_id: workspace,
    config: {
      resources: [`${object}:${record}`],
      route: { mode: 'file', folder: '/company/attio', ownerId: company },
      attio: { twoWay: true, includeNotes: false, writableAttributes: { [object]: [field] } }
    }
  };
  let scopes = ['object_configuration:read', 'record_permission:read-write'];
  let actualWorkspace = workspace;
  const api = {
    validate: async () => ({ workspaceId: actualWorkspace, scopes }),
    schema: async () => [attribute],
    readRecord: vi.fn(async () => ({
      binding: { workspaceId: workspace, objectId: object, recordId: record },
      title: 'Demo',
      url: '',
      createdAt: '2026-11-01T00:00:00Z',
      attributes: [attribute],
      rawValues: { [field]: [{ value: 'Demo' }] }
    })),
    updateRecord: write,
    createNote: write,
    deleteRecord: write
  };
  expect(await previewAttio(connection, {}, company, api)).toMatchObject({
    complete: true,
    writesPerformed: false
  });
  expect(write).not.toHaveBeenCalled();
  actualWorkspace = uuid(99);
  await expect(previewAttio(connection, {}, company, api)).rejects.toThrow(/workspace/i);
  actualWorkspace = workspace;
  scopes = ['object_configuration:read', 'record_permission:read'];
  await expect(previewAttio(connection, {}, company, api)).rejects.toThrow(/write scope/i);
  scopes = ['object_configuration:read', 'record_permission:read-write', 'note:read'];
  connection.config.attio.includeNotes = true;
  await expect(previewAttio(connection, {}, company, api)).rejects.toThrow(/note.*write scope/i);
  expect(api.readRecord).toHaveBeenCalledTimes(1);
  expect(write).not.toHaveBeenCalled();
});
