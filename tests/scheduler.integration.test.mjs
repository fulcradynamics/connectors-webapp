import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createStore } from '../src/lib/server/store.js';
let pool, store;
before(async () => {
  const url =
    process.env.TEST_DATABASE_URL ||
    JSON.parse(await readFile('.private/postgres-test.json', 'utf8')).url;
  pool = new Pool({ connectionString: url });
  await pool.query(await readFile('migrations/001-operational.sql', 'utf8'));
  store = createStore({
    pool,
    deploymentId: randomUUID(),
    ownerId: randomUUID(),
    crypto: { key: Buffer.alloc(32, 11).toString('base64'), keyId: 'stage-test' }
  });
  await store.initialize();
});
after(async () => pool?.end());
async function setup() {
  const c = await store.createConnection({
    connector: 'test',
    label: 'Test',
    accountId: 'test',
    config: { intervalSeconds: 60 }
  });
  await store.changeGeneration(c.id, 'ready');
  // Explicitly due despite small host/container clock skew.
  await store.enqueue(c.id, undefined, new Date(Date.now() - 1000));
  return c;
}
test('simultaneous ticks claim a connection only once', async () => {
  const c = await setup();
  const claims = (await Promise.all([store.claimDueJobs(1), store.claimDueJobs(1)])).flat();
  assert.equal(claims.filter((j) => j.connection_id === c.id).length, 1);
  await store.changeGeneration(c.id, 'paused');
});
test('expired worker cannot checkpoint after a newer lease; pause fences writes and checkpoints', async () => {
  const c = await setup();
  const [old] = await store.claimDueJobs(1);
  await pool.query(
    "UPDATE connector_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
    [old.id]
  );
  const [current] = await store.claimDueJobs(1);
  assert.notEqual(old.lease_token, current.lease_token);
  await assert.rejects(() => store.commitCheckpoint(old, { cursor: 'lost' }), /lease/);
  await store.savePending(current, { candidateCheckpoint: { cursor: 'new' } });
  await store.changeGeneration(c.id, 'paused');
  await assert.rejects(
    () => store.withLease(current, async () => assert.fail('stale writer ran')),
    /lease/
  );
  await assert.rejects(() => store.commitCheckpoint(current, { cursor: 'new' }), /lease/);
  assert.equal((await store.getCheckpoint(c.id)).value, null);
});
test('receipts and pending page survive retry without committing a candidate cursor', async () => {
  const c = await setup();
  const [job] = await store.claimDueJobs(1);
  const revision = randomUUID();
  await store.savePending(job, {
    changes: [{ id: 'source' }],
    candidateCheckpoint: { cursor: 'candidate' }
  });
  await store.saveDelivery(job, revision, {
    sink: 'file',
    path: '/test.md',
    status: 'verified',
    inputId: 'uploaded'
  });
  await store.reschedule(job, new Date(Date.now() - 1000), null);
  const [retry] = await store.claimDueJobs(1);
  assert.equal((await store.getCheckpoint(c.id)).value, null);
  assert.equal((await store.getCheckpoint(c.id)).pending.changes[0].id, 'source');
  assert.equal((await store.getDeliveries(c.id, revision))[0].inputId, 'uploaded');
  await store.commitCheckpoint(retry, { cursor: 'candidate' });
  assert.deepEqual((await store.getCheckpoint(c.id)).value, { cursor: 'candidate' });
});
test('signed webhook delivery IDs deduplicate and acknowledge only with checkpoint commit', async () => {
  const c = await setup();
  assert.equal(
    await store.recordWebhook(c.id, 'delivery', { event: { channel: 'selected' } }),
    true
  );
  assert.equal(
    await store.recordWebhook(c.id, 'delivery', { event: { channel: 'selected' } }),
    false
  );
  assert.equal((await store.listWebhookHints(c.id)).length, 1);
  const [job] = await store.claimDueJobs(1);
  await store.commitCheckpoint(job, { cursor: 'verified' }, null, ['delivery']);
  assert.equal((await store.listWebhookHints(c.id)).length, 0);
});
test('an unconfirmed or stale preview cannot enable collection; pause and disconnect fence old jobs', async () => {
  const { enableConnection, configHash } = await import('../src/lib/server/connections.js');
  const { seal } = await import('../src/lib/server/secrets.js');
  const crypto = { key: Buffer.alloc(32, 10).toString('base64'), keyId: 'test' };
  const c = await store.createConnection({
    connector: 'test',
    label: 'Preview',
    accountId: 'account',
    config: { resources: ['selected'], routeVersion: 1 }
  });
  await store.saveGrant('fulcra', { encrypted: { opaque: true }, status: 'ready' });
  await store.saveGrant('provider:' + c.id, { encrypted: { opaque: true }, status: 'ready' });
  const key = 'preview:' + c.id;
  await store.saveGrant(key, {
    encrypted: seal(
      { hash: configHash(c.config), generation: c.generation },
      `${store.deploymentId}:${store.ownerId}:${key}`,
      crypto
    ),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    status: 'ready'
  });
  await assert.rejects(() => enableConnection(store, c.id, false, crypto), /preview/);
  const enabled = await enableConnection(store, c.id, true, crypto);
  assert.equal(enabled.status, 'ready');
  // Make the fixture due on the database clock before testing lease fencing.
  await pool.query('UPDATE connector_jobs SET due_at=now() WHERE connection_id=$1', [c.id]);
  const [job] = await store.claimDueJobs(1);
  await store.changeGeneration(c.id, 'paused');
  await assert.rejects(() => store.assertLease(job), /lease/);
  await assert.rejects(() => enableConnection(store, c.id, true, crypto), /preview again/);
  await store.changeGeneration(c.id, 'disconnected');
  assert.equal((await store.getConnection(c.id)).status, 'disconnected');
});
test('body-bearing staging is encrypted and expiry clears it for explicit reconciliation', async () => {
  const c = await setup();
  const [job] = await store.claimDueJobs(1);
  await store.savePending(job, {
    outputs: [{ private: 'unique-private-source-body' }],
    candidateCheckpoint: { cursor: 'candidate' }
  });
  let row = (await pool.query('SELECT * FROM connector_checkpoints WHERE connection_id=$1', [c.id]))
    .rows[0];
  assert.ok(!JSON.stringify(row).includes('unique-private-source-body'));
  assert.equal(
    (await store.getCheckpoint(c.id)).pending.outputs[0].private,
    'unique-private-source-body'
  );
  await pool.query(
    "UPDATE connector_checkpoints SET pending_expires_at=now()-interval '1 second' WHERE connection_id=$1",
    [c.id]
  );
  const expired = await store.getCheckpoint(c.id);
  assert.equal(expired.expired, true);
  assert.equal(expired.pending, null);
  await store.commitCheckpoint(job, { frontier: [{ body: 'unique-checkpoint-body' }] });
  const rawValue = (
    await pool.query('SELECT value FROM connector_checkpoints WHERE connection_id=$1', [c.id])
  ).rows[0];
  assert.ok(!JSON.stringify(rawValue).includes('unique-checkpoint-body'));
  assert.equal((await store.getCheckpoint(c.id)).value.frontier[0].body, 'unique-checkpoint-body');
  await store.changeGeneration(c.id, 'paused');
});
test('due-time fairness serves a later connection before continuing two earlier backfills', async () => {
  const a = await setup(),
    b = await setup(),
    c = await setup();
  const initial = await store.claimDueJobs(2);
  assert.equal(initial.length, 2);
  for (const job of initial) await store.reschedule(job, new Date(Date.now() - 1000));
  // The third job has been due longer; fixed creation ordering incorrectly reclaims A/B.
  await pool.query(
    "UPDATE connector_jobs SET due_at=now()-interval '10 seconds' WHERE connection_id=$1 AND status='queued'",
    [c.id]
  );
  const [next] = await store.claimDueJobs(1);
  assert.equal(next.connection_id, c.id);
  for (const connection of [a, b, c]) await store.changeGeneration(connection.id, 'paused');
});

