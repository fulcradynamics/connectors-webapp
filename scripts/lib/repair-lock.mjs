import { open, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
/** Same-host exclusion only; this is not a remote Files lock or conditional write. */
export async function acquireRepairLock(path) {
  const owner = { pid: process.pid, nonce: randomUUID(), createdAt: new Date().toISOString() };
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
  } catch (e) {
    if (e.code === 'EEXIST')
      throw Error(
        'Repair locked; inspect the lock and owning process. Remove a stale lock explicitly only after confirming no repair process is active.'
      );
    throw e;
  }
  try {
    await handle.writeFile(JSON.stringify(owner));
  } finally {
    await handle.close();
  }
  return async () => {
    const actual = JSON.parse(await readFile(path, 'utf8'));
    if (actual.nonce !== owner.nonce)
      throw Error('Repair lock ownership changed; retain it for review');
    await unlink(path);
  };
}
