import { indexStatusView } from './index.js';
import { it, expect } from 'vitest';
import { renderIndex, prepareIndex, advanceIndex, indexPath } from './index.js';
const a = '11111111-1111-4111-8111-111111111111',
  b = '22222222-2222-4222-8222-222222222222',
  c = '33333333-3333-4333-8333-333333333333';
const connection = { id: c, label: 'Demo', config: { route: { folder: '/notion' } } };
/** @returns {any} */
const entry = (id = a) => ({
  localId: id,
  notionId: id,
  title: 'Example',
  status: 'synced',
  archived: false,
  baseline: { notion: 'n', fulcra: 'f' },
  baselineFileId: 'verified-file',
  contentUpdatedAt: '2026-10-31T12:00:00Z'
});
it('renders a plain OKF-style index with safe source/copy links and visible unsupported pages', () => {
  /** @type {any} */
  const m = {
    entries: {
      [a]: entry(),
      [b]: {
        ...entry(b),
        title: 'Unsupported page',
        status: 'unsupported',
        baseline: undefined,
        baselineFileId: undefined
      }
    }
  };
  const x = renderIndex(connection, m);
  expect(x.content.startsWith('---')).toBe(false);
  expect(x.content).toContain('## Synced');
  expect(x.content).toContain(`(${a}.md)`);
  expect(x.content).toContain('https://www.notion.so/' + a.replaceAll('-', ''));
  expect(x.content).toContain('## Needs attention');
  expect(x.content).toContain('No verified working copy');
  expect(x.content).not.toContain(`(${b}.md)`);
});
it('distinguishes archived/conflict/pending copies and links retained conflict versions', () => {
  /** @type {any} */
  const m = {
    entries: {
      [a]: { ...entry(), archived: true },
      [b]: {
        ...entry(b),
        status: 'conflict',
        conflict: {
          paths: [
            { path: `/notion/live/${c}/.conflicts/${a}/notion.md` },
            { path: `/notion/live/${c}/.conflicts/${a}/fulcra.md` }
          ]
        }
      },
      [c]: { localId: c, notionId: null, title: 'New', status: 'pending', fileId: 'unverified' }
    }
  };
  const text = renderIndex(connection, m).content;
  expect(text).toContain('## Archived');
  expect(text).toContain('## Conflicts');
  expect(text).toContain(`(.conflicts/${a}/fulcra.md)`);
  expect(text).toContain('## Pending');
  expect(text).not.toContain(`(${c}.md)`);
});
it('escapes provider labels and omits bodies, grants, errors and arbitrary routing fields', () => {
  const e = {
    ...entry(),
    title: '[x](https://evil.invalid) <script>\n# injected',
    error: 'secret',
    document: { markdown: 'private body' },
    credential: { token: 'secret' },
    url: 'https://evil.invalid'
  };
  const text = renderIndex(connection, { entries: { [a]: e } }).content;
  expect(text).not.toContain('<script>');
  expect(text).not.toContain('\n# injected');
  expect(text).not.toContain('[x](https://evil.invalid)');
  expect(text).not.toMatch(/secret|private body/);
  expect(() =>
    renderIndex(connection, { entries: { bad: { ...entry(), localId: '../bad' } } })
  ).toThrow(/ID/);
});
it('ignores routine verification timestamps but reacts to verified revisions and meaningful state', () => {
  /** @type {any} */
  const m = { entries: { [a]: entry() } };
  const before = renderIndex(connection, m);
  m.entries[a].lastVerified = '2099-01-01T00:00:00Z';
  expect(renderIndex(connection, m)).toEqual(before);
  m.entries[a].baselineFileId = 'new-version';
  expect(renderIndex(connection, m).viewHash).not.toBe(before.viewHash);
});
it('bounds fifty maximum escaped Unicode labels and conflict references below the readback limit', () => {
  const entries = Object.fromEntries(
    Array.from({ length: 50 }, (_, i) => {
      const id = `${i.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
      return [
        id,
        {
          ...entry(id),
          title: '&<>[😀]'.repeat(30).slice(0, 200),
          status: 'conflict',
          conflict: {
            paths: [
              { path: `/notion/live/${c}/.conflicts/${a}/notion.md` },
              { path: `/notion/live/${c}/.conflicts/${a}/fulcra.md` }
            ]
          }
        }
      ];
    })
  );
  expect(Buffer.byteLength(renderIndex(connection, { entries }).content)).toBeLessThan(60 * 1024);
});
function files() {
  /** @type {any} */
  let latest = null;
  let seq = 0,
    allocations = 0,
    transfers = 0,
    delay = false,
    lost = false;
  const bytes = new Map();
  return {
    get latest() {
      return latest;
    },
    get allocations() {
      return allocations;
    },
    get transfers() {
      return transfers;
    },
    set delay(/** @type {boolean} */ x) {
      delay = x;
    },
    set lost(/** @type {boolean} */ x) {
      lost = x;
    },
    client: {
      latestFile: async () => latest,
      allocateFile: async () => {
        allocations++;
        return { file: { id: 'index-' + ++seq }, url: 'https://upload.test/' + seq };
      },
      transferFile: async (/** @type {any} */ upload, /** @type {string} */ content) => {
        transfers++;
        const id = 'index-' + upload.url.split('/').at(-1);
        if (!delay) {
          bytes.set(id, content);
          latest = { id, content, versions: [{ id }] };
        }
        if (lost) {
          lost = false;
          throw Error('lost transfer reply');
        }
      },
      listFiles: async () =>
        latest
          ? [{ ...latest, name: 'index.md', state: 'uploaded', created_at: '2026-10-31T00:00:00Z' }]
          : []
    },
    put(/** @type {string} */ content) {
      latest = { id: 'manual-' + ++seq, content, versions: [{ id: 'manual-' + seq }] };
    }
  };
}
/** @param {any} m @param {any} f */
async function publish(m, f) {
  for (let n = 0; n < 10 && m.indexPending; n++) await advanceIndex(m, connection, f.client);
  expect(m.indexPending).toBeFalsy();
}
it('publishes with persisted phases and exact readback; unchanged syncs create no versions', async () => {
  /** @type {any} */
  const m = { index: 7, entries: { [a]: entry() } },
    f = files();
  prepareIndex(m, connection);
  expect(f.allocations).toBe(0);
  await publish(m, f);
  expect(m.index).toBe(7);
  expect(m.indexStatus.state).toBe('current');
  expect(f.latest.content).toBe(renderIndex(connection, m).content);
  const n = f.allocations;
  prepareIndex(m, connection, true);
  await publish(m, f);
  expect(f.allocations).toBe(n);
  expect(indexPath(connection)).toBe(`/notion/live/${c}/index.md`);
});
it('recovers a committed transfer response loss without another upload', async () => {
  /** @type {any} */
  const m = { entries: { [a]: entry() } },
    f = files();
  prepareIndex(m, connection);
  await advanceIndex(m, connection, f.client);
  await advanceIndex(m, connection, f.client);
  f.lost = true;
  await expect(advanceIndex(m, connection, f.client)).rejects.toThrow(/lost/);
  const restored = JSON.parse(JSON.stringify(m));
  await publish(restored, f);
  expect(f.transfers).toBe(1);
  expect(restored.indexStatus.state).toBe('current');
});
it('does not mark a delayed upload verified and replaces obsolete projection intent', async () => {
  /** @type {any} */
  const m = { entries: { [a]: entry() } },
    f = files();
  prepareIndex(m, connection);
  await advanceIndex(m, connection, f.client);
  await advanceIndex(m, connection, f.client);
  f.delay = true;
  await advanceIndex(m, connection, f.client);
  await expect(advanceIndex(m, connection, f.client)).rejects.toThrow(/readback pending/);
  expect(m.indexStatus.state).not.toBe('current');
  m.entries[a].title = 'Changed';
  prepareIndex(m, connection);
  f.delay = false;
  await publish(m, f);
  expect(f.latest.content).toContain('Changed');
});
it('heals an engine-owned manually edited or invalid-UTF8 index, without swallowing transport errors', async () => {
  /** @type {any} */
  const m = { entries: { [a]: entry() } },
    f = files();
  prepareIndex(m, connection);
  await publish(m, f);
  f.put('manual change');
  prepareIndex(m, connection, true);
  await publish(m, f);
  expect(f.latest.content).toBe(renderIndex(connection, m).content);
  const read = f.client.latestFile;
  f.client.latestFile = async () => {
    if (f.latest.content === 'INVALID UTF8')
      new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array([0xc3, 0x28]));
    if (Buffer.byteLength(f.latest.content) > 64 * 1024)
      throw Error('Working-file content exceeds bound');
    return read();
  };
  for (const corrupt of ['INVALID UTF8', 'x'.repeat(64 * 1024 + 1)]) {
    f.put(corrupt);
    prepareIndex(m, connection, true);
    await publish(m, f);
    expect(f.latest.content).toBe(renderIndex(connection, m).content);
  }
  f.client.latestFile = async () => {
    throw TypeError('fetch failed');
  };
  prepareIndex(m, connection, true);
  await expect(advanceIndex(m, connection, f.client)).rejects.toThrow(/fetch failed/);
  expect(m.indexPending).toBeTruthy();
});

it('does not call a previously published index current after a new queued edit changes its view', async () => {
  const m = /** @type {any} */ ({ entries: { [a]: entry() }, queue: {} }),
    f = files();
  prepareIndex(m, connection);
  await publish(m, f);
  m.queue[a] = { document: { markdown: 'Never publish this body' } };
  const next = renderIndex(connection, m);
  expect(next.viewHash).not.toBe(m.indexStatus.viewHash);
  expect(next.content).toContain('## Pending');
  expect(next.content).not.toContain('Never publish this body');
});

it('leaves status reads available when an index projection needs metadata repair', () => {
  const m = { entries: { bad: { ...entry(), localId: '../bad' } } };
  expect(indexStatusView(connection, m).state).toBe('retry');
});

it('reconciles and replaces an expired transfer receipt without retaining an unusable URL', async () => {
  const m = /** @type {any} */ ({ entries: { [a]: entry() } }),
    f = files();
  prepareIndex(m, connection);
  await advanceIndex(m, connection, f.client);
  await advanceIndex(m, connection, f.client);
  const expired = m.indexPending.receipt.inputId,
    transfer = f.client.transferFile;
  f.client.transferFile = async (/** @type {any} */ upload, /** @type {string} */ content) => {
    if (upload.url.endsWith('/1')) throw Error('File transfer returned 403');
    return transfer(upload, content);
  };
  await expect(advanceIndex(m, connection, f.client)).rejects.toThrow(/403/);
  const restored = JSON.parse(JSON.stringify(m));
  await publish(restored, f);
  expect(restored.indexStatus.fileId).not.toBe(expired);
  expect(f.allocations).toBe(2);
  expect(f.latest.content).toBe(renderIndex(connection, m).content);
});
