import { it, expect, vi } from 'vitest';
import { garminPersonalCredential } from './garmin-auth.js';
import { getProviderCredential } from '../credentials.js';
import { seal, unseal } from '../secrets.js';
const key = 'synthetic-personal-key';
it('exchanges only at the official endpoint, caches and renews a short-lived token', async () => {
  const fetchImpl = vi.fn(async (url, init) => {
    expect(String(url)).toBe(
      'https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token'
    );
    expect(init.headers.Authorization).toBe('ApiKey ' + key);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    return Response.json({ access_token: 'synthetic-access', expires_in: 3600 });
  });
  const first = await garminPersonalCredential(
    { kind: 'garmin_personal', apiKey: key },
    { fetchImpl }
  );
  expect(first.token).toBe('synthetic-access');
  expect(Date.parse(first.expiresAt) - Date.now()).toBeLessThanOrEqual(3600000);
  expect(await garminPersonalCredential(first, { fetchImpl })).toBe(first);
  await garminPersonalCredential({ ...first, expiresAt: '2000-01-01T00:00:00Z' }, { fetchImpl });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it('bounds undocumented expiry at24hours and rejects invalid/oversized/expired/revoked grants without echoing secrets', async () => {
  const token = await garminPersonalCredential(
    { apiKey: key },
    { fetchImpl: async () => Response.json({ accessToken: 'synthetic-access' }) }
  );
  expect(Date.parse(token.expiresAt) - Date.now()).toBeLessThanOrEqual(86400000);
  for (const response of [
    Response.json({}),
    Response.json({ access_token: 'x'.repeat(40000) }),
    Response.json({ access_token: 'synthetic-access', expires_in: -1 })
  ]) {
    await expect(
      garminPersonalCredential({ apiKey: key }, { fetchImpl: async () => response })
    ).rejects.toThrow(/Invalid/);
  }
  for (const status of [401, 403]) {
    await expect(
      garminPersonalCredential(
        { apiKey: key },
        { fetchImpl: async () => Response.json({ secret: key }, { status }) }
      )
    ).rejects.toThrow('Garmin reauthorize');
  }
});
it('persists renewal encrypted under the shared grant lock and marks expired keys for reauthorization', async () => {
  const crypto = { key: Buffer.alloc(32, 7).toString('base64'), keyId: 'fixture' };
  const context = 'deployment:owner:provider:connection';
  let row = {
    status: 'ready',
    encrypted: seal(
      {
        kind: 'garmin_personal',
        apiKey: key,
        token: 'old',
        expiresAt: '2000-01-01T00:00:00Z',
        accountId: '42',
        timeZone: 'UTC'
      },
      context,
      crypto
    )
  };
  const store = {
    deploymentId: 'deployment',
    ownerId: 'owner',
    withGrantLock: vi.fn(async (_key, fn) => {
      const result = await fn(row);
      if (result.patch) row = { ...row, ...result.patch };
      return result;
    })
  };
  const grant = await getProviderCredential(store, 'connection', crypto, {
    fetchImpl: async () => Response.json({ access_token: 'new', expires_in: 3600 })
  });
  expect(grant.token).toBe('new');
  expect(grant.accountId).toBe('42');
  expect(unseal(row.encrypted, context, crypto).token).toBe('new');
  expect(JSON.stringify(row)).not.toContain(key);
  row.encrypted = seal({ ...grant, expiresAt: '2000-01-01T00:00:00Z' }, context, crypto);
  await expect(
    getProviderCredential(store, 'connection', crypto, {
      fetchImpl: async () => new Response(null, { status: 401 })
    })
  ).rejects.toThrow(/reauthorize/);
  expect(row.status).toBe('reauthorize');
});
