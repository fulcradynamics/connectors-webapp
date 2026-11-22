import { describe, expect, it } from 'vitest';
import {
  advanceIndex,
  indexStatus,
  queueIndex,
  renderBucket,
  renderGroup,
  renderRoot
} from './index.js';
import { bucketEnvelope, bucketId, folder, localId } from './state.js';
import { memoryFiles } from './fixtures.js';
const c = {
  id: '11111111-1111-4111-a111-111111111111',
  account_id: '22222222-2222-4222-a222-222222222222',
  config: {
    route: { folder: '/attio' },
    resources: ['33333333-3333-4333-a333-333333333333:44444444-4444-4444-a444-444444444444']
  }
};
/** @returns {any} */
const make = () => ({ buckets: {}, queue: [], index: { state: 'pending' } });
/** @param {number} n @param {string} kind @returns {any} */
function entry(n, kind = 'record') {
  const id = localId(c, kind, String(n));
  return {
    id,
    kind,
    title: `Person [${n}](javascript:bad)\nnext`,
    status: 'current',
    fileId: `verified-${n}`,
    baseline: {},
    resourceId: c.config.resources[0],
    binding: {
      workspaceId: c.account_id,
      objectId: c.config.resources[0].split(':')[0],
      recordId: c.config.resources[0].split(':')[1]
    },
    sourceUrl: 'https://app.attio.com/example'
  };
}
/** @param {any} input @param {any} transport @param {number} max @returns {Promise<any>} */
async function drain(input, transport, max = 50) {
  let m = input;
  for (let i = 0; i < max; i++) {
    const more = await advanceIndex(m, c, transport.client, {}, {});
    m = JSON.parse(JSON.stringify(m));
    if (!more) return m;
  }
  throw Error('Index did not finish');
}
describe('Attio bounded navigation', () => {
  it('keeps 2000 records/notes in bounded bucket/group/root navigation', () => {
    const buckets = new Map();
    /** @type {any} */ const summaries = {};
    /** @type {any} */ const groups = {};
    for (let n = 0; n < 2000; n++) {
      const e = entry(n, n < 1000 ? 'record' : 'note'),
        p = bucketId(e.id);
      if (!buckets.has(p)) buckets.set(p, {});
      buckets.get(p)[e.id] = e;
    }
    let rows = 0;
    for (const [prefix, entries] of buckets) {
      const text = renderBucket({ version: 1, prefix, entries }, c);
      rows += Object.keys(entries).length;
      expect(Buffer.byteLength(text)).toBeLessThan(64 * 1024);
      expect(Object.keys(entries).length).toBeLessThanOrEqual(64);
      expect(text).toContain('../index.md');
      summaries[prefix] = {
        count: Object.keys(entries).length,
        verified: Object.keys(entries).length,
        conflicts: 0,
        state: 'current',
        revision: 'a'.repeat(64),
        fileId: 'published'
      };
    }
    for (const hex of '0123456789abcdef') {
      const text = renderGroup(hex, summaries);
      expect((text.match(/\]\([a-f0-9]{2}\.md\)/g) ?? []).length).toBe(16);
      expect(Buffer.byteLength(text)).toBeLessThan(8192);
      groups[hex] = { state: 'current', revision: 'b'.repeat(64), fileId: 'published' };
    }
    const root = renderRoot(summaries, groups);
    expect(rows).toBe(2000);
    expect((root.match(/\.index\/g-/g) ?? []).length).toBe(16);
    expect(Buffer.byteLength(root)).toBeLessThan(8192);
    expect(root).not.toContain('Person');
  });
  it('bounds even full 64-entry pages with long labels and source URLs', () => {
    /** @type {any} */ const entries = {};
    let n = 0;
    while (Object.keys(entries).length < 64) {
      const e = entry(n++);
      if (bucketId(e.id) !== 'aa') continue;
      e.title = '界'.repeat(500);
      e.status = '界'.repeat(100);
      e.fileId = 'r'.repeat(128);
      e.sourceUrl = 'https://app.attio.com/' + 'x'.repeat(4000);
      entries[e.id] = e;
    }
    expect(Buffer.byteLength(renderBucket({ prefix: 'aa', entries }, c))).toBeLessThanOrEqual(
      64 * 1024
    );
  });
  it('escapes data and links only verified bound copies and conflict evidence', () => {
    const e = entry(1),
      p = bucketId(e.id),
      path = `${folder(c)}/.conflicts/${e.id}/provider.json`;
    e.conflict = {
      id: e.id,
      paths: [
        { path, fileId: 'evidence', hash: 'a'.repeat(64), view: 'provider' },
        { path: '/other/private', fileId: 'bad', hash: 'b'.repeat(64), view: 'fulcra' }
      ]
    };
    const text = renderBucket({ prefix: p, entries: { [e.id]: e } }, c);
    expect(text).toContain(`../records/${p}/${e.id}.json`);
    expect(text).toContain('verified revision: `verified-1`');
    expect(text).toContain(`../.conflicts/${e.id}/provider.json`);
    expect(text).not.toContain('/other/private');
    expect(text).not.toContain('[1](javascript:bad)');
    e.baseline = null;
    e.sourceUrl = 'https://evil.example/';
    const unverified = renderBucket({ prefix: p, entries: { [e.id]: e } }, c);
    expect(unverified).not.toContain(`../records/${p}/${e.id}.json`);
    expect(unverified).toContain('No verified working copy');
    expect(unverified).not.toContain('https://evil');
    e.baseline = {};
    e.binding.recordId = '55555555-5555-4555-a555-555555555555';
    const forged = renderBucket({ prefix: p, entries: { [e.id]: e } }, c);
    expect(forged).not.toContain(`../records/${p}/${e.id}.json`);
    expect(forged).not.toContain('provider evidence]');
  });
  it('publishes one persisted phase, resumes after lost transfer reply, and does not echo unchanged content', async () => {
    const t = memoryFiles(),
      e = entry(2),
      p = bucketId(e.id);
    let m = make();
    m.activeBucket = { version: 1, prefix: p, entries: { [e.id]: e } };
    queueIndex(m, p);
    queueIndex(m, p);
    expect(m.indexQueue).toEqual([p]);
    const transfer = t.client.transferFile;
    let lose = true;
    t.client.transferFile = async (...args) => {
      await transfer(...args);
      if (lose) {
        lose = false;
        throw Error('private provider error');
      }
    };
    for (let i = 0; i < 12 && m.index.state !== 'retry'; i++) {
      await advanceIndex(m, c, t.client, {}, {});
      m = JSON.parse(JSON.stringify(m));
    }
    expect(m.index.state).toBe('retry');
    expect(m.index.error).not.toContain('private');
    expect(m.indexPending).toBeTruthy();
    m = await drain(m, t);
    expect(indexStatus(m, c).state).toBe('current');
    expect(t.calls.filter((x) => x === 'transfer')).toHaveLength(3);
    const count = t.calls.length;
    m.index.publishedAt = 'original-publication';
    queueIndex(m, p);
    m = await drain(m, t);
    expect(t.calls).toHaveLength(count);
    expect(indexStatus(m, c).revision).toBeTruthy();
    expect(indexStatus(m, c).publishedAt).toBe('original-publication');
  });
  it('retains a failed index intent while accepting another bucket queue', async () => {
    const t = memoryFiles(),
      e = entry(3),
      p = bucketId(e.id);
    const m = make();
    m.activeBucket = { version: 1, prefix: p, entries: { [e.id]: e } };
    queueIndex(m, p);
    t.client.fileState = async () => {
      throw Error('sensitive');
    };
    expect(await advanceIndex(m, c, t.client, {}, {})).toBe(true);
    expect(m.index.state).toBe('retry');
    queueIndex(m, 'ff');
    expect(m.indexQueue).toContain('ff');
    expect(indexStatus(m, c).state).toBe('retry');
  });

  it('regenerates after an intervening index edit and queued document update without replaying the old view', async () => {
    const t = memoryFiles(),
      e = entry(4),
      p = bucketId(e.id);
    let m = make();
    m.activeBucket = { version: 1, prefix: p, entries: { [e.id]: e } };
    queueIndex(m, p);
    for (let i = 0; i < 3; i++) await advanceIndex(m, c, t.client, {}, {});
    const path = m.indexPending.intent.path;
    t.put(path, 'external generated-index edit');
    await advanceIndex(m, c, t.client, {}, {});
    expect(m.index.state).toBe('retry');
    expect(m.indexPending.previous[0].interveningFileIds.length).toBeGreaterThan(0);
    e.title = 'Updated title';
    queueIndex(m, p);
    m = await drain(m, t, 100);
    expect((await t.client.fileState(path)).file.content).toContain('Updated title');
    expect(m.indexQueue).toEqual([]);
  });
  it('loads immutable encrypted buckets for full 2000-entity publication with compact restart state', async () => {
    const t = memoryFiles(),
      store = { deploymentId: 'test-deployment', ownerId: 'test-owner' },
      crypto = { key: Buffer.alloc(32, 7).toString('base64'), keyId: 'v1' };
    let m = make();
    const buckets = new Map();
    for (let n = 0; n < 2000; n++) {
      const e = entry(n, n < 1000 ? 'record' : 'note'),
        p = bucketId(e.id);
      if (!buckets.has(p)) buckets.set(p, { version: 1, prefix: p, entries: {} });
      buckets.get(p).entries[e.id] = e;
    }
    for (const [p, bucket] of buckets) {
      const packed = bucketEnvelope(store, c, bucket, crypto),
        file = t.put(`${folder(c)}/.state/${p}.json`, packed.content);
      m.buckets[p] = { fileId: file.id, hash: packed.hash, semanticHash: packed.semanticHash };
      queueIndex(m, p);
    }
    let more = true;
    for (let i = 0; more && i < 5000; i++) {
      more = await advanceIndex(m, c, t.client, store, crypto);
      m = JSON.parse(JSON.stringify(m));
    }
    expect(more).toBe(false);
    expect(Object.values(m.indexSummary).reduce((n, s) => n + s.count, 0)).toBe(2000);
    expect(JSON.stringify(m)).not.toContain('Person');
    expect(Buffer.byteLength(JSON.stringify(m))).toBeLessThan(180 * 1024);
    const root = (await t.client.fileState(indexStatus(m, c).path)).file;
    expect(root.content).toContain('2000 documents');
    expect(root.content.match(/\.index\/g-/g)).toHaveLength(16);
  });
  it('publishes an explicit empty baseline without claiming verified working documents', async () => {
    const t = memoryFiles(),
      m = await drain(make(), t);
    const file = (await t.client.fileState(indexStatus(m, c).path)).file;
    expect(file.content).toContain('No verified working copies');
    expect(file.content).not.toContain('](.index/');
    expect(indexStatus(m, c).state).toBe('current');
  });
});
