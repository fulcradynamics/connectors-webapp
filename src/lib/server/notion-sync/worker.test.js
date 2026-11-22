import { it, expect, vi } from 'vitest';
import { createDocumentService } from './service.js';
import { freshState, nativeStore } from '../native/state.js';
import { advanceNotionSync } from './worker.js';
import { loadManifest, saveManifest, workingFolder } from './state.js';
import { encodeDocument, decodeDocument, documentHash } from './document.js';
import { markerTitle } from './notion.js';
const crypto = { key: Buffer.alloc(32, 7).toString('base64'), keyId: 'v1' };
const pageId = '11111111-1111-4111-8111-111111111111';
const newId = '22222222-2222-4222-8222-222222222222';
const connectionId = '33333333-3333-4333-8333-333333333333';
const document = (markdown = 'Original', title = 'Demo', archived = false) => ({
  title,
  markdown,
  archived
});
/** @returns {any} */
function fixture() {
  let state = freshState('deployment', 'owner');
  const connection = {
    id: connectionId,
    connector: 'notion',
    status: 'ready',
    generation: 1,
    config: {
      resources: [pageId],
      intervalSeconds: 60,
      route: { mode: 'file', folder: '/notion' },
      twoWay: { enabled: true, parentId: pageId }
    }
  };
  state.connections[connectionId] = connection;
  /** @type {Map<string,any>} */
  const remote = new Map([[pageId, { document: document(), parent: null }]]);
  /** @type {Map<string,any[]>} */
  const files = new Map();
  /** @type {Map<string,any>} */
  const allocations = new Map();
  /** @type {string[]} */
  const calls = [];
  let seq = 0,
    failCreate = false,
    delayReadback = false;
  const put = (/** @type {string} */ path, /** @type {string} */ content) => {
    const item = {
      id: `file-${++seq}`,
      content,
      created_at: new Date(1_000_000 + seq).toISOString()
    };
    files.set(path, [item, ...(files.get(path) ?? [])]);
    return item;
  };
  const client = {
    latestFile: async (/** @type {string} */ path) => {
      const list = files.get(path) ?? [];
      return list.length
        ? { ...list[0], versions: list.map(({ id, created_at }) => ({ id, created_at })) }
        : null;
    },
    listFiles: async (/** @type {string} */ folder) =>
      [...files.entries()]
        .filter(([path]) => path.slice(0, path.lastIndexOf('/')) === folder)
        .flatMap(([path, list]) =>
          list.map((f) => ({
            ...f,
            path: folder,
            name: path.slice(path.lastIndexOf('/') + 1),
            state: 'uploaded'
          }))
        ),
    allocateFile: async (/** @type {string} */ path, /** @type {string} */ content) => {
      const id = `allocated-${++seq}`;
      allocations.set(id, { path, content });
      calls.push('allocate');
      return { file: { id }, url: `https://upload.test/${id}` };
    },
    transferFile: async (/** @type {any} */ upload, /** @type {string} */ content) => {
      const id = upload.url.split('/').at(-1),
        a = allocations.get(id);
      calls.push('transfer');
      if (!delayReadback) {
        const item = { id, content, created_at: new Date(1_000_000 + ++seq).toISOString() };
        files.set(a.path, [item, ...(files.get(a.path) ?? [])]);
      }
    },
    readFileBytes: async (/** @type {string} */ id) => {
      const file = [...files.values()].flat().find((f) => f.id === id);
      if (!file) throw Error('Missing retained file');
      return new TextEncoder().encode(file.content);
    },
    uploadFile: async (/** @type {string} */ path, /** @type {string} */ content) => {
      calls.push('guard');
      return put(path, content);
    }
  };
  const notion = {
    read: async (/** @type {string} */ id) => {
      if (!remote.has(id)) throw Object.assign(Error('Provider status 404'), { status: 404 });
      return {
        id,
        parentId: remote.get(id).parent ?? null,
        supported: true,
        titleProperty: 'title',
        bodyUnavailable: !!remote.get(id).document.archived,
        document: {
          ...structuredClone(remote.get(id).document),
          ...(remote.get(id).document.archived ? { markdown: '' } : {})
        }
      };
    },
    children: async (/** @type {string} */ parent) => ({
      pages: [...remote.entries()]
        .filter(([, p]) => p.parent === parent)
        .map(([id, p]) => ({ id, title: p.document.title })),
      cursor: null
    }),
    createMarker: async (/** @type {string} */ parent, /** @type {string} */ localId) => {
      calls.push('create');
      remote.set(newId, { parent, document: document('', markerTitle(localId)) });
      if (failCreate) throw Error('lost create response');
      return { id: newId };
    },
    setTitle: async (
      /** @type {string} */ id,
      /** @type {string} */ _prop,
      /** @type {string} */ value
    ) => {
      calls.push('title');
      remote.get(id).document.title = value;
    },
    setBody: async (
      /** @type {string} */ id,
      /** @type {string} */ before,
      /** @type {string} */ value
    ) => {
      calls.push('body');
      expect(remote.get(id).document.markdown).toBe(before);
      remote.get(id).document.markdown = value;
      return value;
    },
    setArchived: async (/** @type {string} */ id, /** @type {boolean} */ value) => {
      calls.push('archive');
      remote.get(id).document.archived = value;
    }
  };
  const deps = { crypto, client, notion, provider: async () => ({ token: 'synthetic' }) };
  return {
    get state() {
      return state;
    },
    set state(value) {
      state = value;
    },
    remote,
    files,
    calls,
    put,
    client,
    notion,
    set failCreate(/** @type {boolean} */ value) {
      failCreate = value;
    },
    set delayReadback(/** @type {boolean} */ value) {
      delayReadback = value;
    },
    async manifest() {
      return loadManifest(nativeStore(state), state.connections[connectionId], crypto);
    },
    async save(/** @type {any} */ m) {
      await saveManifest(nativeStore(state), state.connections[connectionId], m, crypto);
    },
    path: `${workingFolder(connection)}/${pageId}.md`,
    folder: workingFolder(connection),
    async tick() {
      await advanceNotionSync(state, state.connections[connectionId], deps);
      state = structuredClone(state);
    },
    async until(/** @type {()=>Promise<boolean>|boolean} */ test, max = 100) {
      for (let n = 0; n < max; n++) {
        await this.tick();
        if (await test()) return;
      }
      throw Error(
        'did not converge: ' +
          JSON.stringify({ manifest: await this.manifest(), calls, remote: [...remote] })
      );
    }
  };
}
/** @param {any} f */
async function initial(f) {
  await f.until(async () => (await f.manifest()).entries[pageId]?.status === 'synced');
}
it('pulls with verified bytes, pushes edits and stabilizes without echo writes', async () => {
  const f = fixture();
  await initial(f);
  expect(decodeDocument(f.files.get(f.path)[0].content)).toEqual(document());
  f.put(f.path, encodeDocument(document('Fulcra edit', 'Renamed')));
  await f.until(
    async () =>
      f.remote.get(pageId).document.markdown === 'Fulcra edit' &&
      (await f.manifest()).entries[pageId].status === 'synced'
  );
  expect(f.remote.get(pageId).document.title).toBe('Renamed');
  await f.until(async () => {
    const m = await f.manifest(),
      index = await f.client.latestFile(f.folder + '/index.md');
    return m.indexStatus?.state === 'current' && index?.content.includes('Renamed');
  });
  const count = f.calls.length;
  for (let n = 0; n < 15; n++) await f.tick();
  expect(f.calls.length).toBe(count);
});
it('does not advance a baseline before delayed file delivery is verified, and survives restart', async () => {
  const f = fixture();
  f.delayReadback = true;
  for (let n = 0; n < 10; n++) await f.tick();
  expect((await f.manifest()).entries[pageId].baseline).toBeUndefined();
  expect(f.calls.filter((/** @type {string} */ x) => x === 'allocate')).toHaveLength(1);
  f.delayReadback = false;
  const m = await f.manifest();
  const pending = m.pending;
  f.files.set(f.path, [
    { id: pending.receipt.inputId, content: pending.content, created_at: new Date().toISOString() }
  ]);
  await f.until(async () => (await f.manifest()).entries[pageId].status === 'synced');
  expect(f.calls.filter((/** @type {string} */ x) => x === 'allocate')).toHaveLength(1);
});
it('retains two conflicting edits and requires a matching reviewed resolution', async () => {
  const f = fixture();
  await initial(f);
  f.remote.get(pageId).document = document('Notion edit');
  f.put(f.path, encodeDocument(document('Fulcra edit')));
  await f.until(async () => (await f.manifest()).entries[pageId].status === 'conflict');
  expect(f.remote.get(pageId).document.markdown).toBe('Notion edit');
  expect(decodeDocument(f.files.get(f.path)[0].content).markdown).toBe('Fulcra edit');
  const m = await f.manifest();
  expect(m.entries[pageId].conflict.paths).toHaveLength(2);
  m.resolutions[pageId] = {
    choice: 'fulcra',
    notion: documentHash(document('Notion edit')),
    fulcra: documentHash(document('Fulcra edit')),
    conflictId: m.entries[pageId].conflict.id
  };
  m.priority = [pageId];
  await f.save(m);
  await f.until(
    async () =>
      f.remote.get(pageId).document.markdown === 'Fulcra edit' &&
      (await f.manifest()).entries[pageId].status === 'synced'
  );
});
it('propagates recoverable archive and restore without interpreting absence as delete', async () => {
  const f = fixture();
  await initial(f);
  f.remote.get(pageId).document.archived = true;
  await f.until(
    async () =>
      decodeDocument(f.files.get(f.path)[0].content).archived &&
      (await f.manifest()).entries[pageId].status === 'synced'
  );
  expect(decodeDocument(f.files.get(f.path)[0].content).markdown).toBe('Original');
  f.put(f.path, encodeDocument(document('Original', 'Demo', false)));
  await f.until(
    async () =>
      !f.remote.get(pageId).document.archived &&
      (await f.manifest()).entries[pageId].status === 'synced'
  );
  f.files.delete(f.path);
  for (let n = 0; n < 8; n++) await f.tick();
  expect(f.remote.get(pageId).document.archived).toBe(false);
});
it('recovers a committed create after losing its response and restarting, without a second page', async () => {
  const f = fixture();
  await initial(f);
  f.put(
    `${f.folder}/${newId}.md`,
    encodeDocument(document('New local body', 'Created from Fulcra'))
  );
  let m = await f.manifest();
  m.scanRequested = true;
  await f.save(m);
  f.failCreate = true;
  let before;
  await f.until(async () => {
    m = await f.manifest();
    return m.pending?.phase === 'create';
  });
  before = structuredClone(f.state);
  await f.tick();
  f.state = before;
  f.failCreate = false;
  await f.until(
    async () =>
      f.remote.get(newId)?.document.title === 'Created from Fulcra' &&
      (await f.manifest()).entries[newId]?.status === 'synced'
  );
  expect(f.calls.filter((/** @type {string} */ x) => x === 'create')).toHaveLength(1);
  expect(f.remote.size).toBe(2);
});
it('holds an intervening Fulcra edit made after a pull preflight as a conflict', async () => {
  const f = fixture();
  await initial(f);
  f.remote.get(pageId).document = document('Changed in Notion');
  await f.until(async () => (await f.manifest()).pending?.phase === 'verify');
  f.put(f.path, encodeDocument(document('Saved during the pull')));
  await f.until(async () => (await f.manifest()).entries[pageId].status === 'conflict');
  for (let n = 0; n < 15; n++) await f.tick();
  expect(f.remote.get(pageId).document.markdown).toBe('Changed in Notion');
  expect(decodeDocument(f.files.get(f.path)[0].content).markdown).toBe('Saved during the pull');
});
it('reconciles a committed body write after a lost response without another write', async () => {
  const f = fixture();
  await initial(f);
  f.put(f.path, encodeDocument(document('Committed body')));
  const original = f.notion.setBody;
  f.notion.setBody = async (
    /** @type {any} */ id,
    /** @type {any} */ before,
    /** @type {any} */ value
  ) => {
    await original(id, before, value);
    throw Error('lost body reply');
  };
  await f.until(
    async () =>
      (await f.manifest()).entries[pageId].status === 'synced' &&
      f.remote.get(pageId).document.markdown === 'Committed body'
  );
  expect(f.calls.filter((/** @type {string} */ x) => x === 'body')).toHaveLength(1);
});
it('keeps non-expiring baselines encrypted and rejects a changed parent scope', async () => {
  const f = fixture();
  await initial(f);
  expect(JSON.stringify(f.state.grants)).not.toContain('Original');
  const before = await f.manifest();
  expect(before.entries[pageId].baseline).toBeTruthy();
  f.state.connections[connectionId].config.twoWay.parentId = newId;
  await expect(f.manifest()).rejects.toThrow(/scope configuration/i);
});
it('retains an intervening Fulcra version even when the sync upload becomes latest', async () => {
  const f = fixture();
  await initial(f);
  f.client.readFileBytes = async (/** @type {string} */ id) =>
    new TextEncoder().encode(
      [...f.files.values()].flat().find((/** @type {any} */ v) => v.id === id).content
    );
  f.remote.get(pageId).document = document('Remote change');
  await f.until(async () => (await f.manifest()).pending?.phase === 'transfer');
  f.put(f.path, encodeDocument(document('Intervening user edit')));
  await f.tick();
  await f.until(async () => (await f.manifest()).entries[pageId].status === 'conflict');
  const m = await f.manifest(),
    retained = m.entries[pageId].conflict.paths[1];
  expect(decodeDocument(f.files.get(retained.path)[0].content).markdown).toBe(
    'Intervening user edit'
  );
  for (let n = 0; n < 15; n++) await f.tick();
  expect((await f.manifest()).entries[pageId].status).toBe('conflict');
});
it('retries a known pre-create guard failure without mistaking it for a sent create', async () => {
  const f = fixture();
  await initial(f);
  f.put(`${f.folder}/${newId}.md`, encodeDocument(document('New', 'Guard retry')));
  const m = await f.manifest();
  m.scanRequested = true;
  await f.save(m);
  const original = f.client.uploadFile;
  let failed = false;
  f.client.uploadFile = async (/** @type {string} */ path, /** @type {string} */ content) => {
    if (!failed) {
      failed = true;
      throw Error('guard upload unavailable');
    }
    return original(path, content);
  };
  await f.until(async () => (await f.manifest()).entries[newId]?.status === 'synced');
  expect(f.calls.filter((/** @type {string} */ x) => x === 'create')).toHaveLength(1);
});
it('continues healthy mapped pages when a different selected page is inaccessible', async () => {
  const f = fixture();
  f.state.connections[connectionId].config.resources.push(newId);
  f.remote.set(newId, { parent: null, document: document('Healthy page') });
  f.remote.delete(pageId);
  await f.until(async () => (await f.manifest()).entries[newId]?.status === 'synced');
  expect((await f.manifest()).entries[pageId].status).toBe('inaccessible');
});
it('reports discovery overflow without blocking existing mapped documents', async () => {
  const f = fixture();
  await initial(f);
  for (let i = 10; i < 60; i++)
    f.remote.set(String(i).padStart(8, '0') + '-1111-4111-8111-111111111111', {
      parent: pageId,
      document: document('Child ' + i)
    });
  const m = await f.manifest();
  m.scanRequested = true;
  await f.save(m);
  const child = '00000010-1111-4111-8111-111111111111';
  await f.until(async () => (await f.manifest()).entries[child]?.status === 'synced', 150);
  expect(Object.keys((await f.manifest()).entries)).toHaveLength(50);
  expect((await f.manifest()).discoveryWarnings.length).toBeGreaterThan(0);
});
it('keeps malformed working files from blocking healthy page updates', async () => {
  const f = fixture();
  await initial(f);
  f.put(`${f.folder}/${newId}.md`, 'not a valid working file');
  f.remote.get(pageId).document.markdown = 'Still progresses';
  const m = await f.manifest();
  m.scanRequested = true;
  await f.save(m);
  await f.until(
    async () =>
      decodeDocument(f.files.get(f.path)[0].content).markdown === 'Still progresses' &&
      (await f.manifest()).entries[pageId].status === 'synced'
  );
  expect((await f.manifest()).discoveryWarnings.length).toBeGreaterThan(0);
});
it('binds deferred creation markers to the original local ID when provider IDs differ', async () => {
  const f = fixture();
  await initial(f);
  const localId = '44444444-4444-4444-8444-444444444444';
  f.put(
    `${f.folder}/${localId}.md`,
    encodeDocument(document('Distinct IDs', 'Distinct created page'))
  );
  let m = await f.manifest();
  m.scanRequested = true;
  await f.save(m);
  const children = f.notion.children;
  let missed = false;
  f.notion.children = async (/** @type {string} */ parent) => {
    const current = await f.manifest();
    if (!missed && current.pending?.kind === 'create' && current.pending.phase === 'recover') {
      missed = true;
      return { pages: [], cursor: null };
    }
    return children(parent);
  };
  f.failCreate = true;
  await f.until(async () => (await f.manifest()).pending?.phase === 'recover');
  f.failCreate = false;
  await f.until(async () => (await f.manifest()).entries[localId]?.status === 'synced');
  m = await f.manifest();
  expect(
    Object.values(m.entries).filter((/** @type {any} */ e) => e.notionId === newId)
  ).toHaveLength(1);
  expect(m.entries[localId].notionId).toBe(newId);
  expect(f.remote.get(newId).document.title).toBe('Distinct created page');
});