test('allocated upload URLs are encrypted in durable delivery intents', async () => {
  const c = await setup();
  const [job] = await store.claimDueJobs(1),
    revision = randomUUID();
  await store.saveDelivery(job, revision, {
    sink: 'file',
    path: '/intent.json',
    status: 'uncertain',
    inputId: 'allocated',
    transfer: { url: 'https://storage.example/private-signed-upload' }
  });
  const row = (
    await pool.query('SELECT receipt FROM connector_deliveries WHERE connection_id=$1', [c.id])
  ).rows[0];
  assert.ok(!JSON.stringify(row).includes('private-signed-upload'));
  assert.equal(
    (await store.getDeliveries(c.id, revision))[0].transfer.url,
    'https://storage.example/private-signed-upload'
  );
  await store.changeGeneration(c.id, 'paused');
});
test('scheduling-only configuration changes retain encrypted pending recovery and routing identity', async () => {
  const { configurationUpdate } = await import('../src/lib/server/connections.js');
  const config = {
    resources: ['selected'],
    routeVersion: 4,
    intervalSeconds: 300,
    backfillSince: '2026-10-01T00:00:00.000Z',
    route: { mode: 'file', folder: '/test', ownerId: store.ownerId }
  };
  const c = await store.createConnection({
    connector: 'test',
    label: 'Resume',
    accountId: 'account',
    config
  });
  const ready = await store.changeGeneration(c.id, 'ready');
  // Explicitly due despite small host/container clock skew.
  await store.enqueue(c.id, undefined, new Date(Date.now() - 1000));
  const [job] = await store.claimDueJobs(1);
  await store.savePending(job, { candidateCheckpoint: { cursor: 'keep' }, outputs: [] });
  const update = configurationUpdate(
    config,
    { ...config, intervalSeconds: 600 },
    ['selected'],
    store.ownerId
  );
  await store.changeGeneration(
    c.id,
    'draft',
    update.config,
    ready.generation,
    update.resetCheckpoint
  );
  assert.equal((await store.getCheckpoint(c.id)).pending.candidateCheckpoint.cursor, 'keep');
  assert.equal((await store.getConnection(c.id)).config.routeVersion, 4);
});
