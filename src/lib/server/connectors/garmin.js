import { providerHTTP, rateAware, selectedResources } from './http.js';
import { GARMIN_BASE } from './garmin-auth.js';
import { canonical, contentHash } from '../sync/identity.js';
const DAY = 86400000;
const datasets = [
  { id: 'activities', name: 'Activities (JSON summaries)', kind: 'dataset' },
  { id: 'daily', name: 'Daily summaries (steps, stress, Body Battery)', kind: 'dataset' },
  { id: 'sleep', name: 'Sleep', kind: 'dataset' },
  { id: 'heart_rate', name: 'Heart rate (daily readings)', kind: 'dataset' },
  { id: 'hrv', name: 'Heart rate variability (HRV)', kind: 'dataset' }
];
/** @param {any} value */
function accountID(value) {
  if (
    (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value))
  )
    return String(value);
  throw Error('Garmin account identity required_configuration');
}
/** @param {any} value */
function timeZone(value) {
  if (typeof value !== 'string' || value.length > 100)
    throw Error('Garmin time zone required_configuration');
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    throw Error('Invalid Garmin time zone configuration');
  }
}
/** Calendar dates are provider-local, never the server's time zone.
 * @param {number} instant @param {string} zone */
function localDate(instant, zone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instant);
  return ['year', 'month', 'day'].map((key) => parts.find((p) => p.type === key)?.value).join('-');
}
/** @param {string} date @param {number} days */
const addDays = (date, days) =>
  new Date(Date.parse(date + 'T12:00:00Z') + days * DAY).toISOString().slice(0, 10);
/** First instant in a local calendar date, including DST transitions at midnight.
 * @param {string} date @param {string} zone */
function dateStart(date, zone) {
  const center = Date.parse(date + 'T12:00:00Z');
  let low = center - 36 * 3600000,
    high = center + 36 * 3600000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (localDate(mid, zone) < date) low = mid + 1;
    else high = mid;
  }
  if (localDate(low, zone) !== date) throw Error('Invalid Garmin calendar date');
  return new Date(low).toISOString();
}
/** Only documented GMT fields use this conversion. Local fields are never parsed as UTC.
 * @param {any} value */
