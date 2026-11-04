import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
const mod = await import('../src/lib/server/store.js').catch(() => ({}));
const createStore = mod.createStore ?? (() => assert.fail('operational store missing'));
const credentialMod = await import('../src/lib/server/credentials.js').catch(() => ({}));
const getFulcraCredential =
  credentialMod.getFulcraCredential ?? (() => assert.fail('background refresh missing'));
import { seal, unseal } from '../src/lib/server/secrets.js';
let pool, store, foreign;
before(async () => {
  const url =
    process.env.TEST_DATABASE_URL ||
    JSON.parse(await readFile('.private/postgres-test.json', 'utf8')).url;
  pool = new Pool({ connectionString: url });
  const migration = await readFile('migrations/001-operational.sql', 'utf8').catch(() => null);
  assert.ok(migration, 'operational migration missing');
  await pool.query(migration);
  const deploymentId = randomUUID(),
    ownerId = randomUUID();
  store = createStore({
    pool,
    deploymentId,
    ownerId,
    crypto: { key: Buffer.alloc(32, 11).toString('base64'), keyId: 'stage-test' }
  });
  await store.initialize();
  foreign = createStore({ pool, deploymentId, ownerId: randomUUID() });
});
test('simultaneous expired grants rotate only once and all callers receive the fresh access token', async () => {
  const crypto = { key: Buffer.alloc(32, 9).toString('base64'), keyId: 'integration' };
  const context = `${store.deploymentId}:${store.ownerId}:fulcra`;
  await store.saveGrant('fulcra', {
    encrypted: seal({ access_token: 'old', refresh_token: 'refresh-once' }, context, crypto),
    expiresAt: '2000-01-01T00:00:00Z',
    status: 'ready'
  });
  let exchanges = 0;
  const fetchImpl = async () => {
    exchanges++;
    await new Promise((r) => setTimeout(r, 10));
    return Response.json({ access_token: 'fresh', refresh_token: 'rotated', expires_in: 3600 });
  };
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      getFulcraCredential(store, {
        crypto,
        clientId: 'test',
        auth0Domain: 'fulcra.us.auth0.com',
        fetchImpl
      })
    )
  );
  assert.deepEqual(results, ['fresh', 'fresh', 'fresh']);
  assert.equal(exchanges, 1);
  const grant = await store.getGrant('fulcra');
  assert.equal(unseal(grant.encrypted, context, crypto).refresh_token, 'rotated');
});
test('a rejected refresh grant durably requests reauthorization rather than losing that state on rollback', async () => {
  const crypto = { key: Buffer.alloc(32, 9).toString('base64'), keyId: 'integration' };
  await store.saveGrant('fulcra', {
    encrypted: seal(
      { access_token: 'old', refresh_token: 'revoked' },
      `${store.deploymentId}:${store.ownerId}:fulcra`,
      crypto
    ),
    expiresAt: '2000-01-01T00:00:00Z',
    status: 'ready'
  });
  await assert.rejects(
    () =>
      getFulcraCredential(store, {
        crypto,
        clientId: 'test',
        auth0Domain: 'fulcra.us.auth0.com',
        fetchImpl: async () => Response.json({ error: 'invalid_grant' }, { status: 400 })
      }),
    /reauthorize/
  );
  assert.equal((await store.getGrant('fulcra')).status, 'reauthorize');
});
after(async () => {
  await pool?.end();
});
test('another owner cannot use the deployment operational namespace', async () => {
  const connection = await store.createConnection({
    connector: 'granola',
    label: 'Test',
    accountId: 'test',
    config: {}
  });
  assert.equal((await store.listConnections())[0].id, connection.id);
  await assert.rejects(() => foreign.listConnections(), /owner/);
});
test('credential refresh locks serialize concurrent access and keep encrypted fields private', async () => {
  await store.saveGrant('fulcra', {
    encrypted: { ciphertext: 'opaque' },
    expiresAt: new Date().toISOString(),
    status: 'ready'
  });
  let active = 0,
    maximum = 0;
  await Promise.all(
    [1, 2, 3].map(() =>
      store.withGrantLock('fulcra', async (row) => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((r) => setTimeout(r, 15));
        active--;
        return { patch: { encrypted: { ciphertext: 'rotated' } }, value: row.status };
      })
    )
  );
  assert.equal(maximum, 1);
  assert.equal((await store.getGrant('fulcra')).encrypted.ciphertext, 'rotated');
  const list = await store.listConnections();
  assert.ok(list.every((x) => !('encrypted' in x) && !('credential_envelope' in x)));
});

