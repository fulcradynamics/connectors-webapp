import { it, expect } from 'vitest';
import { createDocumentService } from './service.js';
import { freshState, nativeStore } from '../native/state.js';
import { loadManifest, saveManifest, workingFolder } from './state.js';
import { encodeDocument, documentHash } from './document.js';
const crypto = { key: Buffer.alloc(32, 7).toString('base64'), keyId: 'v1' };
const id = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222';
const doc = { title: 'Demo', markdown: 'Hello', archived: false };
function fixture() {
  const state = freshState('deployment', 'owner'),
    store = nativeStore(state);
  const connection = {
    id: '33333333-3333-4333-8333-333333333333',
    connector: 'notion',
    generation: 1,
    status: 'ready',
    config: {
      resources: [id],
      intervalSeconds: 60,
      route: { mode: 'file', folder: '/notion' },
      twoWay: { enabled: true, parentId: id }
    }
  };
  state.connections[connection.id] = connection;
  const file = { id: 'version-1', content: encodeDocument(doc), versions: [] };
  /** @type {{ latestFile: () => Promise<any> }} */
  const client = { latestFile: async () => file };
  const notion = { read: async () => ({ supported: true, document: doc }) };
  const service = createDocumentService({
    store,
    connection,
    crypto,
    client,
    notion,
    credential: {}
  });
  return { state, store, connection, file, service, client, notion };
}
it('queues owner edits with a current file revision and rejects foreign IDs/stale edits', async () => {
  const f = fixture();
  await expect(
    f.service.mutate({ operation: 'save', id: other, document: doc, expectedRevision: 'version-1' })
  ).rejects.toThrow(/scope|selected/i);
  await expect(
    f.service.mutate({ operation: 'save', id, document: doc, expectedRevision: 'stale' })
  ).rejects.toThrow(/changed|newer/i);
  const result = await f.service.mutate({
    operation: 'save',
    id,
    document: { ...doc, markdown: 'Edited' },
    expectedRevision: 'version-1'
  });
  expect(result.queued).toBe(true);
  const m = await loadManifest(f.store, f.connection, crypto);
  expect(m.queue[id].document.markdown).toBe('Edited');
  expect(f.file.content).toBe(encodeDocument(doc));
});
it('creates a local intent under the configured parent and rejects supplied provider routing', async () => {
  const f = fixture();
  await expect(
    f.service.mutate({ operation: 'create', document: doc, parentId: other })
  ).rejects.toThrow(/fields/i);
  const result = await f.service.mutate({ operation: 'create', document: doc });
  const m = await loadManifest(f.store, f.connection, crypto);
  expect(m.entries[result.id].parentId).toBe(id);
  expect(m.queue[result.id].expectedRevision).toBe(null);
  expect(JSON.stringify(f.state.grants)).not.toContain('Hello');
});
it('does not accept writes before enablement or on unsupported backends', async () => {
  const f = fixture();
  f.connection.status = 'paused';
  await expect(f.service.mutate({ operation: 'create', document: doc })).rejects.toThrow(/Enable/i);
  f.connection.status = 'ready';
  f.store.supportsTwoWay = false;
  await expect(f.service.list()).rejects.toThrow(/native/i);
});
it('returns a revision and server-owned working path without provider credentials', async () => {
  const f = fixture();
  const result = await f.service.read(id);
  expect(result.document).toEqual(doc);
  expect(result.revision).toBe('version-1');
  expect(result.path).toBe(`${workingFolder(f.connection)}/${id}.md`);
  expect(JSON.stringify(result)).not.toMatch(/credential|token/);
});
it('requires reviewed current conflict hashes and can queue the retained Fulcra version', async () => {
  const f = fixture();
  const m = await loadManifest(f.store, f.connection, crypto);
  m.entries[id].status = 'conflict';
  m.entries[id].conflict = {
    id: other,
    paths: [
      { path: '/n', hash: 'n' },
      { path: '/f', hash: 'f' }
    ],
    expectedCurrent: { notion: documentHash(doc), fulcra: documentHash(doc) }
  };
  await saveManifest(f.store, f.connection, m, crypto);
  await expect(
    f.service.mutate({
      operation: 'resolve',
      id,
      choice: 'fulcra',
      conflictId: other,
      expectedRevision: 'stale',
      expectedNotion: documentHash(doc)
    })
  ).rejects.toThrow(/changed|newer/i);
});
it('rejects a resolution of retained snapshots after a newer unreviewed Notion edit', async () => {
  const f = fixture(),
    m = await loadManifest(f.store, f.connection, crypto);
  m.entries[id].status = 'conflict';
  m.entries[id].conflict = {
    id: other,
    paths: [],
    expectedCurrent: { notion: documentHash(doc), fulcra: documentHash(doc) }
  };
  await saveManifest(f.store, f.connection, m, crypto);
  const unreviewed = { ...doc, markdown: 'Not reviewed in the conflict UI' };
  f.notion.read = async () => ({ supported: true, document: unreviewed });
  await expect(
    f.service.mutate({
      operation: 'resolve',
      id,
      choice: 'fulcra',
      conflictId: other,
      expectedRevision: 'version-1',
      expectedNotion: documentHash(unreviewed)
    })
  ).rejects.toThrow(/Conflict changed/i);
});
it('uses the same preserved archived body when reviewing and resolving a conflict', async () => {
  const f = fixture(),
    m = await loadManifest(f.store, f.connection, crypto);
  const archived = { ...doc, archived: true };
  const { contentHash } = await import('../sync/identity.js');
  const remoteText = encodeDocument(archived),
    localText = encodeDocument(doc);
  m.entries[id].baseline = { notion: documentHash(doc), fulcra: documentHash(doc) };
  m.entries[id].baselineFileId = 'baseline';
  m.entries[id].status = 'conflict';
  m.entries[id].conflict = {
    id: other,
    paths: [
      { path: '/n', fileId: 'remote-snapshot', hash: contentHash(remoteText) },
      { path: '/f', fileId: 'local-snapshot', hash: contentHash(localText) }
    ],
    expectedCurrent: { notion: documentHash(archived), fulcra: documentHash(doc) }
  };
  await saveManifest(f.store, f.connection, m, crypto);
  const service = createDocumentService({
    store: f.store,
    connection: f.connection,
    crypto,
    credential: {},
    client: {
      ...f.client,
      readFileBytes: async (/** @type {string} */ fileId) =>
        new TextEncoder().encode(fileId === 'remote-snapshot' ? remoteText : localText)
    },
    notion: {
      read: async () => ({
        supported: true,
        bodyUnavailable: true,
        document: { ...archived, markdown: '' }
      })
    }
  });
  const opened = await service.read(id);
  expect(opened.expectedNotion).toBe(documentHash(archived));
  expect(
    await service.mutate({
      operation: 'resolve',
      id,
      choice: 'fulcra',
      conflictId: other,
      expectedRevision: opened.revision,
      expectedNotion: opened.expectedNotion
    })
  ).toEqual({ id, queued: true });
});
it('queues every mapped page for an explicit full sync while retaining existing priorities', async () => {
  const f = fixture(),
    m = await loadManifest(f.store, f.connection, crypto);
  m.entries[other] = {
    localId: other,
    notionId: other,
    parentId: id,
    origin: 'child',
    status: 'synced'
  };
  m.priority = [other];
  await saveManifest(f.store, f.connection, m, crypto);
  await f.service.mutate({ operation: 'sync' });
  const saved = await loadManifest(f.store, f.connection, crypto);
  expect(saved.priority).toEqual([other, id]);
  expect(saved.scanRequested).toBe(true);
});

