import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireRepairLock } from './repair-lock.mjs';
test('exclusive local lock retains stale ownership for explicit recovery and releases only its own lock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'repair-lock-'));
  const path = join(dir, 'operation.lock');
  try {
    const release = await acquireRepairLock(path);
    const owner = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(owner.pid, process.pid);
    await assert.rejects(acquireRepairLock(path), /locked.*inspect.*stale/i);
    await release();
    const releaseAgain = await acquireRepairLock(path);
    await writeFile(path, JSON.stringify({ ...owner, nonce: 'different-owner' }));
    await assert.rejects(releaseAgain(), /ownership changed/);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).nonce, 'different-owner');
    // A stale lock is never silently taken over, even when its PID is no longer alive.
    await writeFile(path, JSON.stringify({ pid: 999999999, nonce: 'stale' }));
    await assert.rejects(acquireRepairLock(path), /locked.*inspect.*stale/i);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).nonce, 'stale');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