it('archives a changed Fulcra body and restores it without blanking the hidden Notion body', async () => {
  const f = fixture();
  await initial(f);
  f.put(f.path, encodeDocument(document('Changed body', 'Renamed', true)));
  await f.until(
    async () =>
      f.remote.get(pageId).document.archived &&
      (await f.manifest()).entries[pageId].status === 'synced'
  );
  expect(f.remote.get(pageId).document.markdown).toBe('Changed body');
  expect(decodeDocument(f.files.get(f.path)[0].content)).toEqual(
    document('Changed body', 'Renamed', true)
  );
  f.put(f.path, encodeDocument(document('Changed body', 'Renamed', false)));
  await f.until(
    async () =>
      !f.remote.get(pageId).document.archived &&
      (await f.manifest()).entries[pageId].status === 'synced'
  );
  expect(f.remote.get(pageId).document.markdown).toBe('Changed body');
});
it('retains concurrent local edits when a Notion archive hides its body', async () => {
  const f = fixture();
  await initial(f);
  f.remote.get(pageId).document.archived = true;
  f.put(f.path, encodeDocument(document('Local concurrent edit')));
  await f.until(async () => (await f.manifest()).entries[pageId].status === 'conflict');
  const m = await f.manifest();
  const remoteSnapshot = decodeDocument(
    new TextDecoder().decode(
      await f.client.readFileBytes(m.entries[pageId].conflict.paths[0].fileId)
    )
  );
  expect(remoteSnapshot).toEqual(document('Original', 'Demo', true));
  expect(decodeDocument(f.files.get(f.path)[0].content).markdown).toBe('Local concurrent edit');
});
it('does not infer an empty body for a newly seen trashed page without a verified copy', async () => {
  const f = fixture();
  f.remote.get(pageId).document.archived = true;
  await f.until(async () => (await f.manifest()).entries[pageId].status === 'unsupported');
  expect(f.files.has(f.path)).toBe(false);
  expect(f.calls).not.toContain('body');
});
it('preserves a hidden Notion edit when a cached working copy requests restore', async () => {
  const f = fixture();
  await initial(f);
  f.remote.get(pageId).document = document('Notion changed before trash', 'Demo', true);
  await f.until(
    async () =>
      decodeDocument(f.files.get(f.path)[0].content).archived &&
      (await f.manifest()).entries[pageId].status === 'synced'
  );
  f.put(f.path, encodeDocument(document('Original', 'Demo', false)));
  await f.until(async () => (await f.manifest()).entries[pageId].status === 'conflict');
  expect(f.remote.get(pageId).document.markdown).toBe('Notion changed before trash');
  expect(f.calls).not.toContain('body');
});

