import { it, expect, vi } from 'vitest';
import { FulcraClient } from './fulcra.js';

const parent = '/notion/live';
const name = 'working.md';
const path = parent + '/' + name;
/** @param {string} id @param {string} state @param {string} uploaded @param {string} created */
const version = (id, state, uploaded, created = uploaded) => ({
  id,
  path: parent,
  name,
  state,
  uploaded_at: uploaded,
  created_at: created,
  size: 4
});
/** @param {any} listing @param {boolean} obeyState */
function fixture(listing, obeyState = true) {
  const fetchImpl = vi.fn(async (/** @type {any} */ input) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/download')) return new Response('head');
    // The real API omits archived/deleted history unless explicitly requested.
    if (obeyState && Array.isArray(listing?.files)) {
      const states = (url.searchParams.get('state') ?? 'created,uploaded').split(',');
      return Response.json({
        ...listing,
        files: listing.files.filter(
          (/** @type {any} */ file) => !file || states.includes(file.state)
        )
      });
    }
    return Response.json(listing);
  });
  const client = new FulcraClient({
    endpoint: 'https://fulcra.test/',
    accessToken: 'synthetic',
    fetchImpl
  });
  return { client, fetchImpl };
}

it('requests published history and selects current state independently of creation or display order', async () => {
  const a = version('A', 'archived', '2026-11-01T00:01:00Z');
  const b = version('B', 'archived', '2026-11-01T00:02:00Z', '2026-11-01T00:05:00Z');
  const c = version('C', 'uploaded', '2026-11-01T00:03:00Z', '2026-11-01T00:00:00Z');
  const deleted = version('D', 'deleted', '2026-11-01T00:04:00Z');
  const created = version('unpublished', 'created', '2026-11-01T00:06:00Z');
  const foreignPath = { ...a, id: 'other-path', path: '/elsewhere' };
  const foreignName = { ...a, id: 'other-name', name: 'other.md' };
  const f = fixture({ files: [a, b, c, deleted, created, foreignPath, foreignName] });
  const result = await f.client.fileState(path);
  const query = new URL(f.fetchImpl.mock.calls[0][0]);
  expect(query.searchParams.get('state')).toBe('uploaded,archived,deleted');
  expect(query.searchParams.get('path')).toBe(parent);
  expect(query.searchParams.get('name')).toBe(name);
  expect(result.versions.map((/** @type {any} */ file) => file.id)).toEqual(['D', 'C', 'B', 'A']);
  expect(result.file).toMatchObject({ id: 'C', content: 'head', createdAt: c.created_at });
  expect(result.file?.versions).toEqual(result.versions);
  expect(new URL(f.fetchImpl.mock.calls[1][0]).pathname).toBe('/input/v1/file_upload/C/download');
});

it('keeps latestFile compatible while retaining archived and deleted metadata', async () => {
  const f = fixture({
    files: [
      version('previous', 'archived', '2026-11-01T00:00:00Z'),
      version('current', 'uploaded', '2026-11-01T00:01:00Z')
    ]
  });
  const file = await f.client.latestFile(path);
  expect(file?.id).toBe('current');
  expect(file?.versions.map((/** @type {any} */ row) => row.id)).toEqual(['current', 'previous']);
});

it('retains deleted own receipts without resurrecting an archived version as current', async () => {
  const archived = version('previous', 'archived', '2026-11-01T00:00:00Z');
  const deleted = version('own-receipt', 'deleted', '2026-11-01T00:01:00Z');
  const f = fixture({ files: [archived, deleted] });
  expect(await f.client.fileState(path)).toEqual({ file: null, versions: [deleted, archived] });
  expect(await f.client.latestFile(path)).toBeNull();
  expect(
    f.fetchImpl.mock.calls.every(([url]) => !new URL(url).pathname.endsWith('/download'))
  ).toBe(true);
});

it('fails closed on ambiguous uploaded heads before downloading either body', async () => {
  const f = fixture({
    files: [
      version('first', 'uploaded', '2026-11-01T00:00:00Z'),
      version('second', 'uploaded', '2026-11-01T00:01:00Z')
    ]
  });
  await expect(f.client.fileState(path)).rejects.toThrow(/ambiguous|multiple/i);
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
});

it('rejects an unknown exact-file state instead of interpreting it as a missing file', async () => {
  const f = fixture({ files: [version('unknown', 'unexpected', '2026-11-01T00:00:00Z')] }, false);
  await expect(f.client.fileState(path)).rejects.toThrow(/invalid/i);
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
});

it('ignores never-published created inputs even if the provider includes one', async () => {
  const f = fixture({ files: [version('unpublished', 'created', '2026-11-01T00:00:00Z')] }, false);
  expect(await f.client.fileState(path)).toEqual({ file: null, versions: [] });
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
});

it.each([{ files: null }, { files: [] }])(
  'accepts an explicit empty files collection: %s',
  async ({ files }) => {
    const f = fixture({ files });
    expect(await f.client.fileState(path)).toEqual({ file: null, versions: [] });
  }
);

it.each([null, {}, { files: {} }, { files: 'invalid' }, { files: [null] }])(
  'rejects missing or invalid history shapes rather than treating them as empty: %s',
  async (listing) => {
    const f = fixture(listing);
    await expect(f.client.fileState(path)).rejects.toThrow();
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  }
);

