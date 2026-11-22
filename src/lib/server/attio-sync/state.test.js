import { it, expect } from 'vitest';
import { freshState, nativeStore } from '../native/state.js';
import { seal } from '../secrets.js';
import { contentHash, canonical } from '../sync/identity.js';
import { memoryFiles } from './fixtures.js';
import {
  loadManifest,
  saveManifest,
  loadBucket,
  bucketEnvelope,
  bucketId,
  localId,
  folder,
  reserveEdit
} from './state.js';
const crypto = { key: Buffer.alloc(32, 7).toString('base64'), keyId: 'v1' };
const workspace = '11111111-1111-4111-8111-111111111111',
  object = '22222222-2222-4222-8222-222222222222';
const connection = () => ({
  id: '33333333-3333-4333-8333-333333333333',
  connector: 'attio',
  account_id: workspace,
  config: {
    resources: [`${object}:44444444-4444-4444-8444-444444444444`],
    route: { mode: 'file', folder: '/attio' },
    attio: { twoWay: true, includeNotes: true, writableAttributes: {} },
    intervalSeconds: 60
  }
});
function fixture() {
  const c = connection(),
    state = freshState('deployment', 'owner');
  state.connections[c.id] = c;
  return { c, state, store: nativeStore(state), ...memoryFiles() };
}
it('stores a compact encrypted manifest and binds scope while allowing schedule changes', async () => {
  const f = fixture(),
    m = await loadManifest(f.store, f.c, crypto);
  expect(m.buckets).toEqual({});
  expect(m.queue).toEqual([]);
  await saveManifest(f.store, f.c, m, crypto);
  expect(JSON.stringify(f.state.grants)).not.toContain('writableAttributes');
  f.c.config.intervalSeconds = 300;
  expect((await loadManifest(f.store, f.c, crypto)).scopeHash).toBe(m.scopeHash);
  f.c.config.attio.includeNotes = false;
  await expect(loadManifest(f.store, f.c, crypto)).rejects.toThrow(/scope/i);
});
it('reads a bucket by immutable authenticated reference and fails closed on missing or tampered bytes', async () => {
  const f = fixture(),
    m = await loadManifest(f.store, f.c, crypto),
    id = localId(f.c, 'record', f.c.config.resources[0]),
    prefix = bucketId(id);
  const bucket = {
    version: 1,
    prefix,
    entries: { [id]: { id, kind: 'record', title: 'Private candidate' } }
  };
  const packed = bucketEnvelope(f.store, f.c, bucket, crypto),
    file = f.put(folder(f.c) + '/.state/' + prefix + '.json', packed.content);
  m.buckets[prefix] = { fileId: file.id, hash: packed.hash, semanticHash: packed.semanticHash };
  expect((await loadBucket(m, prefix, f.client, f.store, f.c, crypto)).entries[id].title).toBe(
    'Private candidate'
  );
  file.content += 'x';
  await expect(loadBucket(m, prefix, f.client, f.store, f.c, crypto)).rejects.toThrow(
    /bucket|evidence/i
  );
  file.state = 'deleted';
  await expect(loadBucket(m, prefix, f.client, f.store, f.c, crypto)).rejects.toThrow(
    /unavailable/i
  );
});
it('rejects cross-owner encrypted bucket copies even with a matching byte hash', async () => {
  const f = fixture(),
    m = await loadManifest(f.store, f.c, crypto),
    prefix = 'aa';
  const content = JSON.stringify(
      seal({ version: 1, prefix, entries: {} }, 'foreign-owner', crypto)
    ),
    file = f.put('/foreign', content);
  m.buckets[prefix] = {
    fileId: file.id,
    hash: contentHash(content),
    semanticHash: contentHash(canonical({ version: 1, prefix, entries: {} }))
  };
  await expect(loadBucket(m, prefix, f.client, f.store, f.c, crypto)).rejects.toThrow();
});
it('partitions 1,000 records plus 1,000 notes without putting all entities in controller state', async () => {
  const f = fixture(),
    m = await loadManifest(f.store, f.c, crypto),
    grouped = /** @type {Record<string,any>} */ ({});
  for (let n = 0; n < 2000; n++) {
    const kind = n < 1000 ? 'record' : 'note',
      id = localId(f.c, kind, String(n)),
      prefix = bucketId(id);
    (grouped[prefix] ??= { version: 1, prefix, entries: {} }).entries[id] = {
      id,
      kind,
      title: 'Synthetic ' + n,
      status: 'synced',
      baseline: {
        schemaHash: 's',
        protectedHash: 'p',
        fields: { title: 'a'.repeat(64), body: 'b'.repeat(64) }
      }
    };
  }
  for (const [prefix, b] of Object.entries(grouped)) {
    const packed = bucketEnvelope(f.store, f.c, b, crypto),
      file = f.put(folder(f.c) + '/.state/' + prefix + '.json', packed.content);
    m.buckets[prefix] = { fileId: file.id, hash: packed.hash, semanticHash: packed.semanticHash };
  }
  await saveManifest(f.store, f.c, m, crypto);
  expect(Buffer.byteLength(JSON.stringify(m))).toBeLessThan(100 * 1024);
  expect(Object.values(grouped).every((b) => Object.keys(b.entries).length <= 64)).toBe(true);
  let count = 0;
  for (const prefix of Object.keys(m.buckets))
    count += Object.keys(
      (await loadBucket(m, prefix, f.client, f.store, f.c, crypto)).entries
    ).length;
  expect(count).toBe(2000);
  expect(Buffer.byteLength(JSON.stringify(f.state))).toBeLessThan(1536 * 1024);
});
it('reserves recovery headroom before accepting an edit and never mutates the queue on rejection', async () => {
  const f = fixture(),
    m = await loadManifest(f.store, f.c, crypto);
  expect(() => reserveEdit(m, { text: 'small' })).not.toThrow();
  m.queue = Array.from({ length: 5 }, (_, n) => ({
    id: String(n),
    document: { text: 'accepted' }
  }));
  const before = JSON.stringify(m);
  expect(() => reserveEdit(m, { text: 'new' })).toThrow(/capacity/i);
  expect(JSON.stringify(m)).toBe(before);
});