it('rejects saving over an in-flight pull before accepting user text', async () => {
  const f = fixture();
  await initial(f);
  f.remote.get(pageId).document = document('Remote changed');
  await f.until(async () => (await f.manifest()).pending?.purpose === 'pull');
  const file = await f.client.latestFile(f.path);
  const service = createDocumentService({
    store: nativeStore(f.state),
    connection: f.state.connections[connectionId],
    crypto,
    client: f.client,
    notion: f.notion,
    credential: {}
  });
  await expect(
    service.mutate({
      operation: 'save',
      id: pageId,
      expectedRevision: file.id,
      document: document('USER EDIT ONLY COPY')
    })
  ).rejects.toThrow(/syncing.*wait.*reload/i);
  expect((await f.manifest()).queue[pageId]).toBeUndefined();
  await f.until(async () => !(await f.manifest()).pending);
  const refreshed = await f.client.latestFile(f.path);
  await expect(
    createDocumentService({
      store: nativeStore(f.state),
      connection: f.state.connections[connectionId],
      crypto,
      client: f.client,
      notion: f.notion,
      credential: {}
    }).mutate({
      operation: 'save',
      id: pageId,
      expectedRevision: refreshed.id,
      document: document('USER EDIT ONLY COPY')
    })
  ).resolves.toMatchObject({ queued: true });
});

for (const phase of ['queued', 'file-guard', 'file-transfer', 'file-verify']) {
  it(`retains an accepted editor save after a newer working revision at ${phase}`, async () => {
    const f = fixture();
    await initial(f);
    const file = await f.client.latestFile(f.path);
    const service = createDocumentService({
      store: nativeStore(f.state),
      connection: f.state.connections[connectionId],
      crypto,
      client: f.client,
      notion: f.notion,
      credential: {}
    });
    await service.mutate({
      operation: 'save',
      id: pageId,
      expectedRevision: file.id,
      document: document('Accepted editor text')
    });
    if (phase !== 'queued')
      await f.until(async () => {
        const p = (await f.manifest()).pending;
        return p?.purpose === 'edit' && p.phase === phase.slice(5);
      });
    f.put(f.path, encodeDocument(document('Later independent file edit')));
    await f.until(async () => (await f.manifest()).entries[pageId].status === 'conflict');
    const m = await f.manifest();
    const retained = decodeDocument(
      new TextDecoder().decode(
        await f.client.readFileBytes(m.entries[pageId].conflict.paths[1].fileId)
      )
    );
    expect(retained.markdown).toBe('Accepted editor text');
    expect(
      f.files
        .get(f.path)
        .some(
          (/** @type {any} */ file) =>
            decodeDocument(file.content).markdown === 'Later independent file edit'
        )
    ).toBe(true);
    expect(f.remote.get(pageId).document.markdown).toBe('Original');
    expect(m.queue[pageId]).toBeUndefined();
  });
}
it('holds accepted text through inaccessible provider and later reviews it without blocking healthy pages', async () => {
  const f = fixture();
  f.remote.set(newId, { document: document('Healthy initial'), parent: pageId });
  await initial(f);
  await f.until(async () => (await f.manifest()).entries[newId]?.status === 'synced');
  const file = await f.client.latestFile(f.path);
  const service = createDocumentService({
    store: nativeStore(f.state),
    connection: f.state.connections[connectionId],
    crypto,
    client: f.client,
    notion: f.notion,
    credential: {}
  });
  await service.mutate({
    operation: 'save',
    id: pageId,
    expectedRevision: file.id,
    document: document('Accepted before access lost')
  });
  f.put(f.path, encodeDocument(document('Newer external copy')));
  f.remote.delete(pageId);
  f.remote.get(newId).document = document('Healthy after access lost');
  await f.until(async () => {
    const file = await f.client.latestFile(f.folder + '/' + newId + '.md');
    return !!file && decodeDocument(file.content).markdown === 'Healthy after access lost';
  });
  expect(JSON.stringify(await f.manifest())).toContain('Accepted before access lost');
  f.remote.set(pageId, { document: document(), parent: null });
  await f.until(async () => (await f.manifest()).entries[pageId].status === 'conflict');
  const m = await f.manifest();
  expect(
    decodeDocument(
      new TextDecoder().decode(
        await f.client.readFileBytes(m.entries[pageId].conflict.paths[1].fileId)
      )
    ).markdown
  ).toBe('Accepted before access lost');
});
for (const failure of ['utf8', 'oversize']) {
  it(`skips a discovered ${failure} document and continues healthy reconciliation`, async () => {
    const f = fixture();
    await initial(f);
    const invalidPath = f.folder + '/' + newId + '.md';
    f.put(invalidPath, 'placeholder');
    const latest = f.client.latestFile;
    f.client.latestFile = async (/** @type {string} */ path) => {
      if (path === invalidPath) {
        if (failure === 'utf8')
          new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array([0xc3, 0x28]));
        throw Error('Working-file content exceeds bound');
      }
      return latest(path);
    };
    f.remote.get(pageId).document = document('Healthy remote change');
    await f.until(
      async () =>
        decodeDocument((await latest(f.path)).content).markdown === 'Healthy remote change',
      60
    );
    expect((await f.manifest()).entries[newId]).toBeUndefined();
    expect((await f.manifest()).discoveryWarnings.join(' ')).toMatch(/invalid.*skipped/i);
  });
}

