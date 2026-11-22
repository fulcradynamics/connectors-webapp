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
