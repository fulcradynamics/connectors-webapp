import { it, expect } from 'vitest';
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
        supported: true,
        titleProperty: 'title',
        document: structuredClone(remote.get(id).document)
      };
    },
    children: async (/** @type {string} */ parent) => ({
      pages: [...remote.entries()]
        .filter(([, p]) => p.parent === parent)
        .map(([id, p]) => ({ id, title: p.document.title })),
      cursor: null
    }),
    createMarker: async (/** @type {string} */ parent) => {
      calls.push('create');
      remote.set(newId, { parent, document: document('', markerTitle(newId)) });
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
  f.notion.setBody = async (.../** @type {any[]} */ args) => {
    await original(...args);
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