it('retains a transient discovered-file read failure for retry instead of skipping it', async () => {
  const f = fixture();
  await initial(f);
  const path = f.folder + '/' + newId + '.md';
  f.put(path, encodeDocument(document('Valid child')));
  const latest = f.client.latestFile;
  let offline = true;
  f.client.latestFile = async (/** @type {string} */ p) => {
    if (p === path && offline) throw TypeError('fetch failed');
    return latest(p);
  };
  await f.until(async () => f.state.connections[connectionId].lastError != null);
  expect((await f.manifest()).entries[newId]).toBeUndefined();
  expect((await f.manifest()).discoveryWarnings.join(' ')).not.toMatch(/invalid.*skipped/i);
  offline = false;
  await f.until(async () => !!(await f.manifest()).entries[newId]);
});

it('keeps an accepted recovery choice through conflict refresh until explicitly resolved', async () => {
  const f = fixture();
  await initial(f);
  const service = () =>
    createDocumentService({
      store: nativeStore(f.state),
      connection: f.state.connections[connectionId],
      crypto,
      client: f.client,
      notion: f.notion,
      credential: {}
    });
  const before = await service().read(pageId);
  await service().mutate({
    operation: 'save',
    id: pageId,
    expectedRevision: before.revision,
    document: document('ACCEPTED SAVE')
  });
  f.put(f.path, encodeDocument(document('OTHER LOCAL EDIT')));
  await f.until(async () => (await f.manifest()).entries[pageId].status === 'conflict');
  const first = await service().read(pageId);
  const firstConflictId = first.conflict?.id;
  if (!firstConflictId) throw Error('Expected first recovery conflict');
  expect((await service().read(pageId, 'fulcra')).document.markdown).toBe('ACCEPTED SAVE');
  f.remote.get(pageId).document = document('NEW REMOTE EDIT');
  await f.until(async () => {
    const e = (await f.manifest()).entries[pageId];
    return e.status === 'conflict' && e.conflict.id !== firstConflictId;
  });
  const refreshed = await service().read(pageId);
  if (!refreshed.conflict) throw Error('Expected refreshed recovery conflict');
  expect((await service().read(pageId, 'fulcra')).document.markdown).toBe('ACCEPTED SAVE');
  expect(refreshed.queued).toBe(false);
  await service().mutate({
    operation: 'resolve',
    id: pageId,
    choice: 'fulcra',
    conflictId: refreshed.conflict.id,
    expectedRevision: refreshed.revision,
    expectedNotion: refreshed.expectedNotion
  });
  await f.until(async () => (await f.manifest()).entries[pageId].status === 'synced');
  expect(f.remote.get(pageId).document.markdown).toBe('ACCEPTED SAVE');
  expect((await f.manifest()).entries[pageId].recoveryEdit).toBeUndefined();
});

it('holds a recovery conflict through temporary unsupported Notion content without choosing a winner', async () => {
  const f = fixture();
  await initial(f);
  const service = createDocumentService({
    store: nativeStore(f.state),
    connection: f.state.connections[connectionId],
    crypto,
    client: f.client,
    notion: f.notion,
    credential: {}
  });
  const before = await f.client.latestFile(f.path);
  await service.mutate({
    operation: 'save',
    id: pageId,
    expectedRevision: before.id,
    document: document('ACCEPTED SAVE')
  });
  f.put(f.path, encodeDocument(document('OTHER LOCAL EDIT')));
  await f.until(async () => (await f.manifest()).entries[pageId].status === 'conflict');
  const read = f.notion.read;
  let unsupported = true;
  f.notion.read = async (/** @type {string} */ id) => ({
    ...(await read(id)),
    supported: !unsupported
  });
  await f.until(async () => (await f.manifest()).entries[pageId].status === 'recovery_pending');
  unsupported = false;
  for (let n = 0; n < 35; n++) await f.tick();
  const m = await f.manifest();
  expect(m.entries[pageId].status).toBe('conflict');
  expect(m.entries[pageId].recoveryEdit.document.markdown).toBe('ACCEPTED SAVE');
  expect(f.remote.get(pageId).document.markdown).toBe('Original');
});

it('publishes a readable index after verified sync and keeps its version on unchanged cycles', async () => {
  const f = fixture();
  await initial(f);
  await f.until(async () => (await f.manifest()).indexStatus?.state === 'current');
  const path = f.folder + '/index.md',
    before = await f.client.latestFile(path);
  expect(before.content).toContain(`[Demo](${pageId}.md)`);
  expect(before.content).toContain('## Synced');
  for (let n = 0; n < 35; n++) await f.tick();
  expect((await f.client.latestFile(path)).id).toBe(before.id);
  f.remote.get(pageId).document = document('Changed', 'New title', true);
  await f.until(async () => {
    const m = await f.manifest(),
      file = await f.client.latestFile(path);
    return (
      m.entries[pageId].status === 'synced' &&
      m.indexStatus?.state === 'current' &&
      file?.content.includes('## Archived') &&
      file.content.includes('New title')
    );
  });
  expect((await f.client.latestFile(path)).id).not.toBe(before.id);
});
it('keeps an index failure retryable while a queued page edit still reaches Notion', async () => {
  const f = fixture();
  await initial(f);
  const original = f.client.allocateFile;
  let indexOffline = true;
  f.client.allocateFile = async (/** @type {string} */ path, /** @type {string} */ content) => {
    if (path.endsWith('/index.md') && indexOffline) throw Error('index temporarily unavailable');
    return original(path, content);
  };
  await f.until(async () => (await f.manifest()).indexStatus?.state === 'retry');
  const file = await f.client.latestFile(f.path);
  await createDocumentService({
    store: nativeStore(f.state),
    connection: f.state.connections[connectionId],
    crypto,
    client: f.client,
    notion: f.notion,
    credential: {}
  }).mutate({
    operation: 'save',
    id: pageId,
    expectedRevision: file.id,
    document: document('Accepted despite index outage')
  });
  await f.until(
    async () =>
      f.remote.get(pageId).document.markdown === 'Accepted despite index outage' &&
      (await f.manifest()).entries[pageId].status === 'synced'
  );
  indexOffline = false;
  const m = await f.manifest();
  m.indexRetryAt = 0;
  await f.save(m);
  await f.until(async () => (await f.manifest()).indexStatus?.state === 'current');
});

it('continues ordinary provider polling while index delivery readback is delayed', async () => {
  const f = fixture();
  await initial(f);
  const latest = f.client.latestFile;
  let delayed = true;
  f.client.latestFile = async (/** @type {string} */ path) =>
    path.endsWith('/index.md') && delayed ? null : latest(path);
  await f.until(async () => (await f.manifest()).indexPending?.phase === 'verify');
  const drained = await f.manifest();
  drained.scan = null;
  drained.index = 0;
  drained.priority = [];
  await f.save(drained);
  f.remote.get(pageId).document = document('Provider edit during delayed index');
  let now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    let converged = false;
    for (let n = 0; n < 100; n++) {
      now = Math.max(now + 1, f.state.connections[connectionId].nextDue ?? now);
      await f.tick();
      if (
        decodeDocument((await f.client.latestFile(f.path)).content).markdown ===
        'Provider edit during delayed index'
      ) {
        converged = true;
        break;
      }
    }
    expect(converged).toBe(true);
    expect((await f.manifest()).indexStatus.state).not.toBe('current');
    delayed = false;
    const m = await f.manifest();
    m.indexRetryAt = 0;
    await f.save(m);
    await f.until(async () => (await f.manifest()).indexStatus?.state === 'current');
  } finally {
    clock.mockRestore();
  }
});

