import { it, expect, vi } from 'vitest';
import { enrollProviderCredential } from './provider-enrollment.js';
import { adapters } from './connectors/index.js';
it('binds Garmin credentials only to server-verified identity and discards client cache/account claims', async () => {
  const validate = vi
    .spyOn(adapters.garmin, 'validate')
    .mockResolvedValue({ accountId: '42', timeZone: 'UTC' });
  try {
    const result = await enrollProviderCredential(
      'garmin',
      {
        token: 'synthetic-personal-key',
        accountId: 'forged',
        kind: 'github_app',
        expiresAt: '2099-01-01',
        apiKey: 'wrong'
      },
      {
        fetchImpl: async () => Response.json({ access_token: 'synthetic-bearer', expires_in: 3600 })
      }
    );
    expect(result.accountId).toBe('42');
    expect(result.credential).toMatchObject({
      kind: 'garmin_personal',
      apiKey: 'synthetic-personal-key',
      token: 'synthetic-bearer',
      accountId: '42',
      timeZone: 'UTC'
    });
    expect(validate).toHaveBeenCalledOnce();
  } finally {
    validate.mockRestore();
  }
});
it('does not dispatch a foreign credential type or break static credentials', async () => {
  await expect(
    enrollProviderCredential('notion', { kind: 'garmin_personal', apiKey: 'synthetic' })
  ).rejects.toThrow(/credential kind/);
  const validate = vi
    .spyOn(adapters.notion, 'validate')
    .mockResolvedValue({ accountId: 'fixture-account' });
  try {
    const credential = { token: 'synthetic-read-token' };
    expect(await enrollProviderCredential('notion', credential)).toEqual({
      credential,
      accountId: 'fixture-account'
    });
  } finally {
    validate.mockRestore();
  }
});

it('enrolls only Attio token plus trusted verified workspace and scopes, discarding client claims', async () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001';
  const scopes = ['object_configuration:read', 'record_permission:read-write'];
  const validate = vi
    .spyOn(adapters.attio, 'validate')
    .mockResolvedValue({ accountId: workspaceId, workspaceId, scopes });
  try {
    const result = await enrollProviderCredential('attio', {
      token: 'synthetic-attio-token',
      workspaceId: 'forged',
      scopes: ['forged'],
      accountId: 'forged',
      extra: 'private'
    });
    expect(validate).toHaveBeenCalledWith({ token: 'synthetic-attio-token' });
    expect(result).toEqual({
      accountId: workspaceId,
      credential: { token: 'synthetic-attio-token', workspaceId, scopes }
    });
    scopes.push('note:read');
    expect(result.credential.scopes).toEqual([
      'object_configuration:read',
      'record_permission:read-write'
    ]);
  } finally {
    validate.mockRestore();
  }
});

it('rejects missing or inconsistent Attio verified workspace metadata', async () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001';
  const validate = vi.spyOn(adapters.attio, 'validate');
  try {
    for (const verified of [
      { accountId: workspaceId },
      { accountId: workspaceId, workspaceId: 'invalid', scopes: [] },
      { accountId: '20000000-0000-4000-8000-000000000001', workspaceId, scopes: [] },
      { accountId: workspaceId, workspaceId, scopes: 'not-array' }
    ]) {
      validate.mockResolvedValueOnce(/** @type {any} */ (verified));
      await expect(
        enrollProviderCredential('attio', { token: 'synthetic-attio-token' })
      ).rejects.toThrow(/workspace|scope|identity/i);
    }
  } finally {
    validate.mockRestore();
  }
});

it('rejects an absent Attio token before verification and never stores an unusable credential envelope', async () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001';
  const validate = vi
    .spyOn(adapters.attio, 'validate')
    .mockResolvedValue({ accountId: workspaceId, workspaceId, scopes: ['record_permission:read'] });
  try {
    for (const token of [undefined, '', 42, 'line\nbreak'])
      await expect(enrollProviderCredential('attio', { token })).rejects.toThrow(
        /token|credential/i
      );
    expect(validate).not.toHaveBeenCalled();
  } finally {
    validate.mockRestore();
  }
});
