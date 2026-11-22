import { it, expect } from 'vitest';
import { freshState, nativeStore, unstage } from './state.js';
import { advanceWorker } from './worker.js';
import { createGarmin } from '../connectors/garmin.js';
import { getProviderCredential } from '../credentials.js';
import { seal, unseal } from '../secrets.js';
it('delivers Garmin through native phases and commits only after JSON file and v1 record read back', async () => {
  const crypto = { key: Buffer.alloc(32, 7).toString('base64'), keyId: 'fixture' };
  const state = freshState('deployment', 'owner');
  state.grants.fulcra = {
    status: 'ready',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    encrypted: {}
  };
  const store = nativeStore(state);
  const connection = await store.createConnection({
    connector: 'garmin',
    label: 'Garmin fixture',
    accountId: '42',
    config: {
      resources: ['daily'],
      backfillSince: '2026-10-23T00:00:00Z',
      intervalSeconds: 300,
      routeVersion: 1,
      route: {
        mode: 'both',
        ownerId: 'owner',
        folder: '/connectors/garmin',
        recordType: 'Event/fixture'
      }
    }
  });
  connection.status = 'ready';
  connection.nextDue = 0;
  const context = `deployment:owner:provider:${connection.id}`;
  await store.saveGrant('provider:' + connection.id, {
    status: 'ready',
    encrypted: seal(
      {
        kind: 'garmin_personal',
        apiKey: 'synthetic-personal-key',
        accountId: '42',
        timeZone: 'UTC'
      },
      context,
      crypto
    )
  });
  let exchanges = 0,
    recordWrites = 0,
    transfers = 0,
    visible = false;
  /** @type {any} */ let record = null;
  let file = '';
  const client = {
    catalog: async () => [
      {
        id: 'Event/fixture',
        fulcra_userid: 'owner',
        queryable: true,
        recordable: true,
        api_version: 'v1'
      }
    ],
    schema: async () => ({ type: 'object', properties: { payload: { type: 'object' } } }),
    findFileByHash: async () => null,
    allocateFile: async () => ({
      file: { id: 'fixture-file' },
      url: 'https://upload.invalid/fixture'
    }),
    transferFile: async (/** @type {any} */ _transfer, /** @type {string} */ content) => {
      file = content;
      transfers++;
    },
    readFileBytes: async () => new TextEncoder().encode(file),
    readRecord: async () => (visible ? record : null),
    writeRecords: async (/** @type {string} */ _type, /** @type {any[]} */ records) => {
      record = records[0];
      recordWrites++;
      return { upload_id: 'fixture-upload' };
    }
  };
  const adapter = createGarmin({
    now: () => Date.parse('2026-10-23T12:00:00Z'),
    fetchImpl: async () =>
      Response.json({ userProfileId: 42, calendarDate: '2026-10-23', totalSteps: 100 })
  });
  const deps = {
    crypto,
    client,
    adapters: { garmin: adapter },
    provider: () =>
      getProviderCredential(store, connection.id, crypto, {
        fetchImpl: async () => {
          exchanges++;
          return Response.json({ access_token: 'synthetic-bearer', expires_in: 3600 });
        }
      })
  };
  for (let n = 0; n < 20; n++) {
    await advanceWorker(state, deps);
    if (connection.lastError === 'verification_pending') break;
  }
  expect(connection.lastError).toBe('verification_pending');
  expect(state.checkpoints[connection.id].value).toBeUndefined();
  expect(recordWrites).toBe(1);
  expect(transfers).toBe(1);
  visible = true;
  connection.nextDue = 0;
  for (let n = 0; n < 20 && !state.checkpoints[connection.id].value; n++)
    await advanceWorker(state, deps);
  expect(
    unstage(state, 'value:' + connection.id, state.checkpoints[connection.id].value, crypto).cycle
  ).toBeNull();
  expect(record.connector).toBe('garmin');
  expect(record.payload.dataset).toBe('daily');
  expect(JSON.parse(file)).toEqual(record.payload);
  expect(
    state.deliveries[connection.id].every((/** @type {any} */ x) => x.status === 'verified')
  ).toBe(true);
  expect(recordWrites).toBe(1);
  expect(exchanges).toBe(1);
  expect(unseal(state.grants['provider:' + connection.id].encrypted, context, crypto).token).toBe(
    'synthetic-bearer'
  );
  expect(JSON.stringify(state)).not.toContain('synthetic-personal-key');
});