function gmt(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)
  )
    throw Error('Invalid Garmin activity GMT timestamp');
  const normalized = value.replace(' ', 'T');
  const instant = Date.parse(
    /[Zz]|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : normalized + 'Z'
  );
  if (!Number.isFinite(instant)) throw Error('Invalid Garmin activity timestamp');
  return new Date(instant).toISOString();
}
/** @param {{fetchImpl?:typeof fetch,now?:()=>number}} options */
export function createGarmin({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  /** @param {any} credential @param {number} deadline */
  const request = (credential, deadline) =>
    providerHTTP({ base: GARMIN_BASE, credential, fetchImpl, deadline });
  /** @param {any} credential */
  async function validate(credential) {
    const req = request(credential, Date.now() + 20000);
    const settings = (await req('userprofile-service/userprofile/settings')).data;
    const zone = timeZone(settings.timeZone);
    const summary = (
      await req('usersummary-service/usersummary/daily?calendarDate=' + localDate(now(), zone))
    ).data;
    return { accountId: accountID(summary.userProfileId), timeZone: zone };
  }
  /** @param {any} input */
  async function listResources({ credential, deadline = Date.now() + 10000 }) {
    // Revalidate access even though the dataset names themselves are fixed.
    const settings = (
      await request(credential, deadline)('userprofile-service/userprofile/settings')
    ).data;
    timeZone(settings.timeZone);
    return { resources: datasets.map((x) => ({ ...x })), nextCursor: null };
  }
  /** @param {any} input */
  async function readPage({ connection, credential, checkpoint, deadline }) {
    return rateAware(async () => {
      const sources = selectedResources(connection);
      if (sources.some((id) => !datasets.some((d) => d.id === id)))
        throw Error('Invalid selected Garmin source');
      const account = accountID(connection.account_id),
        zone = timeZone(credential.timeZone);
      if (accountID(credential.accountId) !== account)
        throw Error('Garmin account identity changed; reauthorize');
      const cp = structuredClone(checkpoint ?? {}),
        today = localDate(now(), zone);
      const configured = Date.parse(connection.config.backfillSince);
      if (!Number.isFinite(configured) || configured > now())
        throw Error('Invalid Garmin backfill configuration');
      // Keep ongoing reconciliation bounded to one year as the stored initial date ages.
      // The shared date picker stores YYYY-MM-DD at UTC midnight. That prefix is
      // a user-selected calendar date, not an instant to shift into another day.
      const selectedDate = new Date(configured).toISOString().slice(0, 10);
      const oldest = addDays(today, -365);
      const earliest = selectedDate > oldest ? selectedDate : oldest;
      if (earliest > today) return { changes: [], candidateCheckpoint: cp, continuation: false };
      if (!cp.cycle) {
        const full = !cp.lastFullAt || now() - Date.parse(cp.lastFullAt) >= DAY;
        const from = full ? earliest : [earliest, addDays(today, -6)].sort().at(-1);
        cp.cycle = {
          from,
          to: today,
          date: today,
          index: 0,
          offset: 0,
          full,
          startedAt: new Date(now()).toISOString()
        };
      }
      const cycle = cp.cycle,
        source = sources[cycle.index];
      if (
        !source ||
        cycle.date < cycle.from ||
        cycle.date > cycle.to ||
        !Number.isSafeInteger(cycle.offset) ||
        cycle.offset < 0 ||
        cycle.offset > 10000
      )
        throw Error('Invalid Garmin checkpoint bound');
      const req = request(credential, deadline);
      let data,
        timestamp,
        id,
        date = cycle.date,
        moreActivities = false;
      if (source === 'activities') {
        const query = new URLSearchParams({
          start: String(cycle.offset),
          limit: '1',
          startDate: date,
          endDate: date,
          sortOrder: 'asc',
          sortBy: 'startLocal',
          excludeChildren: 'true'
        });
        const listing = (await req('activitylist-service/activities/search/activities?' + query))
          .data;
        if (!Array.isArray(listing) || listing.length > 1)
          throw Error('Invalid Garmin activity page bound');
        if (listing.length) {
          const activity = accountID(listing[0].activityId);
          data = (await req('activity-service/activity/' + activity)).data;
          if (accountID(data.activityId) !== activity)
            throw Error('Invalid Garmin activity identity');
          timestamp = gmt(data.summaryDTO?.startTimeGMT);
          id = activity;
          moreActivities = true;
          // Search dates are in the activity's own local time zone, which may differ
          // from current account settings during travel. Preserve that source date.
          const local = data.summaryDTO?.startTimeLocal;
          if (typeof local !== 'string' || local.slice(0, 10) !== date)
            throw Error('Invalid Garmin activity date');
        }
      } else {
        const paths = {
          daily: 'usersummary-service/usersummary/daily?calendarDate=' + date,
          sleep: 'sleep-service/sleep/dailySleep?date=' + date,
          heart_rate: 'wellness-service/wellness/dailyHeartRate?date=' + date,
          hrv: 'hrv-service/hrv/' + date
        };
        const result = await req(paths[/** @type {keyof typeof paths} */ (source)], {}, [204]);
        if (result.status !== 204 && result.data && Object.keys(result.data).length) {
          data = result.data;
          // DailyHeartRateDTO uses ConnectDate, unlike the other daily schemas.
          const sourceDate =
            source === 'heart_rate' && typeof data.calendarDate === 'object'
              ? data.calendarDate?.localDate
              : (data.calendarDate ?? data.hrvSummary?.calendarDate);
          if (sourceDate !== date) throw Error('Invalid Garmin source date');
          id = date;
          timestamp = dateStart(date, zone);
        }
      }
      const changes = [];
      if (data) {
        const owner = data.userProfileId ?? data.userProfilePK ?? data.userProfilePk;
        if (accountID(owner) !== account)
          throw Error('Garmin source account identity mismatch; reauthorize');
        const payload = { dataset: source, calendarDate: date, timeZone: zone, data };
        if (Buffer.byteLength(JSON.stringify(payload)) > 180000)
          throw Error('Garmin payload exceeds native page bound');
        changes.push({
          id: `${source}:${account}:${id}`,
          version: contentHash(canonical(payload)),
          timestamp,
          payload
        });
      }
      if (moreActivities) cycle.offset++;
      else {
        cycle.offset = 0;
        cycle.index++;
        if (cycle.index === sources.length) {
          cycle.index = 0;
          cycle.date = addDays(cycle.date, -1);
        }
      }
      const continuation = cycle.date >= cycle.from;
      if (!continuation) {
        if (cycle.full) cp.lastFullAt = cycle.startedAt;
        cp.cycle = null;
      }
      return { changes, candidateCheckpoint: cp, continuation };
    });
  }
  return { validate, listResources, readPage, previewPolicy: 'bounded-sample' };
}
export const garmin = createGarmin();