it('persists managed edits one block at a time and reconciles a lost first PATCH response', async () => {
  const { encodeManaged, parseManaged, planManagedEdit } = await import('../../notion-managed.js');
  const f = fixture();
  const capsule = {
    version: 1,
    pageId,
    blocks: [pageId, newId].map((id, i) => ({
      id,
      type: 'paragraph',
      editable: true,
      texts: ['Text ' + i],
      styles: [{ annotations: {}, link: null }],
      attributes: { color: 'default' }
    }))
  };
  f.remote.get(pageId).document = document(encodeManaged(capsule));
  const read = f.notion.read;
  f.notion.read = async (/** @type {string} */ id) => {
    const r = await read(id);
    return { ...r, managed: parseManaged(r.document.markdown) };
  };
  await initial(f);
  const next = structuredClone(capsule);
  next.blocks[0].texts = ['First edit'];
  next.blocks[1].texts = ['Second edit'];
  const file = await f.client.latestFile(f.path);
  await createDocumentService({
    store: nativeStore(f.state),
    connection: f.state.connections[connectionId],
    crypto,
    client: f.client,
    notion: f.notion,
    credential: {}
  }).mutate({
    operation: 'save',
    id: pageId,
    expectedRevision: file.id,
    document: document(encodeManaged(next))
  });
  let writes = 0,
    lost = true;
  f.notion.setBody = async (
    /** @type {string} */ id,
    /** @type {string} */ before,
    /** @type {string} */ after
  ) => {
    const plan = planManagedEdit(before, after);
    if (!plan) return before;
    writes++;
    f.remote.get(id).document.markdown = plan.intermediate;
    if (lost) {
      lost = false;
      throw Error('lost managed PATCH reply');
    }
    return plan.intermediate;
  };
  await f.until(
    async () =>
      f.remote.get(pageId).document.markdown === encodeManaged(next) &&
      (await f.manifest()).entries[pageId].status === 'synced',
    150
  );
  expect(writes).toBe(2);
  expect((await f.manifest()).entries[pageId].conflict).toBeUndefined();
});
it('rejects managed structure edits before changing the title or creating a provider page', async () => {
  const { encodeManaged, parseManaged } = await import('../../notion-managed.js');
  const f = fixture();
  const capsule = {
    version: 1,
    pageId,
    blocks: [
      {
        id: pageId,
        type: 'paragraph',
        editable: true,
        texts: ['Text'],
        styles: [{ annotations: {}, link: null }],
        attributes: { color: 'default' }
      }
    ]
  };
  f.remote.get(pageId).document = document(encodeManaged(capsule));
  const read = f.notion.read;
  f.notion.read = async (/** @type {string} */ id) => {
    const r = await read(id);
    return { ...r, managed: parseManaged(r.document.markdown) };
  };
  await initial(f);
  const forged = structuredClone(capsule);
  forged.blocks[0].attributes.color = 'red';
  f.put(f.path, encodeDocument(document(encodeManaged(forged), 'Should not apply')));
  for (let i = 0; i < 30; i++) await f.tick();
  expect(f.remote.get(pageId).document.title).toBe('Demo');
  expect(f.calls).not.toContain('title');
  f.put(
    f.folder + '/' + newId + '.md',
    encodeDocument(document(encodeManaged(capsule), 'Forged new page'))
  );
  for (let i = 0; i < 35; i++) await f.tick();
  expect(f.calls).not.toContain('create');
});

/** Exercise native phases with a provider that hides archived bodies and changes one leaf per PATCH.
 * @returns {Promise<any>} */
async function mixedWorkerFixture() {
  const { encodeManaged, parseManaged, planManagedEdit } = await import('../../notion-managed.js');
  const f = fixture();
  const capsule = {
    version: 1,
    pageId,
    blocks: [
      ...[newId, connectionId].map((id, index) => ({
        id,
        type: 'paragraph',
        editable: true,
        texts: ['Text ' + index],
        styles: [{ annotations: {}, link: null }],
        attributes: { color: 'default' }
      })),
      {
        id: '44444444-4444-4444-8444-444444444444',
        type: 'template',
        editable: false,
        snapshot: {
          label: 'Add task',
          children: [
            {
              id: '55555555-5555-4555-8555-555555555555',
              type: 'paragraph',
              text: 'Protected child'
            }
          ]
        }
      }
    ]
  };
  f.remote.get(pageId).document = document(encodeManaged(capsule));
  const read = f.notion.read;
  f.notion.read = async (/** @type {string} */ id) => {
    const result = await read(id);
    return {
      ...result,
      managed: result.bodyUnavailable ? null : parseManaged(result.document.markdown)
    };
  };
  /** @type {string[]} */
  const events = [];
  /** @type {string[]} */
  const bodyWrites = [];
  f.notion.setTitle = async (
    /** @type {string} */ id,
    /** @type {string} */ _property,
    /** @type {string} */ title
  ) => {
    expect(f.remote.get(id).document.archived).toBe(false);
    events.push('title');
    f.remote.get(id).document.title = title;
  };
  f.notion.setBody = async (
    /** @type {string} */ id,
    /** @type {string} */ before,
    /** @type {string} */ after,
    /** @type {any} */ _credential,
    /** @type {any} */ _deadline,
    /** @type {any} */ projection
  ) => {
    expect(f.remote.get(id).document.archived).toBe(false);
    expect(f.remote.get(id).document.markdown).toBe(before);
    expect(projection.managed).toEqual(parseManaged(before));
    const plan = planManagedEdit(before, after);
    if (!plan) return before;
    events.push('body');
    bodyWrites.push(plan.blockId);
    f.remote.get(id).document.markdown = plan.intermediate;
    return plan.intermediate;
  };
  f.notion.setArchived = async (/** @type {string} */ id, /** @type {boolean} */ archived) => {
    const event = archived ? 'archive' : 'restore';
    events.push(event);
    f.remote.get(id).document.archived = archived;
  };
  return Object.assign(f, { capsule, events, bodyWrites, encodeManaged, parseManaged });
}

it.each([
  ['title and body', 'none'],
  ['title and body', 'restore'],
  ['title and body', 'title'],
  ['title and body', 'body'],
  ['title and body', 'archive'],
  ['title only', 'none'],
  ['body only', 'none']
])(
  'restores an archived mixed page before %s edits and rearchives after verified progress (%s response lost)',
  async (changes, lostResponse) => {
    const f = await mixedWorkerFixture();
    await initial(f);
    f.remote.get(pageId).document.archived = true;
    await f.until(
      async () =>
        decodeDocument((await f.client.latestFile(f.path)).content).archived &&
        (await f.manifest()).entries[pageId].status === 'synced'
    );
    const desired = structuredClone(f.capsule);
    if (changes !== 'title only') desired.blocks[0].texts = ['Edited while archived'];
    const desiredDocument = document(
      f.encodeManaged(desired),
      changes === 'body only' ? 'Demo' : 'Archived page renamed',
      true
    );
    f.put(f.path, encodeDocument(desiredDocument));
    const setArchived = f.notion.setArchived;
    const setTitle = f.notion.setTitle;
    const setBody = f.notion.setBody;
    let lost = false;
    /** @param {string} event */
    const lose = (event) => {
      if (!lost && lostResponse === event) {
        lost = true;
        throw Error('Lost committed ' + event + ' response');
      }
    };
    f.notion.setArchived = async (/** @type {string} */ id, /** @type {boolean} */ value) => {
      await setArchived(id, value);
      lose(value ? 'archive' : 'restore');
    };
    f.notion.setTitle = async (/** @type {any[]} */ ...args) => {
      await setTitle(...args);
      lose('title');
    };
    f.notion.setBody = async (/** @type {any[]} */ ...args) => {
      const result = await setBody(...args);
      lose('body');
      return result;
    };
    await f.until(
      async () =>
        documentHash(f.remote.get(pageId).document) === documentHash(desiredDocument) &&
        (await f.manifest()).entries[pageId].status === 'synced',
      150
    );
    expect(f.events).toEqual(
      changes === 'title only'
        ? ['restore', 'title', 'archive']
        : changes === 'body only'
          ? ['restore', 'body', 'archive']
          : ['restore', 'title', 'body', 'archive']
    );
    expect(f.bodyWrites).toEqual(changes === 'title only' ? [] : [newId]);
    expect(f.remote.get(pageId).document.archived).toBe(true);
    expect(f.parseManaged(f.remote.get(pageId).document.markdown).blocks[2]).toEqual(
      f.capsule.blocks[2]
    );
    expect(decodeDocument((await f.client.latestFile(f.path)).content)).toEqual(desiredDocument);
    expect((await f.manifest()).entries[pageId].conflict).toBeUndefined();
    if (lostResponse !== 'none') expect(lost).toBe(true);
  }
);