it('initializes the first pass with every selected page ready to run', async () => {
  const f = fixture();
  const m = await loadManifest(f.store, f.connection, crypto);
  expect(m.priority).toEqual([id]);
});

it('keeps a held saved edit readable when the working file is missing and blocks replacing it', async () => {
  const f = fixture(),
    m = await loadManifest(f.store, f.connection, crypto);
  m.entries[id].recoveryEdit = { document: { ...doc, markdown: 'Retained accepted text' } };
  m.entries[id].status = 'recovery_pending';
  await saveManifest(f.store, f.connection, m, crypto);
  f.client.latestFile = async () => null;
  const read = await f.service.read(id);
  expect(read.document.markdown).toBe('Retained accepted text');
  expect(read.queued).toBe(true);
});
for (const operation of ['save', 'archive', 'resolve']) {
  it(`rejects ${operation} while that document is syncing`, async () => {
    const f = fixture(),
      m = await loadManifest(f.store, f.connection, crypto);
    m.pending = { kind: 'file', entryId: id, purpose: 'pull', phase: 'guard' };
    await saveManifest(f.store, f.connection, m, crypto);
    const action = {
      operation,
      id,
      expectedRevision: 'version-1',
      ...(operation === 'save'
        ? { document: doc }
        : operation === 'archive'
          ? { archived: true }
          : { choice: 'notion', conflictId: other, expectedNotion: 'x' })
    };
    await expect(f.service.mutate(action)).rejects.toThrow(/syncing.*wait.*reload/i);
    expect((await loadManifest(f.store, f.connection, crypto)).queue[id]).toBeUndefined();
  });
}
it('keeps held saved text readable when working-file bytes cannot be decoded', async () => {
  const f = fixture(),
    m = await loadManifest(f.store, f.connection, crypto);
  m.entries[id].recoveryEdit = { document: { ...doc, markdown: 'Retained accepted text' } };
  await saveManifest(f.store, f.connection, m, crypto);
  f.client.latestFile = async () => {
    new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array([0xc3, 0x28]));
    return null;
  };
  expect((await f.service.read(id)).document.markdown).toBe('Retained accepted text');
});