test('disconnect serializes with refresh and a failed remote revoke disables further use', async () => {
  const { disconnectFulcraCredential } = await import('../src/lib/server/credentials.js');
  const crypto = { key: Buffer.alloc(32, 9).toString('base64'), keyId: 'integration' };
  const context = `${store.deploymentId}:${store.ownerId}:fulcra`;
  await store.saveGrant('fulcra', {
    encrypted: seal({ access_token: 'old', refresh_token: 'refresh' }, context, crypto),
    expiresAt: '2000-01-01T00:00:00Z',
    status: 'ready'
  });
  let revocationToken;
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/oauth/token')) {
      await new Promise((r) => setTimeout(r, 20));
      return Response.json({ access_token: 'fresh', refresh_token: 'rotated', expires_in: 3600 });
    }
    revocationToken = JSON.parse(init.body).token;
    return new Response('', { status: 503 });
  };
  const options = { crypto, clientId: 'test', auth0Domain: 'fulcra.us.auth0.com', fetchImpl };
  const refresh = getFulcraCredential(store, options);
  await new Promise((r) => setTimeout(r, 5));
  const revoke = disconnectFulcraCredential(store, options);
  await refresh;
  assert.equal(await revoke, 'revocation_pending');
  assert.equal(revocationToken, 'rotated');
  assert.equal((await store.getGrant('fulcra')).status, 'revocation_pending');
  await assert.rejects(() => getFulcraCredential(store, options), /reauthorize/);
});
test('GitHub installation grants renew once under the credential lock', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs8',
    format: 'pem'
  });
  const id = randomUUID(),
    key = 'provider:' + id,
    context = `${store.deploymentId}:${store.ownerId}:${key}`,
    crypto = { key: Buffer.alloc(32, 9).toString('base64'), keyId: 'integration' };
  await store.saveGrant(key, {
    encrypted: seal(
      {
        kind: 'github_app',
        appId: '123',
        installationId: '456',
        privateKey,
        token: 'expired',
        expiresAt: '2000-01-01T00:00:00Z'
      },
      context,
      crypto
    ),
    status: 'ready'
  });
  let exchanges = 0;
  const fetchImpl = async (url, init) => {
    assert.equal(String(url), 'https://api.github.com/app/installations/456/access_tokens');
    assert.ok(init.headers.Authorization.startsWith('Bearer ey'));
    exchanges++;
    return Response.json({
      token: 'installation-token',
      expires_at: new Date(Date.now() + 3600000).toISOString()
    });
  };
  const { getProviderCredential } = await import('../src/lib/server/credentials.js');
  const values = await Promise.all(
    [1, 2, 3].map(() => getProviderCredential(store, id, crypto, { fetchImpl }))
  );
  assert.equal(exchanges, 1);
  assert.ok(values.every((x) => x.token === 'installation-token'));
});
test('disconnecting background authorization fences every already-running connection', async () => {
  const { disconnectFulcraCredential } = await import('../src/lib/server/credentials.js');
  const connection = await store.createConnection({
    connector: 'test',
    label: 'Background fence',
    accountId: 'test',
    config: {}
  });
  await store.changeGeneration(connection.id, 'ready');
  // Explicitly due despite small host/container clock skew.
  await store.enqueue(connection.id, undefined, new Date(Date.now() - 1000));
  const [job] = await store.claimDueJobs(1);
  const crypto = { key: Buffer.alloc(32, 9).toString('base64'), keyId: 'integration' };
  await store.saveGrant('fulcra', {
    encrypted: seal(
      { access_token: 'current', refresh_token: 'refresh' },
      `${store.deploymentId}:${store.ownerId}:fulcra`,
      crypto
    ),
    status: 'ready'
  });
  await disconnectFulcraCredential(store, {
    crypto,
    clientId: 'test',
    auth0Domain: 'example.auth0.com',
    fetchImpl: async () => new Response('', { status: 200 })
  });
  assert.equal((await store.getConnection(connection.id)).status, 'paused');
  await assert.rejects(() => store.assertLease(job), /lease/);
});

// Garmin uses the same transaction lock on the alternate PostgreSQL backend.
test('Garmin personal tokens renew once and keep the long-lived key encrypted', async () => {
  const { getProviderCredential } = await import('../src/lib/server/credentials.js');
  const crypto = { key: Buffer.alloc(32, 9).toString('base64'), keyId: 'integration' };
  const key = 'provider:garmin-fixture',
    context = `${store.deploymentId}:${store.ownerId}:${key}`;
  await store.saveGrant(key, {
    status: 'ready',
    encrypted: seal(
      {
        kind: 'garmin_personal',
        apiKey: 'synthetic-personal-key',
        token: 'expired',
        expiresAt: '2000-01-01T00:00:00Z',
        accountId: '42',
        timeZone: 'UTC'
      },
      context,
      crypto
    )
  });
  let exchanges = 0;
  const fetchImpl = async () => {
    exchanges++;
    await new Promise((r) => setTimeout(r, 10));
    return Response.json({ access_token: 'synthetic-renewed', expires_in: 3600 });
  };
  const results = await Promise.all(
    [1, 2, 3].map(() => getProviderCredential(store, 'garmin-fixture', crypto, { fetchImpl }))
  );
  assert.equal(exchanges, 1);
  assert.ok(results.every((x) => x.token === 'synthetic-renewed' && x.accountId === '42'));
  const row = await store.getGrant(key);
  assert.ok(!JSON.stringify(row).includes('synthetic-personal-key'));
  assert.equal(unseal(row.encrypted, context, crypto).apiKey, 'synthetic-personal-key');
});