it('conflicts on an opaque descendant change after a partial managed push and retains every desired text edit', async () => {
  const f = await mixedWorkerFixture();
  await initial(f);
  const baseline = structuredClone((await f.manifest()).entries[pageId].baseline);
  const desired = structuredClone(f.capsule);
  desired.blocks[0].texts = ['First desired edit'];
  desired.blocks[1].texts = ['Second desired edit'];
  const desiredDocument = document(f.encodeManaged(desired));
  f.put(f.path, encodeDocument(desiredDocument));
  await f.until(async () => {
    const pending = (await f.manifest()).pending;
    return f.bodyWrites.length === 1 && pending?.kind === 'notion' && pending.phase === 'body';
  });
  const changed = f.parseManaged(f.remote.get(pageId).document.markdown);
  changed.blocks[2].snapshot.children[0].text = 'Changed remotely during push';
  f.remote.get(pageId).document.markdown = f.encodeManaged(changed);
  await f.until(async () => (await f.manifest()).entries[pageId].status === 'conflict');
  const entry = (await f.manifest()).entries[pageId];
  expect(f.bodyWrites).toEqual([newId]);
  expect(f.parseManaged(f.remote.get(pageId).document.markdown).blocks[1].texts).toEqual([
    'Text 1'
  ]);
  expect(f.parseManaged(f.remote.get(pageId).document.markdown).blocks[2]).toEqual(
    changed.blocks[2]
  );
  expect(decodeDocument((await f.client.latestFile(f.path)).content)).toEqual(desiredDocument);
  expect(entry.baseline).toEqual(baseline);
  const notionEvidence = decodeDocument(
    (await f.client.latestFile(entry.conflict.paths[0].path)).content
  );
  const fulcraEvidence = decodeDocument(
    (await f.client.latestFile(entry.conflict.paths[1].path)).content
  );
  expect(f.parseManaged(notionEvidence.markdown).blocks[2]).toEqual(changed.blocks[2]);
  expect(fulcraEvidence).toEqual(desiredDocument);
  for (let i = 0; i < 15; i++) await f.tick();
  expect(f.bodyWrites).toEqual([newId]);
  expect(decodeDocument((await f.client.latestFile(f.path)).content)).toEqual(desiredDocument);
});

it.each([false, true])(
  'retains an accepted provider intent when its working file disappears (first block already written: %s)',
  async (partiallyApplied) => {
    const f = await mixedWorkerFixture();
    await initial(f);
    const desired = structuredClone(f.capsule);
    desired.blocks[0].texts = ['Accepted first edit'];
    desired.blocks[1].texts = ['Accepted second edit'];
    const desiredDocument = document(f.encodeManaged(desired), 'Accepted renamed page');
    const service = createDocumentService({
      store: nativeStore(f.state),
      connection: f.state.connections[connectionId],
      crypto,
      client: f.client,
      notion: f.notion,
      credential: {}
    });
    await service.mutate({
      operation: 'save',
      id: pageId,
      expectedRevision: (await f.client.latestFile(f.path)).id,
      document: desiredDocument
    });
    await f.until(async () => {
      const pending = (await f.manifest()).pending;
      return (
        pending?.kind === 'notion' &&
        (partiallyApplied ? f.bodyWrites.length === 1 : pending.phase === 'guard')
      );
    });
    expect(decodeDocument((await f.client.latestFile(f.path)).content)).toEqual(desiredDocument);
    expect((await f.manifest()).pending.desired).toEqual(desiredDocument);
    const remoteBeforeMissing = structuredClone(f.remote.get(pageId).document);
    const writesBeforeMissing = [...f.events];
    f.files.delete(f.path);
    await f.tick();
    let m = await f.manifest();
    expect(m.pending).toBeNull();
    expect(m.entries[pageId].status).toBe('recovery_pending');
    expect(m.entries[pageId].recoveryEdit.document).toEqual(desiredDocument);
    for (let i = 0; i < 12; i++) await f.tick();
    m = await f.manifest();
    expect(m.entries[pageId].recoveryEdit.document).toEqual(desiredDocument);
    expect(f.events).toEqual(writesBeforeMissing);
    expect(f.remote.get(pageId).document).toEqual(remoteBeforeMissing);
    expect(await f.client.latestFile(f.path)).toBeNull();
    const restored = structuredClone(f.capsule);
    restored.blocks[0].texts = ['New restored working copy'];
    const restoredDocument = document(f.encodeManaged(restored));
    f.put(f.path, encodeDocument(restoredDocument));
    await f.until(async () => (await f.manifest()).entries[pageId].status === 'conflict');
    m = await f.manifest();
    expect(m.entries[pageId].recoveryEdit.document).toEqual(desiredDocument);
    const retained = decodeDocument(
      (await f.client.latestFile(m.entries[pageId].conflict.paths[1].path)).content
    );
    expect(retained).toEqual(desiredDocument);
    expect(decodeDocument((await f.client.latestFile(f.path)).content)).toEqual(restoredDocument);
    expect(f.events).toEqual(writesBeforeMissing);
    expect(f.remote.get(pageId).document).toEqual(remoteBeforeMissing);
  }
);

it.each(['child', 'local'])(
  'quarantines a moved %s page before provider mutation while retaining its accepted desired document',
  async (origin) => {
    const f = fixture();
    await initial(f);
    const path = `${f.folder}/${newId}.md`;
    if (origin === 'child')
      f.remote.set(newId, { parent: pageId, document: document('Discovered child') });
    else f.put(path, encodeDocument(document('Local created page')));
    const start = await f.manifest();
    start.scanRequested = true;
    await f.save(start);
    await f.until(async () => (await f.manifest()).entries[newId]?.status === 'synced');
    expect((await f.manifest()).entries[newId].origin).toBe(origin);
    const desired = document('Accepted pending child edit', 'Accepted child rename', true);
    await createDocumentService({
      store: nativeStore(f.state),
      connection: f.state.connections[connectionId],
      crypto,
      client: f.client,
      notion: f.notion,
      credential: {}
    }).mutate({
      operation: 'save',
      id: newId,
      expectedRevision: (await f.client.latestFile(path)).id,
      document: desired
    });
    await f.until(async () => {
      const pending = (await f.manifest()).pending;
      return pending?.kind === 'notion' && pending.entryId === newId && pending.phase === 'guard';
    });
    const providerCalls = () =>
      f.calls.filter((/** @type {string} */ call) =>
        ['title', 'body', 'archive', 'create'].includes(call)
      );
    const beforeCalls = [...providerCalls()];
    const beforeRemote = structuredClone(f.remote.get(newId).document);
    f.remote.get(newId).parent = '44444444-4444-4444-8444-444444444444';
    await f.tick();
    let m = await f.manifest();
    expect(m.pending).toBeNull();
    expect(m.entries[newId].status).toBe('quarantined');
    expect(m.entries[newId].error).toBe('Notion page moved outside the configured creation parent');
    expect(m.entries[newId].recoveryEdit.document).toEqual(desired);
    expect(m.entries[newId].deferred).toBeUndefined();
    expect(providerCalls()).toEqual(beforeCalls);
    expect(f.remote.get(newId).document).toEqual(beforeRemote);
    expect(decodeDocument((await f.client.latestFile(path)).content)).toEqual(desired);
    f.remote.get(pageId).document.markdown = 'Healthy selected page continues';
    await f.until(async () => {
      const current = await f.client.latestFile(f.path);
      return (
        decodeDocument(current.content).markdown === 'Healthy selected page continues' &&
        (await f.manifest()).entries[pageId].status === 'synced'
      );
    });
    m = await f.manifest();
    expect(m.entries[newId].status).toBe('quarantined');
    expect(m.entries[newId].recoveryEdit.document).toEqual(desired);
    expect(providerCalls()).toEqual(beforeCalls);
    expect(f.remote.get(newId).document).toEqual(beforeRemote);
    // Restoring scope permits fresh review, never automatic replay of the quarantined edit.
    f.remote.get(newId).parent = pageId;
    await f.until(async () => (await f.manifest()).entries[newId].status === 'conflict');
    m = await f.manifest();
    const retained = decodeDocument(
      (await f.client.latestFile(m.entries[newId].conflict.paths[1].path)).content
    );
    expect(retained).toEqual(desired);
    expect(providerCalls()).toEqual(beforeCalls);
    expect(f.remote.get(newId).document).toEqual(beforeRemote);
  }
);

it('continues syncing an explicitly selected page by ID after its provider parent changes', async () => {
  const f = fixture();
  await initial(f);
  f.remote.get(pageId).parent = '44444444-4444-4444-8444-444444444444';
  const desired = document('Explicitly selected content', 'Selected page moved');
  f.put(f.path, encodeDocument(desired));
  await f.until(
    async () =>
      documentHash(f.remote.get(pageId).document) === documentHash(desired) &&
      (await f.manifest()).entries[pageId].status === 'synced'
  );
  expect((await f.manifest()).entries[pageId].origin).toBe('selected');
  expect((await f.manifest()).entries[pageId].error).toBeUndefined();
  expect(f.calls.filter((/** @type {string} */ call) => call === 'body')).toHaveLength(1);
});

