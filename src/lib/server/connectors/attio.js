import { createHash } from 'node:crypto';
import { attioAPI, createAttioAPI, parseResource } from '../attio-sync/provider.js';
import { rateAware } from './http.js';

/** @param {any} value @returns {any} */
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, ordered(value[key])])
    );
  return value;
}
/** @param {any} value */
function hash(value) {
  return createHash('sha256')
    .update(JSON.stringify(ordered(value)))
    .digest('hex');
}
/** @param {{fetchImpl?:typeof fetch,api?:any}} options */
export function createAttio({
  fetchImpl = fetch,
  api = fetchImpl === fetch ? attioAPI : createAttioAPI({ fetchImpl })
} = {}) {
  /** @param {any} projection @param {string} id @param {'record'|'note'} kind */
  function change(projection, id, kind) {
    const dates = [projection.createdAt];
    for (const values of Object.values(projection.rawValues ?? {})) {
      for (const value of /** @type {any[]} */ (values)) dates.push(value.active_from);
    }
    const validDates = dates.filter(
      (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
    );
    if (!validDates.length) throw new Error('Attio source timestamp missing');
    const timestamp = validDates.reduce((latest, value) =>
      Date.parse(value) > Date.parse(latest) ? value : latest
    );
    return {
      id,
      version: hash(projection),
      timestamp,
      operation: /** @type {const} */ ('upsert'),
      payload: projection,
      files: [
        {
          name: `${kind}-${kind === 'note' ? projection.binding.noteId : projection.binding.recordId}.json`,
          content: JSON.stringify(projection, null, 2),
          contentType: 'application/json'
        }
      ]
    };
  }
  /** @param {{connection:any,credential:any,checkpoint:any,deadline?:number}} input */
  async function readPage({ connection, credential, checkpoint, deadline = Date.now() + 10_000 }) {
    return rateAware(async () => {
      const resources = connection.config?.resources;
      if (
        !Array.isArray(resources) ||
        !resources.length ||
        resources.length > 1000 ||
        new Set(resources).size !== resources.length
      )
        throw new Error('Attio selected resources required_configuration');
      for (const id of resources) parseResource(id);
      const { workspaceId, accountId } = await api.validate(credential, deadline);
      if (
        !workspaceId ||
        workspaceId !== connection.account_id ||
        accountId !== connection.account_id
      )
        throw new Error('Attio account workspace replacement requires reconfiguration');
      const includeNotes = connection.config.attio?.includeNotes === true;
      const since = connection.config.backfillSince;
      if (includeNotes && (typeof since !== 'string' || !Number.isFinite(Date.parse(since))))
        throw new Error('Attio note history window required_configuration');
      const scope = hash({
        workspaceId,
        resources,
        includeNotes,
        since: includeNotes ? since : null
      });
      const cp =
        checkpoint === null || checkpoint === undefined
          ? { version: 1, scope, index: 0, phase: 'record', cursor: null }
          : structuredClone(checkpoint);
      if (
        !cp ||
        cp.version !== 1 ||
        cp.scope !== scope ||
        !Number.isInteger(cp.index) ||
        cp.index < 0 ||
        cp.index >= resources.length ||
        !['record', 'notes'].includes(cp.phase) ||
        (cp.phase === 'notes' && !includeNotes) ||
        (cp.cursor !== null && (typeof cp.cursor !== 'string' || cp.cursor.length > 600)) ||
        (cp.phase === 'record' && cp.cursor !== null) ||
        Object.keys(cp).some(
          (key) => !['version', 'scope', 'index', 'phase', 'cursor'].includes(key)
        )
      )
        throw new Error('Attio checkpoint scope or shape invalid');
      const id = resources[cp.index];
      /** @type {any[]} */ let changes;
      if (cp.phase === 'record') {
        const record = await api.readRecord(id, credential, workspaceId, deadline);
        const parent = parseResource(id);
        if (
          record.binding.workspaceId !== workspaceId ||
          record.binding.objectId !== parent.objectId ||
          record.binding.recordId !== parent.recordId
        )
          throw new Error('Attio record binding mismatch');
        changes = [change(record, id, 'record')];
        if (includeNotes) cp.phase = 'notes';
        else cp.index = (cp.index + 1) % resources.length;
      } else {
        const page = await api.listNotes(id, credential, workspaceId, cp.cursor, deadline);
        if (
          !Array.isArray(page.notes) ||
          page.notes.length > 25 ||
          (page.nextCursor !== null &&
            (typeof page.nextCursor !== 'string' ||
              page.nextCursor === cp.cursor ||
              page.nextCursor.length > 600))
        )
          throw new Error('Attio note page/cursor invalid');
        const parent = parseResource(id),
          seen = new Set();
        changes = page.notes
          .filter((/** @type {any} */ note) => {
            if (
              note.binding.workspaceId !== workspaceId ||
              note.binding.objectId !== parent.objectId ||
              note.binding.recordId !== parent.recordId ||
              seen.has(note.binding.noteId)
            )
              throw new Error('Attio note parent binding mismatch');
            seen.add(note.binding.noteId);
            if (!Number.isFinite(Date.parse(note.createdAt)))
              throw new Error('Attio note source timestamp missing');
            return Date.parse(note.createdAt) >= Date.parse(since);
          })
          .map((/** @type {any} */ note) =>
            change(note, `${id}:note:${note.binding.noteId}`, 'note')
          );
        cp.cursor = page.nextCursor;
        if (!cp.cursor) {
          cp.phase = 'record';
          cp.index = (cp.index + 1) % resources.length;
        }
      }
      return {
        changes,
        candidateCheckpoint: cp,
        continuation: cp.phase !== 'record' || cp.index !== 0
      };
    });
  }
  return { validate: api.validate, listResources: api.listResources, readPage };
}
export const attio = createAttio();
