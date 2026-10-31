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
