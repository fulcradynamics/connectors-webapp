import { it, expect, vi } from 'vitest';
import { createGarmin } from './garmin.js';
import { revisionId } from '../sync/identity.js';
import { previewConnection } from '../connections.js';
const now = () => Date.parse('2026-11-02T15:00:00Z');
const credential = { token: 'synthetic-access', accountId: '42', timeZone: 'America/New_York' };
const connection = (resources = ['daily']) => ({
  connector: 'garmin',
  account_id: '42',
  config: { resources, backfillSince: '2026-11-01T12:00:00Z' }
});
/** @param {(url:URL)=>Response} handler */
function fixture(handler) {
  const fetchImpl = vi.fn(async (url, init) => {
    expect(new URL(url).origin).toBe('https://personal.connectapi.garmin.com');
    expect(init.headers.Authorization).toBe('Bearer synthetic-access');
    expect(init.redirect).toBe('error');
    return handler(new URL(url));
  });
  return { adapter: createGarmin({ fetchImpl, now }), fetchImpl };
}
/** @param {any} value */
const response = (value, status = 200, headers = {}) =>
  new Response(status === 204 ? null : JSON.stringify(value), { status, headers });
/** @param {any} c @param {any} checkpoint */
const input = (c = connection(), checkpoint = null) => ({
  connection: c,
  credential,
  checkpoint,
  deadline: Date.now() + 30000
});
it('keeps a date-picker boundary as the selected local date west of UTC', async () => {
  const { adapter } = fixture((url) =>
    response({ userProfileId: 42, calendarDate: url.searchParams.get('calendarDate') })
  );
  const c = connection();
  c.config.backfillSince = '2026-11-01T00:00:00Z';
  const page = await adapter.readPage(input(c));
  expect(page.candidateCheckpoint.cycle.from).toBe('2026-11-01');
  const next = await adapter.readPage(input(c, page.candidateCheckpoint));
  expect(next.continuation).toBe(false);
});
it('allows an honestly labeled empty bounded preview for sparse activity history', async () => {
  const { adapter } = fixture(() => response([]));
  const c = {
    ...connection(['activities']),
    config: {
      ...connection(['activities']).config,
      backfillSince: '2026-10-26T00:00:00Z',
      route: { mode: 'file', folder: '/connectors/garmin' }
    }
  };
  const preview = await previewConnection(c, adapter, credential, 'owner');
  expect(preview).toMatchObject({
    complete: true,
    writesPerformed: false,
    outputs: [],
    hasMore: true
  });
  expect(preview.detail).toContain('does not cover every selected dataset');
  expect(
    (await previewConnection(c, { readPage: adapter.readPage }, credential, 'owner')).complete
  ).toBe(false);
  const throttled = fixture(() => response({}, 429, { 'retry-after': '60' }));
  expect((await previewConnection(c, throttled.adapter, credential, 'owner')).complete).toBe(false);
});
it('verifies immutable account identity and provider time zone, never a supplied display name or ID', async () => {
  const { adapter } = fixture((url) =>
    response(
      url.pathname.includes('settings')
        ? { displayName: 'mutable', timeZone: 'America/New_York' }
        : { userProfileId: 42, calendarDate: '2026-11-02' }
    )
  );
  expect(await adapter.validate({ ...credential, accountId: 'forged' })).toEqual({
    accountId: '42',
    timeZone: 'America/New_York'
  });
  expect((await adapter.listResources({ credential })).resources.map((x) => x.id)).toEqual([
    'activities',
    'daily',
    'sleep',
    'heart_rate',
    'hrv'
  ]);
  const bad = fixture(() => response({ displayName: 'not-an-id', timeZone: 'UTC' }));
  await expect(bad.adapter.validate(credential)).rejects.toThrow(/identity.*configuration/i);
});
it('resumes one selected day at a time, preserves source units, and handles DST using local dates', async () => {
  const { adapter, fetchImpl } = fixture((url) =>
    response({
      userProfileId: 42,
      calendarDate: url.searchParams.get('calendarDate'),
      totalSteps: 125
    })
  );
  const first = await adapter.readPage(input());
  expect(first.changes[0]).toMatchObject({
    id: 'daily:42:2026-11-02',
    timestamp: '2026-11-02T05:00:00.000Z',
    payload: { data: { totalSteps: 125 }, timeZone: 'America/New_York' }
  });
  expect(first.continuation).toBe(true);
  const second = await adapter.readPage(input(connection(), first.candidateCheckpoint));
  expect(second.changes[0].timestamp).toBe('2026-11-01T04:00:00.000Z');
  expect(second.continuation).toBe(false);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it('deduplicates unchanged data, versions corrections, and rereads recent days before daily full history', async () => {
  let steps = 1;
  const { adapter } = fixture((url) =>
    response({
      userProfileId: 42,
      calendarDate: url.searchParams.get('calendarDate'),
      totalSteps: steps
    })
  );
  const first = await adapter.readPage(input());
  const repeat = await adapter.readPage(input());
  expect(repeat.changes).toEqual(first.changes);
  const context = {
    ownerId: 'owner',
    dataType: 'Event/test',
    connectorId: 'garmin',
    sourceAccountId: '42',
    routeVersion: 1
  };
  expect(revisionId(context, repeat.changes[0])).toBe(revisionId(context, first.changes[0]));
  steps = 2;
  const corrected = await adapter.readPage(input());
  expect(revisionId(context, corrected.changes[0])).not.toBe(revisionId(context, first.changes[0]));
  const old = connection();
  old.config.backfillSince = '2026-10-01T12:00:00Z';
  const recent = await adapter.readPage(input(old, { lastFullAt: '2026-11-02T12:00:00Z' }));
  expect(recent.candidateCheckpoint.cycle.from).toBe('2026-10-27');
  const full = await adapter.readPage(input(old, { lastFullAt: '2026-10-31T12:00:00Z' }));
  expect(full.candidateCheckpoint.cycle.from).toBe('2026-10-01');
});
it('hydrates bounded activity pages, resumes offsets and normalizes explicit GMT fields', async () => {
  /** @type {string[]} */
  const calls = [];
  const { adapter } = fixture((url) => {
    calls.push(url.pathname);
    if (url.pathname.includes('activitylist')) {
      expect(url.searchParams.get('limit')).toBe('1');
      expect(url.searchParams.get('excludeChildren')).toBe('true');
      return response(url.searchParams.get('start') === '0' ? [{ activityId: 7 }] : []);
    }
    return response({
      activityId: 7,
      userProfileId: 42,
      summaryDTO: {
        startTimeGMT: '2026-11-02T09:30:00.000',
        startTimeLocal: '2026-11-02T04:30:00.000',
        distance: 1000
      }
    });
  });
  const first = await adapter.readPage(input(connection(['activities'])));
  expect(first.changes[0]).toMatchObject({
    id: 'activities:42:7',
    timestamp: '2026-11-02T09:30:00.000Z'
  });
  expect(first.candidateCheckpoint.cycle.offset).toBe(1);
  const second = await adapter.readPage(
    input(connection(['activities']), first.candidateCheckpoint)
  );
  expect(second.changes).toEqual([]);
  expect(second.candidateCheckpoint.cycle.date).toBe('2026-11-01');
  expect(calls).toHaveLength(3);
});
it('imports sleep, heart-rate arrays and HRV with stable date identities, skipping 204/empty days without deletion', async () => {
  /** @type {[string,any][]} */
  const cases = [
    ['sleep', { userProfilePK: 42, calendarDate: '2026-11-02', sleepTimeSeconds: 28800 }],
    [
      'heart_rate',
      {
        userProfilePK: 42,
        calendarDate: { date: '2026-11-02T05:00:00Z', localDate: '2026-11-02' },
        heartRateValues: [
          [1793610000000, 60],
          [1793610060000, null]
        ]
      }
    ],
    ['hrv', { userProfilePk: 42, hrvSummary: { calendarDate: '2026-11-02', lastNightAvg: 48 } }]
  ];
  for (const [id, body] of cases) {
    const { adapter } = fixture(() => response(body));
    const page = await adapter.readPage(input(connection([id])));
    expect(page.changes[0].payload.data).toEqual(body);
    expect(page.changes[0].id).toBe(`${id}:42:2026-11-02`);
  }
  for (const res of [() => response(null, 204), () => response({})]) {
    const { adapter } = fixture(res);
    expect((await adapter.readPage(input(connection(['hrv'])))).changes).toEqual([]);
  }
});
it('rejects mismatched accounts/dates, arbitrary sources, unsafe IDs, oversized payloads and revoked keys', async () => {
  for (const body of [
    { userProfileId: 99, calendarDate: '2026-11-02' },
    { userProfileId: 42, calendarDate: '2026-10-01' }
  ]) {
    await expect(fixture(() => response(body)).adapter.readPage(input())).rejects.toThrow(
      /identity|date/i
    );
  }
  const { adapter, fetchImpl } = fixture(() => response({}));
  await expect(adapter.readPage(input(connection(['https://attacker.invalid'])))).rejects.toThrow(
    /selected|source/i
  );
  expect(fetchImpl).not.toHaveBeenCalled();
  await expect(
    fixture(() => response([{ activityId: '../private' }])).adapter.readPage(
      input(connection(['activities']))
    )
  ).rejects.toThrow(/identity/i);
  await expect(
    fixture(() =>
      response({ userProfileId: 42, calendarDate: '2026-11-02', large: 'x'.repeat(200000) })
    ).adapter.readPage(input())
  ).rejects.toThrow(/bound/i);
  await expect(fixture(() => response({}, 401)).adapter.readPage(input())).rejects.toThrow(
    /reauthorize/
  );
});
it('retains the old checkpoint on throttle so delayed data is retried', async () => {
  const { adapter } = fixture(() => response({}, 429, { 'retry-after': '120' }));
  const cp = { lastFullAt: null };
  const page = await adapter.readPage(input(connection(), cp));
  expect(page).toMatchObject({ changes: [], retryAt: expect.any(String) });
  expect(page.candidateCheckpoint).toBeUndefined();
  expect(cp).toEqual({ lastFullAt: null });
});