it('detects an archived intervening file edit after our upload and retains both versions for review', async () => {
  const f = fixture();
  await initial(f);
  const allLatest = f.client.latestFile;
  f.client.latestFile = async (/** @type {string} */ path) => {
    const file = await allLatest(path);
    return file ? { ...file, versions: [file.versions[0]] } : null;
  };
  f.client.fileState = async (/** @type {string} */ path) => {
    const file = await allLatest(path);
    const versions = (file?.versions ?? []).map(
      (/** @type {any} */ v, /** @type {number} */ i) => ({
        ...v,
        state: i ? 'archived' : 'uploaded'
      })
    );
    return { file: file ? { ...file, versions } : null, versions };
  };
  const own = document('Accepted editor version'),
    intervening = document('Intervening agent version');
  const service = createDocumentService({
    store: nativeStore(f.state),
    connection: f.state.connections[connectionId],
    crypto,
    client: f.client,
    notion: f.notion,
    credential: {}
  });
  await service.mutate({
    operation: 'save',
    id: pageId,
    expectedRevision: (await allLatest(f.path)).id,
    document: own
  });
  await f.until(
    async () =>
      (await f.manifest()).pending?.purpose === 'edit' &&
      (await f.manifest()).pending?.phase === 'transfer'
  );
  const transfer = f.client.transferFile;
  let version = /** @type {any} */ (null);
  f.client.transferFile = async (/** @type {any} */ receipt, /** @type {string} */ content) => {
    if (!version) version = f.put(f.path, encodeDocument(intervening));
    return transfer(receipt, content);
  };
  await f.until(async () => (await f.manifest()).entries[pageId].status === 'conflict');
  const m = await f.manifest();
  expect(m.entries[pageId].recoveryEdit.document).toEqual(own);
  expect(m.entries[pageId].recoveryEdit.interveningFileId).toBe(version.id);
  expect(f.remote.get(pageId).document).toEqual(document());
  expect(
    f.calls.filter((/** @type {string} */ c) => ['body', 'title', 'archive'].includes(c))
  ).toHaveLength(0);
  const review = createDocumentService({
    store: nativeStore(f.state),
    connection: f.state.connections[connectionId],
    crypto,
    client: f.client,
    notion: f.notion,
    credential: {}
  });
  expect((await review.read(pageId, 'working')).document).toEqual(intervening);
});
it('rechecks the working head immediately before transfer and does not overwrite a newer edit', async () => {
  const f = fixture();
  await initial(f);
  const own = document('Accepted queued edit');
  const service = createDocumentService({
    store: nativeStore(f.state),
    connection: f.state.connections[connectionId],
    crypto,
    client: f.client,
    notion: f.notion,
    credential: {}
  });
  await service.mutate({
    operation: 'save',
    id: pageId,
    expectedRevision: (await f.client.latestFile(f.path)).id,
    document: own
  });
  await f.until(
    async () =>
      (await f.manifest()).pending?.purpose === 'edit' &&
      (await f.manifest()).pending?.phase === 'transfer'
  );
  const later = f.put(f.path, encodeDocument(document('Newer working edit'))),
    transfers = f.calls.filter((/** @type {string} */ c) => c === 'transfer').length;
  await f.tick();
  expect((await f.client.latestFile(f.path)).id).toBe(later.id);
  expect(f.calls.filter((/** @type {string} */ c) => c === 'transfer')).toHaveLength(transfers);
  expect((await f.manifest()).entries[pageId].recoveryEdit.document).toEqual(own);
});
it('does not retransfer a deleted upload receipt and retains the accepted edit', async () => {
  const f = fixture();
  await initial(f);
  const allLatest = f.client.latestFile,
    own = document('Accepted editor text after cancelled allocation');
  const service = createDocumentService({
    store: nativeStore(f.state),
    connection: f.state.connections[connectionId],
    crypto,
    client: f.client,
    notion: f.notion,
    credential: {}
  });
  await service.mutate({
    operation: 'save',
    id: pageId,
    expectedRevision: (await allLatest(f.path)).id,
    document: own
  });
  await f.until(
    async () =>
      (await f.manifest()).pending?.purpose === 'edit' &&
      (await f.manifest()).pending?.phase === 'transfer'
  );
  const p = (await f.manifest()).pending,
    transfers = f.calls.filter((/** @type {string} */ x) => x === 'transfer').length;
  f.client.fileState = async (/** @type {string} */ path) => {
    const file = await allLatest(path);
    return {
      file,
      versions: [
        ...(file?.versions ?? []),
        { id: p.receipt.inputId, state: 'deleted', uploaded_at: null }
      ]
    };
  };
  await f.tick();
  expect(f.calls.filter((/** @type {string} */ x) => x === 'transfer')).toHaveLength(transfers);
  expect((await f.manifest()).entries[pageId].recoveryEdit.document).toEqual(own);
  expect(f.remote.get(pageId).document).toEqual(document());
});
for (const change of ['replacement', 'disappearance']) {
  it(`retains an accepted editor document across the verified-file handoff ${change}`, async () => {
    const f = fixture();
    await initial(f);
    const own = document('Accepted handoff edit');
    const service = createDocumentService({
      store: nativeStore(f.state),
      connection: f.state.connections[connectionId],
      crypto,
      client: f.client,
      notion: f.notion,
      credential: {}
    });
    await service.mutate({
      operation: 'save',
      id: pageId,
      expectedRevision: (await f.client.latestFile(f.path)).id,
      document: own
    });
    await f.until(async () => {
      const m = await f.manifest();
      return !m.pending && !m.queue[pageId] && m.entries[pageId].status === 'pending';
    });
    if (change === 'replacement')
      f.put(f.path, encodeDocument(document('Later external working edit')));
    else f.files.delete(f.path);
    await f.until(async () => !!(await f.manifest()).entries[pageId].recoveryEdit);
    const m = await f.manifest();
    expect(m.entries[pageId].recoveryEdit.document).toEqual(own);
    expect(f.remote.get(pageId).document).toEqual(document());
    if (change === 'disappearance') {
      expect(m.entries[pageId].status).toBe('recovery_pending');
      f.put(f.path, encodeDocument(document('Restored external working edit')));
    }
    await f.until(async () => (await f.manifest()).entries[pageId].status === 'conflict');
    const saved = await f.manifest();
    expect(saved.entries[pageId].recoveryEdit.document).toEqual(own);
    expect(saved.entries[pageId].recoveryEdit.interveningFileId).toBe(
      (await f.client.latestFile(f.path)).id
    );
    expect(f.calls.filter((/** @type {string} */ c) => c === 'body')).toHaveLength(0);
  });
}

/** @param {any} f @param {any} own */
async function acceptEditorHandoff(f, own) {
  await createDocumentService({
    store: nativeStore(f.state),
    connection: f.state.connections[connectionId],
    crypto,
    client: f.client,
    notion: f.notion,
    credential: {}
  }).mutate({
    operation: 'save',
    id: pageId,
    expectedRevision: (await f.client.latestFile(f.path)).id,
    document: own
  });
  await f.until(async () => {
    const m = await f.manifest();
    return !m.pending && !m.queue[pageId] && !!m.entries[pageId].acceptedEdit;
  });
}

it.each(['invalid-document', 'invalid-bytes', 'source-404', 'source-unsupported'])(
  'retains accepted handoff text through %s and captures the later current working version',
  async (failure) => {
    const f = fixture();
    await initial(f);
    const own = document('Accepted Own awaiting Notion');
    await acceptEditorHandoff(f, own);
    const latest = f.client.latestFile;
    let invalidBytes = failure === 'invalid-bytes';
    let unsupported = failure === 'source-unsupported';
    const sourceRead = f.notion.read;
    if (unsupported)
      f.notion.read = async (/** @type {string} */ id) => ({
        ...(await sourceRead(id)),
        supported: !unsupported
      });
    if (invalidBytes)
      f.client.latestFile = async (/** @type {string} */ path) => {
        if (path === f.path && invalidBytes)
          throw Object.assign(Error('Invalid UTF8'), { code: 'ERR_ENCODING_INVALID_ENCODED_DATA' });
        return latest(path);
      };
    if (failure === 'invalid-document') f.put(f.path, 'Invalid working document');
    if (failure === 'source-404') f.remote.delete(pageId);
    await f.until(async () => !!(await f.manifest()).entries[pageId].recoveryEdit);
    expect((await f.manifest()).entries[pageId].recoveryEdit.document).toEqual(own);
    expect((await f.manifest()).pending).toBeNull();
    invalidBytes = false;
    unsupported = false;
    f.remote.set(pageId, { parent: null, document: document() });
    const later = f.put(f.path, encodeDocument(document('Current B after recovery')));
    await f.until(async () => (await f.manifest()).entries[pageId].status === 'conflict');
    const entry = (await f.manifest()).entries[pageId];
    expect(entry.recoveryEdit.document).toEqual(own);
    expect(entry.recoveryEdit.interveningFileIds).toContain(later.id);
    expect(entry.recoveryEdit.interveningFileId).toBe(later.id);
    expect(
      decodeDocument((await f.client.latestFile(entry.conflict.paths[1].path)).content)
    ).toEqual(own);
    expect(
      f.calls.filter((/** @type {string} */ call) => ['body', 'title', 'archive'].includes(call))
    ).toHaveLength(0);
  }
);

