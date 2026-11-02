import { it, expect } from 'vitest';
import * as setup from './setup.js';
it('provides shared connector setup behavior', () =>
  expect(typeof setup.setupDefaults).toBe('function'));
if (setup.setupDefaults) {
  it('proposes files, a seven-day initial date and a per-connection five-minute interval', () => {
    expect(setup.setupDefaults('granola', {}, Date.parse('2026-10-23T12:00:00Z'))).toEqual({
      mode: 'file',
      folder: '/connectors/granola',
      recordType: '',
      intervalSeconds: 300,
      backfillSince: '2026-10-16T12:00:00.000Z'
    });
    expect(setup.describeInterval(300)).toBe('Every 5 minutes');
    expect(setup.describeInterval(60)).toBe('Every minute');
    expect(setup.describeInterval(86400)).toBe('Every 24 hours');
  });
  it('restores saved frequency, date and both destinations without mutating configuration', () => {
    const config = Object.freeze({
      intervalSeconds: 900,
      backfillSince: '2026-10-01T00:00:00Z',
      route: Object.freeze({ mode: 'both', folder: '/work/meetings', recordType: 'Event/chosen' })
    });
    const values = setup.setupDefaults('granola', config);
    expect(values).toMatchObject({
      intervalSeconds: 900,
      backfillSince: config.backfillSince,
      mode: 'both',
      folder: '/work/meetings',
      recordType: 'Event/chosen'
    });
    expect(setup.describeDestination(values)).toContain('/work/meetings');
    expect(setup.describeDestination(values)).toContain('Event/chosen');
    expect(setup.describeDestination({ mode: 'record', recordType: '' })).toBe(
      'Choose a v1 data type'
    );
  });
  it('provides official credential steps and truthful provider-specific source/backfill/output guidance', () => {
    for (const id of ['granola', 'asana', 'github', 'notion', 'slack', 'garmin']) {
      const info = setup.getConnectorSetup(id);
      expect(info.setupUrl).toMatch(/^https:\/\//);
      expect(info.credentialSteps.length).toBeGreaterThan(1);
      expect(info.output.length).toBeGreaterThan(10);
      expect(info.scopes.length).toBeGreaterThan(10);
    }
    expect(setup.getConnectorSetup('granola').credentialSteps.join(' ')).toContain(
      'Settings → Connectors → API keys'
    );
    expect(setup.getConnectorSetup('asana').backfillHelp).toContain('snapshot');
    expect(setup.getConnectorSetup('notion').backfillHelp).toContain('not a date filter');
    expect(setup.getConnectorSetup('slack').limitations).toContain('old edits');
    expect(setup.getConnectorSetup('slack').scopes).toContain('channels:read');
    expect(setup.getConnectorSetup('slack').scopes).toContain('groups:history');
    expect(setup.getConnectorSetup('slack').credentialSteps.join(' ')).toContain(
      'OAuth & Permissions'
    );
    expect(setup.getConnectorSetup('slack').sourceHelp).toContain('member');
    expect(() => setup.setupDefaults('unknown')).toThrow(/unsupported/i);
  });
}

it('links Garmin key creation directly and discloses renewal, dataset, type and cadence semantics', () => {
  const info = setup.getConnectorSetup('garmin');
  expect(info.credentialUrl).toBe('https://connect.garmin.com/app/settings/personalApiToken');
  expect(info.credentialSteps.join(' ')).toContain('once-displayed');
  expect(info.credentialSteps.join(' ')).toContain('expiration');
  expect(info.output).toContain('v1 Event');
  expect(info.backfillHelp).toContain('7 calendar days');
  expect(info.limitations).toContain('expired/revoked');
  expect(setup.setupDefaults('garmin').folder).toBe('/connectors/garmin');
});

it('provides Attio native token creation, explicit selected-field writes and connector-only bounds', () => {
  expect(setup.getSourceLimit('attio')).toBe(1000);
  for (const connector of ['notion', 'github', 'garmin', 'granola', 'asana', 'slack'])
    expect(setup.getSourceLimit(connector)).toBe(50);
  const info = setup.getConnectorSetup('attio');
  expect(info.credentialUrl).toBeNull();
  expect(info.credentialNote).toContain('Workspace settings');
  expect(info.credentialSteps.join(' ')).toContain('Create access token');
  expect(info.credentialSteps.join(' ')).toContain('click Save');
  expect(info.setupUrl).toBe('https://attio.com/help/reference/apps/generating-an-api-key');
  expect(info.scopes).toContain('record_permission:read-write');
  expect(info.scopes).toContain('note:read-write');
  expect(info.output).toContain('API text projection');
  expect(info.limitations).toContain('original rich note');
  expect(info.sourceHelp).toContain('exact');
  expect(setup.setupDefaults('attio', {}, Date.parse('2026-11-02T12:00:00Z'))).toMatchObject({
    folder: '/connectors/attio',
    intervalSeconds: 300,
    backfillSince: '2026-10-03T12:00:00.000Z'
  });
  expect(
    setup.setupDefaults('attio', { backfillSince: '2026-09-01T00:00:00Z' }).backfillSince
  ).toBe('2026-09-01T00:00:00Z');
});