it('rejects an oversized history before filtering or downloading', async () => {
  const f = fixture({
    files: Array.from({ length: 501 }, (_, i) =>
      version(String(i), 'archived', '2026-11-01T00:00:00Z')
    )
  });
  await expect(f.client.fileState(path)).rejects.toThrow(/capacity/i);
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
});

it('keeps folder discovery limited to current uploaded files', async () => {
  const f = fixture({
    files: [
      version('current', 'uploaded', '2026-11-01T00:00:00Z'),
      version('previous', 'archived', '2026-10-31T00:00:00Z'),
      version('draft', 'created', '2026-11-01T00:01:00Z'),
      { ...version('other', 'uploaded', '2026-11-01T00:00:00Z'), path: '/elsewhere' }
    ]
  });
  expect((await f.client.listFiles(parent)).map((/** @type {any} */ file) => file.id)).toEqual([
    'current'
  ]);
});

it.each([
  ['uploaded', undefined],
  ['uploaded', null],
  ['uploaded', 'invalid'],
  ['archived', undefined],
  ['archived', null],
  ['archived', 'invalid'],
  ['deleted', undefined],
  ['deleted', ''],
  ['deleted', false],
  ['deleted', 0],
  ['deleted', 'invalid']
])(
  'rejects ambiguous publication metadata for %s with uploaded_at=%s',
  async (state, timestamp) => {
    const row = /** @type {any} */ (version('invalid-time', state, '2026-11-01T00:00:00Z'));
    row.uploaded_at = timestamp;
    const f = fixture({ files: [row] });
    await expect(f.client.fileState(path)).rejects.toThrow(/invalid/i);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  }
);

it('retains explicit never-published deletion metadata and ignores foreign-scope timestamps', async () => {
  const cancelled = {
    ...version('cancelled', 'deleted', '2026-11-01T00:00:00Z'),
    uploaded_at: null
  };
  const foreign = { ...version('foreign', 'archived', 'invalid'), path: '/elsewhere' };
  const f = fixture({ files: [cancelled, foreign] });
  expect(await f.client.fileState(path)).toEqual({ file: null, versions: [cancelled] });
});

/** @param {Uint8Array[]} chunks @param {HeadersInit} headers */
function downloadFixture(chunks, headers = {}) {
  const cancelled = vi.fn();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel: cancelled
  });
  const response = new Response(stream, { headers });
  const wholeBuffer = vi.spyOn(response, 'arrayBuffer');
  const client = new FulcraClient({
    endpoint: 'https://fulcra.test/',
    accessToken: 'synthetic',
    fetchImpl: async () => response
  });
  return { client, response, cancelled, wholeBuffer };
}

it('reads bounded chunks without collecting an unbounded whole response buffer', async () => {
  const f = downloadFixture([new Uint8Array([1, 2]), new Uint8Array([3, 4])], {
    'Content-Length': '4'
  });
  expect(await f.client.readFileBytes('version', 4)).toEqual(new Uint8Array([1, 2, 3, 4]));
  expect(f.wholeBuffer).not.toHaveBeenCalled();
  expect(f.cancelled).not.toHaveBeenCalled();
});

it('rejects a declared oversized body before reading its stream', async () => {
  const f = downloadFixture([new Uint8Array(4)], { 'Content-Length': '1000' });
  const reader = vi.spyOn(/** @type {ReadableStream} */ (f.response.body), 'getReader');
  await expect(f.client.readFileBytes('version', 4)).rejects.toThrow(/exceeds bound/i);
  expect(reader).not.toHaveBeenCalled();
  expect(f.cancelled).toHaveBeenCalledTimes(1);
  expect(f.wholeBuffer).not.toHaveBeenCalled();
});

it('cancels a chunked response that exceeds the bound without a Content-Length header', async () => {
  const f = downloadFixture([new Uint8Array(3), new Uint8Array(3), new Uint8Array(3)]);
  await expect(f.client.readFileBytes('version', 5)).rejects.toThrow(/exceeds bound/i);
  expect(f.cancelled).toHaveBeenCalledTimes(1);
  expect(f.wholeBuffer).not.toHaveBeenCalled();
});

it('bounds generic downloads to two MiB by default', async () => {
  const f = downloadFixture([
    new Uint8Array(2 * 1024 * 1024),
    new Uint8Array(1),
    new Uint8Array(1)
  ]);
  const outcome = await f.client.readFileBytes('version').then(
    () => 'Unbounded download succeeded',
    (error) => String(error)
  );
  expect(outcome).toMatch(/exceeds bound/i);
  expect(f.cancelled).toHaveBeenCalledTimes(1);
});

it('applies the tighter working-file limit while streaming rather than after full download', async () => {
  const f = downloadFixture([new Uint8Array(64 * 1024), new Uint8Array(1), new Uint8Array(1)]);
  f.client.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    return url.pathname.endsWith('/download')
      ? f.response
      : Response.json({ files: [version('current', 'uploaded', '2026-11-01T00:00:00Z')] });
  };
  await expect(f.client.fileState(path)).rejects.toThrow(/exceeds bound/i);
  expect(f.cancelled).toHaveBeenCalledTimes(1);
  expect(f.wholeBuffer).not.toHaveBeenCalled();
});
