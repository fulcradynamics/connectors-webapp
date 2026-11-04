import { it, expect } from 'vitest';
import { memoryFiles } from './fixtures.js';
import { fileIntent, advanceFile } from './files.js';
async function drive(/** @type {any} */ p, /** @type {any} */ c) {
  for (let n = 0; n < 10; n++) {
    const r = await advanceFile(p, c);
    if (r !== 'pending') return r;
  }
  throw Error('not complete');
}
it('retains allocation and verifies exact current bytes before delivery completion', async () => {
  const f = memoryFiles(),
    p = fileIntent('/attio/a.json', '{"desired":true}', null);
  expect(await drive(p, f.client)).toBe('verified');
  expect(p.file.id).toBe((await f.client.latestFile(p.path)).id);
  expect(f.calls).toEqual(['allocate', 'transfer']);
});
it('detects an intervening archived B published after allocation but before our transfer', async () => {
  const f = memoryFiles(),
    a = f.put('/a', 'A'),
    p = fileIntent('/a', 'Own', a);
  await advanceFile(p, f.client);
  await advanceFile(p, f.client);
  const transfer = f.client.transferFile;
  let b = /** @type {any} */ (null);
  f.client.transferFile = async (receipt, content) => {
    b = f.put('/a', 'B');
    await transfer(receipt, content);
  };
  await advanceFile(p, f.client);
  expect(await advanceFile(p, f.client)).toBe('changed');
  expect(p.interveningFileIds).toContain(b.id);
  expect((await f.client.latestFile('/a')).content).toBe('Own');
});
it('does not overwrite a newer head before transfer or retry a deleted own receipt', async () => {
  const f = memoryFiles(),
    a = f.put('/a', 'A'),
    p = fileIntent('/a', 'Own', a);
  await advanceFile(p, f.client);
  await advanceFile(p, f.client);
  const b = f.put('/a', 'B');
  expect(await advanceFile(p, f.client)).toBe('changed');
  expect(f.calls).toEqual(['allocate']);
  expect(p.interveningFileIds).toContain(b.id);
  const q = fileIntent('/q', 'Q', null);
  await drive(q, f.client);
  const own = f.files.get('/q')?.[0];
  own.state = 'deleted';
  q.phase = 'transfer';
  const before = f.calls.length;
  expect(await advanceFile(q, f.client)).toBe('changed');
  expect(f.calls).toHaveLength(before);
});
it('surfaces an archived own receipt with no current head instead of polling forever', async () => {
  const f = memoryFiles(),
    p = fileIntent('/absent', 'Accepted', null);
  await advanceFile(p, f.client);
  await advanceFile(p, f.client);
  await advanceFile(p, f.client);
  const own = f.files.get('/absent')?.[0];
  own.state = 'archived';
  expect(await advanceFile(p, f.client)).toBe('changed');
});
it('persists validated MIME and uses the same type for allocation and transfer', async () => {
  const f = memoryFiles(),
    seen = /** @type {any[]} */ ([]);
  const client = /** @type {any} */ (f.client),
    allocate = client.allocateFile,
    transfer = client.transferFile;
  client.allocateFile = async (
    /** @type {string} */ path,
    /** @type {string} */ content,
    /** @type {string} */ type
  ) => {
    seen.push(type);
    return allocate(path, content, type);
  };
  client.transferFile = async (
    /** @type {any} */ receipt,
    /** @type {string} */ content,
    /** @type {string} */ type
  ) => {
    seen.push(type);
    return transfer(receipt, content, type);
  };
  const p = fileIntent('/attio/index.md', '# Index', null, 65536, 'text/markdown');
  expect(p.contentType).toBe('text/markdown');
  expect(await drive(p, client)).toBe('verified');
  expect(seen).toEqual(['text/markdown', 'text/markdown']);
  expect(() => fileIntent('/attio/index.md', '# Index', null, 65536, 'text/html')).toThrow(
    /content type|intent/i
  );
});
it('retains JSON MIME for a legacy allocated receipt rather than changing its signed upload', async () => {
  const f = memoryFiles(),
    client = /** @type {any} */ (f.client),
    p = fileIntent('/attio/index.md', '# Legacy', null);
  await advanceFile(p, client);
  await advanceFile(p, client);
  delete p.contentType;
  let transferred = '';
  const transfer = client.transferFile;
  client.transferFile = async (
    /** @type {any} */ receipt,
    /** @type {string} */ content,
    /** @type {string} */ type
  ) => {
    transferred = type;
    return transfer(receipt, content, type);
  };
  expect(await drive(p, client)).toBe('verified');
  expect(transferred).toBe('application/json');
});
it('does not accept a changed MIME after a receipt was allocated', async () => {
  const f = memoryFiles(),
    p = fileIntent('/attio/a.json', '{}', null);
  await advanceFile(p, f.client);
  await advanceFile(p, f.client);
  p.contentType = 'text/markdown';
  await expect(advanceFile(p, f.client)).rejects.toThrow(/content type/i);
  expect(f.calls).toEqual(['allocate']);
});
it('does not verify bytes alone when published MIME is wrong', async () => {
  const f = memoryFiles(),
    p = fileIntent('/attio/a.json', '{}', null);
  await advanceFile(p, f.client);
  await advanceFile(p, f.client);
  await advanceFile(p, f.client);
  const head = f.files.get('/attio/a.json')?.[0];
  if (!head) throw Error('missing test file');
  head.content_type = 'text/markdown';
  await expect(advanceFile(p, f.client)).rejects.toThrow(/content type readback/i);
});