it('retains full desired text and current B when a pending Notion intent loses its source revision', async () => {
  const f = fixture();
  await initial(f);
  const own = document('Accepted Own pending provider');
  await acceptEditorHandoff(f, own);
  await f.until(async () => (await f.manifest()).pending?.kind === 'notion');
  const b = document('Current B replaces the accepted source');
  const file = f.put(f.path, encodeDocument(b));
  await f.until(async () => (await f.manifest()).entries[pageId].status === 'conflict');
  const entry = (await f.manifest()).entries[pageId];
  expect(entry.recoveryEdit.document).toEqual(own);
  expect(entry.recoveryEdit.interveningFileId).toBe(file.id);
  expect(decodeDocument((await f.client.latestFile(entry.conflict.paths[1].path)).content)).toEqual(
    own
  );
  expect(decodeDocument((await f.client.latestFile(f.path)).content)).toEqual(b);
  expect(f.remote.get(pageId).document).toEqual(document());
});

it('converts the accepted handoff marker to retained recovery when Notion changes before intent creation', async () => {
  const f = fixture();
  await initial(f);
  const own = document('Accepted Own before a remote handoff change');
  await acceptEditorHandoff(f, own);
  f.remote.get(pageId).document = document('Remote handoff edit');
  await f.until(async () => (await f.manifest()).entries[pageId].status === 'conflict');
  const entry = (await f.manifest()).entries[pageId];
  expect(entry.acceptedEdit).toBeUndefined();
  expect(entry.recoveryEdit.document).toEqual(own);
  expect(decodeDocument((await f.client.latestFile(entry.conflict.paths[1].path)).content)).toEqual(
    own
  );
  expect(
    f.calls.filter((/** @type {string} */ call) => ['body', 'title', 'archive'].includes(call))
  ).toHaveLength(0);
});

it.each(['invalid-document', 'source-404'])(
  'retains the complete pending Notion intent through %s and requires conflict review on recovery',
  async (failure) => {
    const f = fixture();
    await initial(f);
    const own = document('Own from the persisted Notion intent');
    await acceptEditorHandoff(f, own);
    await f.until(async () => (await f.manifest()).pending?.kind === 'notion');
    if (failure === 'invalid-document') f.put(f.path, 'Invalid newer source file');
    else f.remote.delete(pageId);
    await f.until(async () => !!(await f.manifest()).entries[pageId].recoveryEdit);
    const held = await f.manifest();
    expect(held.entries[pageId].recoveryEdit.document).toEqual(own);
    expect(held.pending).toBeNull();
    expect(held.entries[pageId].deferred).toBeUndefined();
    f.remote.set(pageId, { parent: null, document: document() });
    const b = f.put(f.path, encodeDocument(document('Valid current B after the failure')));
    await f.until(async () => (await f.manifest()).entries[pageId].status === 'conflict');
    const entry = (await f.manifest()).entries[pageId];
    expect(entry.recoveryEdit.document).toEqual(own);
    expect(entry.recoveryEdit.interveningFileId).toBe(b.id);
    expect(
      decodeDocument((await f.client.latestFile(entry.conflict.paths[1].path)).content)
    ).toEqual(own);
    expect(
      f.calls.filter((/** @type {string} */ call) => ['body', 'title', 'archive'].includes(call))
    ).toHaveLength(0);
  }
);

it.each(['replacement', 'disappearance'])(
  'holds a new-page accepted handoff after %s and creates once only after Own is repaired',
  async (change) => {
    const f = fixture();
    await initial(f);
    const own = document('Accepted new-page Own', 'New own page');
    const created = await createDocumentService({
      store: nativeStore(f.state),
      connection: f.state.connections[connectionId],
      crypto,
      client: f.client,
      notion: f.notion,
      credential: {}
    }).mutate({ operation: 'create', document: own });
    const path = `${f.folder}/${created.id}.md`;
    await f.until(async () => {
      const m = await f.manifest();
      return !m.pending && !m.queue[created.id] && !!m.entries[created.id].acceptedEdit;
    });
    if (change === 'replacement') f.put(path, encodeDocument(document('New-page B')));
    else f.files.delete(path);
    await f.until(
      async () => (await f.manifest()).entries[created.id].status === 'recovery_pending'
    );
    for (let i = 0; i < 8; i++) await f.tick();
    expect((await f.manifest()).entries[created.id].recoveryEdit.document).toEqual(own);
    expect(f.calls.filter((/** @type {string} */ call) => call === 'create')).toHaveLength(0);
    f.put(path, encodeDocument(own));
    await f.until(async () => (await f.manifest()).entries[created.id].status === 'synced', 160);
    expect(f.calls.filter((/** @type {string} */ call) => call === 'create')).toHaveLength(1);
    expect(f.remote.get(newId).document).toEqual(own);
    expect((await f.manifest()).entries[created.id].acceptedEdit).toBeUndefined();
  }
);

it('yields an unsupported pending Notion intent while retaining Own and allowing healthy pages to progress', async () => {
  const f = fixture();
  await initial(f);
  const own = document('Pending unsupported Own');
  await acceptEditorHandoff(f, own);
  await f.until(async () => (await f.manifest()).pending?.kind === 'notion');
  f.remote.set(newId, { parent: pageId, document: document('Healthy child') });
  const read = f.notion.read;
  f.notion.read = async (/** @type {string} */ id) => ({
    ...(await read(id)),
    supported: id !== pageId
  });
  await f.tick();
  expect((await f.manifest()).pending).toBeNull();
  expect((await f.manifest()).entries[pageId].recoveryEdit.document).toEqual(own);
  await f.until(async () => (await f.manifest()).entries[newId]?.status === 'synced');
  expect(f.calls.filter((/** @type {string} */ c) => c === 'body')).toHaveLength(0);
});

it('holds an active conflict with retained Own while the working file is missing without invalid-document retries', async () => {
  const f = fixture();
  await initial(f);
  const own = document('Retained conflict Own');
  await acceptEditorHandoff(f, own);
  f.put(f.path, encodeDocument(document('Working B')));
  await f.until(async () => (await f.manifest()).entries[pageId].status === 'conflict');
  const conflictId = (await f.manifest()).entries[pageId].conflict.id;
  f.files.delete(f.path);
  for (let i = 0; i < 15; i++) await f.tick();
  const m = await f.manifest();
  expect(m.entries[pageId].recoveryEdit.document).toEqual(own);
  expect(m.entries[pageId].conflict.id).toBe(conflictId);
  expect(f.state.connections[connectionId].lastError).toBeNull();
});

it.each([
  ['before-guard', 'replacement'],
  ['during-guard', 'replacement'],
  ['before-guard', 'missing'],
  ['during-guard', 'missing']
])(
  'rechecks new-page accepted bytes %s (%s) before the fresh provider POST',
  async (window, change) => {
    const f = fixture();
    await initial(f);
    const own = document('New accepted create Own', 'Accepted create');
    const result = await createDocumentService({
      store: nativeStore(f.state),
      connection: f.state.connections[connectionId],
      crypto,
      client: f.client,
      notion: f.notion,
      credential: {}
    }).mutate({ operation: 'create', document: own });
    const path = `${f.folder}/${result.id}.md`;
    await f.until(async () => {
      const p = (await f.manifest()).pending;
      return p?.kind === 'create' && p.phase === 'create';
    });
    if (window === 'before-guard') {
      if (change === 'missing') f.files.delete(path);
      else f.put(path, encodeDocument(document('B before guard')));
    } else {
      const upload = f.client.uploadFile;
      f.client.uploadFile = async (/** @type {string} */ p, /** @type {string} */ text) => {
        const r = await upload(p, text);
        if (p.includes('/.sync/create/')) {
          if (change === 'missing') f.files.delete(path);
          else f.put(path, encodeDocument(document('B during guard')));
        }
        return r;
      };
    }
    await f.tick();
    expect(f.calls.filter((/** @type {string} */ c) => c === 'create')).toHaveLength(0);
    expect((await f.manifest()).pending).toBeNull();
    expect((await f.manifest()).entries[result.id].recoveryEdit.document).toEqual(own);
  }
);