it('rejects managed scope/layout edits and forged managed new pages before queue acceptance', async () => {
  const { encodeManaged } = await import('../../notion-managed.js');
  const f = fixture();
  const capsule = {
    version: 1,
    pageId: id,
    blocks: [
      {
        id,
        type: 'paragraph',
        editable: true,
        texts: ['Original'],
        styles: [{ annotations: {}, link: null }],
        attributes: { color: 'default' }
      }
    ]
  };
  const managed = { ...doc, markdown: encodeManaged(capsule) };
  f.file.content = encodeDocument(managed);
  await expect(f.service.mutate({ operation: 'create', document: managed })).rejects.toThrow(
    /managed/i
  );
  const invalid = structuredClone(capsule);
  invalid.blocks[0].attributes.color = 'red';
  await expect(
    f.service.mutate({
      operation: 'save',
      id,
      expectedRevision: 'version-1',
      document: { ...managed, markdown: encodeManaged(invalid) }
    })
  ).rejects.toThrow(/managed/i);
  const m = await loadManifest(f.store, f.connection, crypto);
  expect(Object.keys(m.queue)).toHaveLength(0);
  const edit = structuredClone(capsule);
  edit.blocks[0].texts = ['Allowed'];
  await expect(
    f.service.mutate({
      operation: 'save',
      id,
      expectedRevision: 'version-1',
      document: { ...managed, markdown: encodeManaged(edit) }
    })
  ).resolves.toMatchObject({ queued: true });
});

it('resolves chosen Fulcra mixed text while preserving freshly reviewed opaque content', async () => {
  const { encodeManaged, parseManaged } = await import('../../notion-managed.js');
  const { contentHash } = await import('../sync/identity.js');
  const f = fixture();
  const capsule = {
    version: 1,
    pageId: id,
    blocks: [
      {
        id,
        type: 'paragraph',
        editable: true,
        texts: ['Chosen Fulcra text'],
        styles: [{}],
        attributes: {}
      },
      { id: other, type: 'embed', editable: false, snapshot: { url: 'https://example.com/old' } }
    ]
  };
  const chosen = { ...doc, markdown: encodeManaged(capsule) };
  const fresh = structuredClone(capsule);
  fresh.blocks[0].texts = ['Current source text'];
  fresh.blocks[1].snapshot = { url: 'https://example.com/new' };
  const remote = { ...doc, markdown: encodeManaged(fresh) };
  f.file.content = encodeDocument(chosen);
  const m = await loadManifest(f.store, f.connection, crypto);
  m.entries[id].status = 'conflict';
  m.entries[id].conflict = {
    id: other,
    paths: [
      { path: '/n', hash: contentHash(encodeDocument(remote)) },
      { path: '/f', hash: contentHash(encodeDocument(chosen)) }
    ],
    expectedCurrent: { notion: documentHash(remote), fulcra: documentHash(chosen) }
  };
  await saveManifest(f.store, f.connection, m, crypto);
  const service = createDocumentService({
    store: f.store,
    connection: f.connection,
    crypto,
    credential: {},
    client: {
      latestFile: async (/** @type {string} */ path) =>
        path === '/f' ? { content: encodeDocument(chosen) } : f.file
    },
    notion: { read: async () => ({ supported: true, document: remote }) }
  });
  await service.mutate({
    operation: 'resolve',
    id,
    choice: 'fulcra',
    conflictId: other,
    expectedRevision: 'version-1',
    expectedNotion: documentHash(remote)
  });
  const saved = await loadManifest(f.store, f.connection, crypto);
  const queued = saved.queue[id].document;
  expect(parseManaged(queued.markdown).blocks[0].texts).toEqual(['Chosen Fulcra text']);
  expect(parseManaged(queued.markdown).blocks[1]).toEqual(fresh.blocks[1]);
  expect(saved.resolutions[id].fulcra).toBe(documentHash(queued));
});
