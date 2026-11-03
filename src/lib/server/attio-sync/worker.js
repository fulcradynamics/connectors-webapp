import { randomUUID } from 'node:crypto';
import { nativeStore } from '../native/state.js';
import { canonical, contentHash } from '../sync/identity.js';
import { prepareOutput } from '../sync/runner.js';
import { validateOutput, validateRoute, verify } from '../sync/sinks.js';
import {
  decodeDocument,
  encodeDocument,
  encodeValues,
  validateEdit
} from '../../attio-documents.js';
import {
  loadManifest,
  saveManifest,
  loadBucket,
  bucketEnvelope,
  bucketId,
  localId,
  folder
} from './state.js';
import { fileIntent, advanceFile } from './files.js';
import { baselineFor, reconcile } from './reconcile.js';
import { queueIndex, advanceIndex, indexStatus } from './index.js';
import { readRemoteObservation, providerHash, assertBinding } from './projection.js';
import {
  prepareRevision,
  matchesRevision,
  revisionReadback,
  notePayloadHash
} from './note-revisions.js';
import { attioAPI } from './provider.js';

/** @param {any} c @param {any} e */
const workingPath = (c, e) =>
  `${folder(c)}/${e.kind === 'note' ? 'notes' : 'records'}/${bucketId(e.id)}/${e.id}.json`;
/** @param {any} value */
const hash = (value) => contentHash(canonical(value));
/** Provider-derived labels and readonly values may legitimately change after a
 * selected field write. Success requires the complete writable result and schema;
 * fresh protected metadata is then adopted rather than sent back to the provider.
 * @param {any} desired @param {any} observed */
function desiredRemote(desired, observed) {
  if (desired.kind !== 'record') return providerHash(desired) === providerHash(observed);
  const left = baselineFor(desired),
    right = baselineFor(observed);
  return left.schemaHash === right.schemaHash && canonical(left.fields) === canonical(right.fields);
}
/** @param {any} e @param {any} c */
function allowed(e, c) {
  assertBinding(e, c, e.binding, e.kind === 'note' ? e.binding.noteId : null);
  if (e.id !== localId(c, e.kind, e.kind === 'note' ? e.binding.noteId : e.resourceId))
    throw Error('Attio mapping identity changed');
}
/** @param {any} e @param {any} p @param {string} status @param {string} error */
function retain(e, p, status, error) {
  if (p.accepted)
    e.recovery = {
      ...e.recovery,
      document: p.accepted,
      operationId: p.operationId,
      ...(p.revision
        ? {
            revision: p.revision,
            attemptGuard: p.attemptGuard,
            creationAttempted: p.creationAttempted,
            noteResume: {
              ...(p.document && encodeDocument(p.document) !== encodeDocument(p.accepted)
                ? { document: p.document }
                : {}),
              workFileId: p.workFileId,
              workHistory: p.workHistory,
              workDeleted: p.workDeleted,
              sourceHash: p.attemptSourceHash ?? p.sourceHash
            }
          }
        : {}),
      interveningFileIds: [
        ...new Set([
          ...(e.recovery?.interveningFileIds ?? []),
          ...(p.file?.interveningFileIds ?? []),
          ...(p.interveningFileIds ?? [])
        ])
      ]
    };
  e.status = status;
  e.error = error;
}
/** Rebase only mutable fields onto a fresh source document. Protected metadata never
 * comes from a submitted resolution or a direct working-file edit.
 * @param {any} remote @param {any} chosen @param {any} c */
function rebase(remote, chosen, c) {
  if (remote.kind !== chosen.kind || canonical(remote.binding) !== canonical(chosen.binding))
    throw Error('Attio resolution binding changed');
  const next = structuredClone(remote);
  if (next.kind === 'note') {
    next.title = chosen.title;
    next.text = chosen.text;
  } else
    for (const a of next.attributes)
      if (a.writable && Object.hasOwn(chosen.values, a.id))
        next.values[a.id] = structuredClone(chosen.values[a.id]);
  return validateEdit(remote, next, c.config.resources).document;
}
/** Complete history remains a write fence after an upload is verified. Checking
 * only the current head loses a B version archived between persisted phases.
 * @param {any} pending @param {any} current */
function sameWorking(pending, current) {
  const known = new Set(pending.workHistory ?? []),
    deleted = new Set(pending.workDeleted ?? []);
  const intervening = (current?.versions ?? []).filter(
    (/** @type {any} */ v) =>
      !(v.state === 'deleted' && v.uploaded_at === null) &&
      (!known.has(v.id) || (v.state === 'deleted' && !deleted.has(v.id)))
  );
  if (intervening.length)
    pending.interveningFileIds = [
      ...new Set([
        ...(pending.interveningFileIds ?? []),
        ...intervening.map((/** @type {any} */ v) => v.id)
      ])
    ];
  if (current && current.id !== pending.workFileId)
    pending.interveningFileIds = [...new Set([...(pending.interveningFileIds ?? []), current.id])];
  return (
    current &&
    current.id === pending.workFileId &&
    current.content === encodeDocument(pending.document) &&
    !intervening.length
  );
}

/** One durable, bounded phase. The native controller publishes returned state before
 * another invocation. All accepted bodies remain encrypted until verified convergence.
 * @param {any} state @param {any} c @param {{crypto:any,client:any,provider:(c:any)=>Promise<any>,api?:any}} dependencies */
export async function advanceAttioSync(state, c, { crypto, client, provider, api = attioAPI }) {
  const store = nativeStore(state),
    m = await loadManifest(store, c, crypto);
  const deadline = Date.now() + 25000;
  let delay = 1000,
    active = true,
    credential;
  const p = m.pending;
  /** @param {boolean} keep */
  async function persist(keep = active) {
    c.twoWayStatus = {
      folder: folder(c),
      mapped: m.counts.records + m.counts.notes,
      phase: m.pending?.phase ?? (m.indexPending ? 'index' : m.cursor.mode),
      index: indexStatus(m, c),
      lastCycle: m.lastCycle,
      warnings: m.warnings
    };
    await saveManifest(store, c, m, crypto);
    state.active = keep
      ? { connectionId: c.id, generation: c.generation, phase: 'attio-two-way' }
      : null;
    if (!keep) c.nextDue = Date.now() + delay;
    return state;
  }
  /** Finish the selected item, retaining its cursor independently of queued work.
   * @param {any} pending */
  function done(pending) {
    if (!pending.fromQueue) {
      if (pending.kind === 'record') {
        if (c.config.attio.includeNotes) {
          const previous = m.noteRetries?.[pending.resourceId];
          if (previous?.retryAt > Date.now()) {
            m.cursor.record++;
            m.cursor.mode = 'record';
            m.cursor.notes = null;
            m.pending = null;
            m.activeBucket = null;
            return;
          }
          m.cursor.mode = 'notes';
          m.cursor.notes = {
            resourceId: pending.resourceId,
            cursor: previous?.cursor ?? null,
            items: [],
            offset: 0,
            nextCursor: null,
            loaded: false,
            seen: []
          };
        } else m.cursor.record++;
      } else if (m.cursor.notes) m.cursor.notes.offset++;
    }
    m.pending = null;
    m.activeBucket = null;
  }
  /** Seal one bucket and release its plaintext before publishing the encrypted blob.
   * @param {any} pending */
  async function sealBucket(pending) {
    const b = m.activeBucket,
      packed = bucketEnvelope(store, c, b, crypto),
      old = m.buckets[b.prefix];
    if (old?.semanticHash === packed.semanticHash) {
      done(pending);
      return;
    }
    const path = `${folder(c)}/.state/${b.prefix}.json`,
      current = (await client.fileState(path, { maxBytes: 192 * 1024 })).file;
    m.pending = {
      entryId: pending.entryId,
      kind: pending.kind,
      resourceId: pending.resourceId,
      fromQueue: pending.fromQueue,
      phase: 'bucket-file',
      prefix: b.prefix,
      semanticHash: packed.semanticHash,
      file: fileIntent(path, packed.content, current, 192 * 1024)
    };
    m.activeBucket = null;
  }
  /** @param {any} pending */
  async function hold(pending) {
    pending.phase = 'seal';
  }
  /** Only an immutable file reference is needed to resume a destination outage;
   * the accepted editor body remains independently retained in encrypted recovery.
   * @param {any} pending @param {any} e */
  function deferDelivery(pending, e) {
    e.deliveryResume = {
      file: { fileId: pending.workFileId, hash: contentHash(encodeDocument(pending.document)) },
      workHistory: pending.workHistory,
      workDeleted: pending.workDeleted,
      sourceHash: pending.sourceHash,
      timestamp: pending.output.record.start_time,
      recordReceipt: pending.recordReceipt
    };
    retain(
      e,
      pending,
      'delivery_pending',
      'Optional v1 delivery is not verified; accepted text is retained while other selected records continue.'
    );
    pending.phase = 'seal';
  }
  /** @param {any} pending @param {any} e @param {any} remote @param {any} own */
  function conflict(pending, e, remote, own) {
    const provider = providerHash(remote),
      ownHash = contentHash(encodeDocument(own));
    if (
      e.conflict?.expectedProvider === provider &&
      e.conflict.expectedRevision === (pending.currentFileId ?? null) &&
      e.conflict.paths?.some((/** @type {any} */ v) => v.view === 'fulcra' && v.hash === ownHash)
    ) {
      retain(
        e,
        { ...pending, accepted: pending.accepted ?? own },
        'conflict',
        'Concurrent versions require a fresh reviewed choice.'
      );
      pending.phase = 'seal';
      return;
    }
    const id = randomUUID();
    retain(
      e,
      { ...pending, accepted: pending.accepted ?? own },
      'conflict_pending',
      'Concurrent versions require a fresh reviewed choice.'
    );
    pending.accepted ??= own;
    pending.phase = 'conflict-file';
    pending.conflictId = id;
    pending.snapshots = [
      { view: 'provider', document: remote },
      { view: 'fulcra', document: own }
    ];
    pending.snapshotIndex = 0;
    pending.paths = [];
    delete pending.file;
    pending.expectedProvider = provider;
    pending.expectedRevision = pending.currentFileId ?? null;
  }
  /** @param {any} pending @param {any} e @param {any} document @param {any} current @param {string} after */
  function publishWorking(pending, e, document, current, after) {
    pending.document = document;
    pending.afterFile = after;
    const content = encodeDocument(document);
    if (current && current.content === content) {
      pending.workFileId = current.id;
      pending.workHistory = (current.versions ?? []).map((/** @type {any} */ v) => v.id);
      pending.workDeleted = (current.versions ?? [])
        .filter((/** @type {any} */ v) => v.state === 'deleted')
        .map((/** @type {any} */ v) => v.id);
      pending.phase = after;
      delete pending.file;
    } else {
      pending.file = fileIntent(workingPath(c, e), content, current);
      pending.phase = 'working-file';
    }
  }
  /** Retain all IDs when an external version races any accepted handoff.
   * @param {any} pending @param {any} e */
  async function changed(pending, e) {
    retain(
      e,
      pending,
      'recovery_pending',
      'The working-file history changed; accepted text and intervening versions are retained for review.'
    );
    pending.phase = 'seal';
  }
  try {
    if (
      (m.retryAt ?? 0) > Date.now() &&
      !['seal', 'bucket-file', 'conflict-file'].includes(p?.phase)
    ) {
      delay = m.retryAt - Date.now();
      return persist(false);
    }
    if (!p) {
      // Queued edits always preempt navigation/index work.
      if (m.queue.length) {
        const q = m.queue[0];
        m.pending = {
          entryId: q.id,
          prefix: bucketId(q.id),
          phase: 'load',
          accepted: q.document,
          expectedRevision: q.expectedRevision,
          operationId: q.operationId ?? randomUUID(),
          resolution: q.resolution,
          fromQueue: true
        };
        m.queue.shift();
        return persist();
      }
      if (m.cycleComplete) {
        if (
          (m.indexRetryAt ?? 0) <= Date.now() &&
          (m.indexPending || m.indexQueue?.length || m.index?.state !== 'current')
        ) {
          await advanceIndex(m, c, client, store, crypto);
          if (m.index?.state === 'retry') {
            m.indexRetryAt = Date.now() + 30000;
            m.cycleComplete = false;
            m.cursor = { record: 0, mode: 'record', notes: null };
            return persist(false);
          }
          if (m.indexPending || m.indexQueue?.length) return persist();
        }
        m.cycleComplete = false;
        m.cursor = { record: 0, mode: 'record', notes: null };
        delay = c.config.intervalSeconds * 1000;
        return persist(false);
      }
      if (m.cursor.record >= c.config.resources.length) {
        m.cycleComplete = true;
        m.lastCycle = new Date().toISOString();
        return persist();
      }
      const resourceId = c.config.resources[m.cursor.record];
      if (m.cursor.mode === 'notes') {
        const scan = m.cursor.notes;
        if (scan.offset < scan.items.length) {
          const note = scan.items[scan.offset],
            id = localId(c, 'note', note.noteId);
          if (m.ownedNotes[note.noteId]) {
            scan.offset++;
            return persist();
          }
          m.pending = {
            entryId: id,
            prefix: bucketId(id),
            resourceId,
            kind: 'note',
            sourceNoteId: note.noteId,
            createdAt: note.createdAt,
            phase: 'load'
          };
          return persist();
        }
        if (scan.loaded && !scan.nextCursor) {
          m.cursor.mode = 'record';
          m.cursor.notes = null;
          m.cursor.record++;
          return persist();
        }
        credential = await provider(c);
        const cursor = scan.loaded ? scan.nextCursor : scan.cursor,
          page = await api.listNotes(resourceId, credential, c.account_id, cursor, deadline);
        if (
          !Array.isArray(page.notes) ||
          page.notes.length > 25 ||
          (page.nextCursor && (page.nextCursor === cursor || scan.seen.includes(page.nextCursor)))
        )
          throw Error('Attio note pagination repeated or exceeded bounds');
        if (scan.seen.length > 100) throw Error('Attio note pagination capacity reached');
        if (cursor) scan.seen.push(cursor);
        scan.items = [];
        for (const note of page.notes) {
          assertBinding({ resourceId }, c, note.binding, note.binding?.noteId);
          if (m.ownedNotes[note.binding.noteId]) continue;
          scan.items.push({ noteId: note.binding.noteId, createdAt: note.createdAt });
        }
        scan.offset = 0;
        scan.loaded = true;
        scan.nextCursor = page.nextCursor;
        if (m.noteRetries) delete m.noteRetries[resourceId];
        return persist();
      }
      const id = localId(c, 'record', resourceId);
      m.pending = { entryId: id, prefix: bucketId(id), resourceId, kind: 'record', phase: 'load' };
      return persist();
    }
    if (p.phase === 'bucket-file') {
      const result = await advanceFile(p.file, client);
      if (result === 'changed') {
        p.phase = 'bucket-blocked';
        m.warnings = [
          ...new Set([
            ...m.warnings,
            'Encrypted state bucket changed externally; retained publication requires inspection.'
          ])
        ].slice(-10);
        return persist(false);
      }
      if (result === 'verified') {
        m.buckets[p.prefix] = {
          fileId: p.file.file.id,
          hash: p.file.file.hash,
          semanticHash: p.semanticHash
        };
        queueIndex(m, p.prefix);
        done(p);
      }
      return persist();
    }
    if (p.phase === 'bucket-blocked') {
      delay = 30000;
      return persist(false);
    }
    if (p.phase === 'load') {
      m.activeBucket = await loadBucket(m, p.prefix, client, store, c, crypto);
      let e = m.activeBucket.entries[p.entryId];
      if (!e) {
        if (p.fromQueue) throw Error('Accepted Attio edit mapping is unavailable');
        if (
          p.kind === 'note' &&
          c.config.backfillSince &&
          (!p.createdAt ||
            !Number.isFinite(Date.parse(p.createdAt)) ||
            Date.parse(p.createdAt) < Date.parse(c.config.backfillSince))
        ) {
          done(p);
          return persist();
        }
        if (
          m.counts[p.kind === 'note' ? 'notes' : 'records'] >= 1000 ||
          Object.keys(m.activeBucket.entries).length >= 64
        ) {
          m.warnings = [
            ...new Set([...m.warnings, 'Attio mapping capacity reached; new sources are unmapped.'])
          ].slice(-10);
          done(p);
          return persist(false);
        }
        const [objectId, recordId] = p.resourceId.split(':');
        e = {
          id: p.entryId,
          kind: p.kind,
          resourceId: p.resourceId,
          binding: {
            workspaceId: c.account_id,
            objectId,
            recordId,
            ...(p.kind === 'note' ? { noteId: p.sourceNoteId } : {})
          },
          title: '',
          sourceUrl: '',
          status: 'pending',
          fileId: null,
          baseline: null
        };
        m.activeBucket.entries[e.id] = e;
        m.counts[p.kind === 'note' ? 'notes' : 'records']++;
      }
      allowed(e, c);
      p.kind = e.kind;
      p.resourceId = e.resourceId;
      if (e.deliveryResume && !p.fromQueue) {
        p.accepted = e.recovery?.document ?? null;
        p.deliveryResume = e.deliveryResume;
        p.phase = 'resume-delivery';
        return persist();
      }
      if (!p.accepted && e.recovery?.document) {
        p.accepted = e.recovery.document;
        p.operationId = e.recovery.operationId;
        p.recovering = true;
        if (e.recovery.creationAttempted) {
          p.revision = e.recovery.revision;
          p.attemptGuard = e.recovery.attemptGuard;
          p.creationAttempted = true;
          p.recoveringCreate = true;
          p.document = e.recovery.noteResume?.document ?? p.accepted;
          p.workFileId = e.recovery.noteResume?.workFileId;
          p.workHistory = e.recovery.noteResume?.workHistory;
          p.workDeleted = e.recovery.noteResume?.workDeleted;
          p.attemptSourceHash = e.recovery.noteResume?.sourceHash;
        }
      }
      p.phase = 'remote';
      return persist();
    }
    const e = m.activeBucket?.entries[p.entryId];
    if (!e) throw Error('Attio active mapping is unavailable');
    allowed(e, c);
    if (p.phase === 'seal') {
      await sealBucket(p);
      return persist();
    }
    if (p.phase === 'resume-delivery') {
      const resumed = p.deliveryResume,
        bytes = await client.readFileBytes(resumed.file.fileId, 64 * 1024);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (contentHash(text) !== resumed.file.hash)
        throw Error('Attio retained delivery evidence changed');
      p.document = decodeDocument(text);
      p.workFileId = resumed.file.fileId;
      p.workHistory = resumed.workHistory;
      p.workDeleted = resumed.workDeleted;
      p.sourceHash = resumed.sourceHash;
      const current = (await client.fileState(workingPath(c, e))).file;
      if (!sameWorking(p, current)) {
        delete e.deliveryResume;
        await changed(p, e);
        return persist();
      }
      p.output = prepareOutput(
        c,
        {
          id: e.kind === 'note' ? e.binding.noteId : e.resourceId,
          version: providerHash(p.document),
          timestamp: resumed.timestamp,
          payload: p.document,
          files: []
        },
        state.ownerId
      );
      p.phase = 'record-prepare';
      return persist();
    }
    if (p.phase === 'remote') {
      credential = await provider(c);
      const observation = await readRemoteObservation(e, c, credential, { api, deadline });
      p.remote = observation.document;
      p.sourceHash = observation.sourceHash;
      p.branchChanged = observation.branchChanged;
      if (e.kind === 'note' && !e.sourceSnapshot) {
        const content = encodeDocument(observation.source),
          path = `${folder(c)}/.sources/${e.id}/${contentHash(content)}.json`,
          current = (await client.fileState(path)).file;
        p.sourceDocument = observation.source;
        if (current?.content === content) {
          e.sourceSnapshot = { fileId: current.id, hash: contentHash(content), path };
          p.phase = 'local';
        } else {
          p.file = fileIntent(path, content, current);
          p.phase = 'source-file';
        }
      } else p.phase = p.recoveringCreate ? 'note-recover' : 'local';
      return persist();
    }
    if (p.phase === 'source-file') {
      const result = await advanceFile(p.file, client);
      if (result === 'changed') throw Error('Immutable source-note snapshot changed');
      if (result === 'verified') {
        e.sourceSnapshot = { fileId: p.file.file.id, hash: p.file.file.hash, path: p.file.path };
        delete p.file;
        delete p.sourceDocument;
        p.phase = 'local';
      }
      return persist();
    }
    if (p.phase === 'local') {
      const current = (await client.fileState(workingPath(c, e))).file;
      p.currentFileId = current?.id ?? null;
      let local = current ? decodeDocument(current.content) : null;
      if (local) {
        allowed({ ...e, binding: local.binding }, c);
        if (local.kind !== e.kind) throw Error('Attio working document kind changed');
      }
      if (p.accepted) {
        if (!current || (p.fromQueue && p.expectedRevision !== current.id)) {
          if (current)
            p.interveningFileIds = [...new Set([...(p.interveningFileIds ?? []), current.id])];
          retain(
            e,
            p,
            'recovery_pending',
            'Accepted edit retained; its working-file revision changed or is missing.'
          );
          await hold(p);
          return persist();
        }
        if (!p.recovering && !p.resolution) validateEdit(local, p.accepted, c.config.resources);
        local = p.accepted;
      }
      const resolutionValid =
        p.resolution &&
        e.conflict?.id === p.resolution.conflictId &&
        p.resolution.expectedProvider === providerHash(p.remote) &&
        p.expectedRevision === current?.id;
      let baseline = e.baseline;
      if (resolutionValid) {
        local = rebase(p.remote, p.accepted, c);
        baseline = baselineFor(p.remote);
        p.accepted = local;
        p.recovering = false;
      } else if (p.resolution || p.recovering || p.branchChanged) {
        conflict(p, e, p.remote, local ?? p.remote);
        return persist();
      }
      const plan = reconcile({ baseline, local, remote: p.remote });
      if (['conflict', 'schema_conflict'].includes(plan.kind)) {
        conflict(p, e, p.remote, local ?? plan.document);
        return persist();
      }
      if (plan.kind === 'missing') {
        retain(e, p, 'local_missing', 'Working copy missing; no source deletion is authorized.');
        await hold(p);
        return persist();
      }
      p.document = plan.document;
      p.changedIds = plan.changedIds;
      p.accepted ??= plan.kind === 'push' ? local : null;
      if (plan.kind === 'push') {
        p.operationId ??= randomUUID();
        publishWorking(p, e, plan.document, current, 'provider-guard');
      } else publishWorking(p, e, plan.document, current, 'delivery');
      e.status = 'pending';
      return persist();
    }
    if (p.phase === 'working-file') {
      const result = await advanceFile(p.file, client);
      if (result === 'changed') await changed(p, e);
      if (result === 'verified') {
        p.workFileId = p.file.file.id;
        p.workHistory = [...p.file.history, p.workFileId];
        p.workDeleted = p.file.deleted;
        delete p.file;
        p.phase = p.afterFile;
      }
      return persist();
    }
    if (p.phase === 'provider-guard' || p.phase === 'provider-attempt') {
      credential = await provider(c);
      const current = (await client.fileState(workingPath(c, e))).file;
      if (!sameWorking(p, current)) {
        await changed(p, e);
        return persist();
      }
      const fresh = await readRemoteObservation(e, c, credential, { api, deadline });
      if (desiredRemote(p.document, fresh.document) && !fresh.branchChanged) {
        p.beforeCanonicalDocument = p.document;
        p.document = fresh.document;
        p.remote = fresh.document;
        p.sourceHash = fresh.sourceHash;
        p.phase = 'canonical';
        return persist();
      }
      if (
        providerHash(fresh.document) !== providerHash(p.remote) ||
        (fresh.branchChanged && !p.resolution)
      ) {
        p.currentFileId = current.id;
        conflict(p, e, fresh.document, p.accepted ?? p.document);
        return persist();
      }
      validateEdit(fresh.document, p.document, c.config.resources);
      if (p.phase === 'provider-guard') {
        if (e.kind === 'note') {
          p.revision = prepareRevision(c, e, p.document, p.operationId, randomUUID());
          const path = `${folder(c)}/.attempts/${p.operationId}.json`,
            content = canonical({ ...p.revision.marker, accepted: p.accepted }) + '\n',
            old = (await client.fileState(path)).file;
          if (old) {
            p.creationAttempted = true;
            p.phase = 'note-recover';
          } else {
            p.file = fileIntent(path, content, null);
            p.phase = 'note-guard-file';
          }
        } else p.phase = 'provider-attempt';
        return persist();
      }
      // This intent was persisted before the PUT. After a crash we first reread
      // current source above; applied desired values converge, third values conflict.
      try {
        await api.writeRecord(
          e.resourceId,
          encodeValues(p.document, p.changedIds),
          credential,
          c.account_id,
          deadline
        );
      } catch {
        p.writeUncertain = true;
      }
      p.phase = 'provider-readback';
      return persist();
    }
    if (p.phase === 'provider-readback') {
      credential = await provider(c);
      const current = (await client.fileState(workingPath(c, e))).file;
      if (!sameWorking(p, current)) {
        await changed(p, e);
        return persist();
      }
      p.currentFileId = current.id;
      const fresh = await readRemoteObservation(e, c, credential, { api, deadline });
      if (!desiredRemote(p.document, fresh.document)) {
        conflict(p, e, fresh.document, p.accepted ?? p.document);
        return persist();
      }
      p.beforeCanonicalDocument = p.document;
      p.document = fresh.document;
      p.remote = fresh.document;
      p.sourceHash = fresh.sourceHash;
      p.phase = 'canonical';
      return persist();
    }
    if (p.phase === 'note-guard-file') {
      // Recheck accepted bytes throughout guard publication, including immediately
      // after the durable attempt file has been read back and before any POST.
      const current = (await client.fileState(workingPath(c, e))).file;
      if (!sameWorking(p, current)) {
        await changed(p, e);
        return persist();
      }
      if (p.file.phase === 'transfer') {
        const existing = (await client.fileState(p.file.path)).file;
        if (existing) {
          p.creationAttempted = true;
          p.phase = 'note-recover';
          return persist();
        }
        credential = await provider(c);
        const before = await readRemoteObservation(e, c, credential, { api, deadline });
        if (providerHash(before.document) !== providerHash(p.remote)) {
          conflict(p, e, before.document, p.accepted);
          return persist();
        }
        // The allocation was durably saved in a previous native step. Publishing
        // this external guard is the irreversible may-have-attempted boundary:
        // after a crash its presence permits recovery, never a second POST.
        let result;
        try {
          result = await advanceFile(p.file, client);
        } catch {
          p.creationAttempted = true;
          p.phase = 'note-recover';
          delay = 60000;
          return persist(false);
        }
        if (result === 'changed') {
          p.creationAttempted = true;
          p.phase = 'note-recover';
          return persist();
        }
        const guard = await client.fileState(p.file.path);
        if (guard.file?.id !== p.file.receipt.inputId || guard.file.content !== p.file.content)
          throw Error('Attio note attempt guard readback unavailable');
        p.attemptGuard = {
          fileId: guard.file.id,
          hash: contentHash(guard.file.content),
          path: p.file.path
        };
        p.creationAttempted = true;
        const working = (await client.fileState(workingPath(c, e))).file;
        if (!sameWorking(p, working)) {
          await changed(p, e);
          return persist();
        }
        const after = await readRemoteObservation(e, c, credential, { api, deadline });
        if (providerHash(after.document) !== providerHash(p.remote)) {
          conflict(p, e, after.document, p.accepted);
          return persist();
        }
        p.phase = 'note-recover';
        try {
          const created = await api.createNote(
            e.resourceId,
            { title: p.revision.title, markdown: p.revision.markdown },
            credential,
            c.account_id,
            deadline
          );
          assertBinding(e, c, created.binding, created.binding?.noteId);
          p.createdNoteId = created.binding.noteId;
          if (m.ownedNotes[p.createdNoteId] && m.ownedNotes[p.createdNoteId] !== e.id)
            throw Error('Attio revision lineage collision');
          m.ownedNotes[p.createdNoteId] = e.id;
          p.phase = 'note-readback';
        } catch {
          /* The external guard remains the durable evidence of uncertainty. */
        }
        delete p.file;
        return persist();
      }
      const result = await advanceFile(p.file, client);
      if (result === 'changed') {
        p.creationAttempted = true;
        p.phase = 'note-recover';
      }
      if (result === 'verified') {
        p.creationAttempted = true;
        p.phase = 'note-recover';
      }
      return persist();
    }
    if (p.phase === 'note-recover') {
      credential = await provider(c);
      const page = await api.listNotes(
        e.resourceId,
        credential,
        c.account_id,
        p.recoveryCursor ?? null,
        deadline
      );
      p.recoveryMatches ??= [];
      p.recoverySeen ??= [];
      if (
        !Array.isArray(page.notes) ||
        page.notes.length > 25 ||
        (page.nextCursor &&
          (page.nextCursor === p.recoveryCursor || p.recoverySeen.includes(page.nextCursor)))
      )
        throw Error('Attio note recovery pagination invalid');
      for (const note of page.notes) {
        assertBinding(e, c, note.binding, note.binding?.noteId);
        if (matchesRevision(note, p.revision)) {
          if (m.ownedNotes[note.binding.noteId] && m.ownedNotes[note.binding.noteId] !== e.id)
            throw Error('Attio revision lineage collision');
          m.ownedNotes[note.binding.noteId] = e.id;
          if (!p.recoveryMatches.includes(note.binding.noteId))
            p.recoveryMatches.push(note.binding.noteId);
        }
      }
      if (page.nextCursor) {
        if (p.recoverySeen.length > 100) throw Error('Attio note recovery capacity reached');
        p.recoverySeen.push(page.nextCursor);
        p.recoveryCursor = page.nextCursor;
        return persist();
      }
      if (p.recoveryMatches.length === 1) {
        p.createdNoteId = p.recoveryMatches[0];
        p.phase = 'note-readback';
      } else {
        retain(
          e,
          p,
          'creation_uncertain',
          'Note creation may have been attempted. Inspect the selected parent and recover one exact operation marker; do not retry creation.'
        );
        p.phase = 'seal';
      }
      return persist();
    }
    if (p.phase === 'note-readback') {
      credential = await provider(c);
      const note = await api.readNote(
        p.createdNoteId,
        e.resourceId,
        credential,
        c.account_id,
        deadline
      );
      assertBinding(e, c, note.binding, p.createdNoteId);
      const readback = revisionReadback(note, p.revision);
      if (!readback) {
        retain(
          e,
          p,
          'creation_uncertain',
          'Created note readback differs; retain this operation for review.'
        );
        p.phase = 'seal';
        return persist();
      }
      if (m.ownedNotes[p.createdNoteId] && m.ownedNotes[p.createdNoteId] !== e.id)
        throw Error('Attio revision lineage collision');
      // A crash after external guard transfer/POST may precede persistence of its
      // reference. Recover the exact immutable accepted bytes before adoption.
      const guardPath = `${folder(c)}/.attempts/${p.operationId}.json`;
      let guard;
      if (p.attemptGuard) {
        if (p.attemptGuard.path !== guardPath) throw Error('Attio attempt guard scope changed');
        const bytes = await client.readFileBytes(p.attemptGuard.fileId, 64 * 1024),
          content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (contentHash(content) !== p.attemptGuard.hash)
          throw Error('Attio attempt guard changed');
        guard = { id: p.attemptGuard.fileId, content };
      } else guard = (await client.fileState(guardPath)).file;
      if (!guard) throw Error('Attio accepted note evidence unavailable');
      const retained = JSON.parse(guard.content),
        accepted = decodeDocument(JSON.stringify(retained.accepted));
      assertBinding(e, c, accepted.binding, e.binding.noteId);
      if (
        accepted.kind !== 'note' ||
        accepted.headNoteId !== p.revision.marker.previousNoteId ||
        canonical(retained.accepted) !== canonical(p.accepted) ||
        guard.content !== canonical({ ...p.revision.marker, accepted: retained.accepted }) + '\n'
      )
        throw Error('Attio accepted note evidence differs');
      p.attemptGuard = { fileId: guard.id, hash: contentHash(guard.content), path: guardPath };
      m.ownedNotes[p.createdNoteId] = e.id;
      e.headNoteId = p.createdNoteId;
      e.headRevision = {
        marker: p.revision.marker,
        title: p.revision.title,
        footer: readback.footer,
        draftTitle: p.revision.draftTitle,
        serialization: readback.serialization,
        submittedPayloadHash: notePayloadHash(accepted),
        originalPayloadHash: p.revision.marker.payloadHash,
        observedPayloadHash: notePayloadHash(readback),
        acceptedSnapshot: p.attemptGuard
      };
      p.beforeCanonicalDocument = p.document;
      p.document = {
        ...p.document,
        title: readback.title,
        text: readback.text,
        headNoteId: p.createdNoteId
      };
      if (p.attemptSourceHash && p.sourceHash !== p.attemptSourceHash) {
        e.sourceHash = p.attemptSourceHash;
        const fresh = await readRemoteObservation(e, c, credential, { api, deadline });
        p.currentFileId = (await client.fileState(workingPath(c, e))).file?.id ?? null;
        conflict(p, e, fresh.document, p.accepted);
        return persist();
      }
      p.remote = p.document;
      p.phase = 'canonical';
      return persist();
    }
    if (p.phase === 'canonical') {
      const current = (await client.fileState(workingPath(c, e))).file;
      // The note head metadata changes only after created-note GET readback; compare
      // the preceding accepted file for this one canonical rewrite.
      const expected =
        p.beforeCanonicalDocument ??
        (p.document.kind === 'note'
          ? {
              ...p.document,
              headNoteId: p.revision?.marker.previousNoteId ?? p.document.headNoteId
            }
          : p.document);
      const guard = { ...p, document: expected };
      if (!sameWorking(guard, current)) {
        p.interveningFileIds = guard.interveningFileIds;
        await changed(p, e);
        return persist();
      }
      publishWorking(p, e, p.document, current, 'delivery');
      delete p.beforeCanonicalDocument;
      return persist();
    }
    if (p.phase === 'delivery') {
      if (c.config.route.mode !== 'file') {
        p.output = prepareOutput(
          c,
          {
            id: e.kind === 'note' ? e.binding.noteId : e.resourceId,
            version: providerHash(p.document),
            timestamp: e.contentUpdatedAt ?? new Date().toISOString(),
            payload: p.document,
            files: []
          },
          state.ownerId
        );
        p.phase = 'record-prepare';
      } else p.phase = 'commit';
      return persist();
    }
    if (p.phase === 'record-prepare') {
      const route = c.config.route,
        schema = await client.schema(route.recordType);
      validateRoute({ ...route, ownerId: state.ownerId }, await client.catalog(), schema);
      validateOutput(p.output, route, schema);
      const fields = Object.keys(p.output.record).filter(
        (k) => !['sources', 'tags', 'start_time', 'end_time'].includes(k)
      );
      p.recordReceipt = {
        sink: 'record',
        dataType: route.recordType,
        id: p.output.record.id,
        fields,
        hash: hash(Object.fromEntries(fields.map((k) => [k, p.output.record[k]]))),
        status: 'uncertain'
      };
      p.phase = 'record-write';
      return persist();
    }
    if (p.phase === 'record-write') {
      const receipt = p.recordReceipt,
        existing = await client.readRecord(receipt.dataType, receipt.id);
      if (existing) {
        const result = await verify(receipt, { readRecord: async () => existing });
        if (result !== 'verified') throw Error('Attio v1 revision readback differs');
        receipt.status = result;
        p.phase = 'commit';
      } else {
        try {
          const reply = await client.writeRecords(receipt.dataType, [p.output.record]);
          receipt.uploadId = reply.upload_id;
        } catch {
          /* Deterministic ID is reread before another submission. */
        }
        p.phase = 'record-verify';
      }
      return persist();
    }
    if (p.phase === 'record-verify') {
      const result = await verify(p.recordReceipt, client);
      if (result === 'verified') {
        p.recordReceipt.status = result;
        p.phase = 'commit';
      } else {
        deferDelivery(p, e);
        active = false;
        delay = 15000;
      }
      return persist();
    }
    if (p.phase === 'commit') {
      const current = (await client.fileState(workingPath(c, e))).file;
      if (!sameWorking(p, current)) {
        await changed(p, e);
        return persist();
      }
      const next = baselineFor(p.document);
      if (canonical(e.baseline) !== canonical(next) || e.fileId !== current.id)
        e.contentUpdatedAt = new Date().toISOString();
      e.baseline = next;
      e.fileId = current.id;
      e.title = p.document.title;
      e.sourceUrl = p.document.url;
      e.status = 'synced';
      if (e.kind === 'note') {
        e.sourceHash = p.sourceHash;
        e.headNoteId = p.document.headNoteId;
      }
      if (p.recordReceipt) e.recordReceipt = p.recordReceipt;
      delete e.recovery;
      delete e.deliveryResume;
      delete e.conflict;
      delete e.error;
      delete c.lastError;
      delete e.retryAttempts;
      p.phase = 'seal';
      return persist();
    }
    if (p.phase === 'conflict-file') {
      const snapshot = p.snapshots[p.snapshotIndex];
      if (!p.file) {
        const path = `${folder(c)}/.conflicts/${p.conflictId}/${snapshot.view}.json`,
          content = encodeDocument(snapshot.document),
          current = (await client.fileState(path)).file;
        p.file = fileIntent(path, content, current);
        return persist();
      }
      const result = await advanceFile(p.file, client);
      if (result === 'changed') throw Error('Immutable conflict evidence changed');
      if (result === 'verified') {
        p.paths.push({
          view: snapshot.view,
          fileId: p.file.file.id,
          hash: p.file.file.hash,
          path: p.file.path
        });
        delete p.file;
        p.snapshotIndex++;
        if (p.snapshotIndex >= p.snapshots.length) {
          e.conflict = {
            id: p.conflictId,
            expectedProvider: p.expectedProvider,
            expectedRevision: p.expectedRevision,
            paths: p.paths
          };
          e.status = 'conflict';
          p.phase = 'seal';
        }
      }
      return persist();
    }
    throw Error('Unknown Attio persisted phase');
  } catch (cause) {
    const error = /** @type {any} */ (cause),
      e = p && m.activeBucket?.entries[p.entryId];
    const retryTime =
      typeof error?.retryAt === 'string' ? Date.parse(error.retryAt) : error?.retryAt;
    const attempts = (e?.retryAttempts ?? m.retryAttempts ?? 0) + 1;
    const fallback = 60000 * 2 ** Math.min(6, attempts - 1);
    delay = Number.isFinite(retryTime)
      ? Math.max(1000, retryTime - Date.now())
      : Math.round(fallback * (1 + Math.random() * 0.2));
    if (e) e.retryAttempts = attempts;
    if (error?.status === 429) {
      m.retryAttempts = attempts;
      m.retryAt = Date.now() + delay;
    }
    if (!p && m.cursor.mode === 'notes' && m.cursor.notes) {
      const scan = m.cursor.notes;
      m.noteRetries ??= {};
      m.noteRetries[scan.resourceId] = {
        cursor: scan.loaded ? scan.nextCursor : scan.cursor,
        retryAt: Date.now() + delay
      };
      m.cursor.record++;
      m.cursor.mode = 'record';
      m.cursor.notes = null;
      m.warnings = [
        ...new Set([
          ...m.warnings,
          'A selected parent note listing is unavailable; its checkpoint is retained while other records continue.'
        ])
      ].slice(-10);
    }
    c.lastError =
      error?.status === 429
        ? 'attio_rate_limited'
        : error?.status === 404
          ? 'attio_source_unavailable'
          : 'attio_reconciliation_pending';
    if (e && ['record-prepare', 'record-write', 'record-verify'].includes(p.phase))
      deferDelivery(p, e);
    if (
      e &&
      ![
        'seal',
        'conflict-file',
        'record-prepare',
        'record-write',
        'record-verify',
        'commit'
      ].includes(p.phase)
    ) {
      retain(
        e,
        p,
        error?.status === 404 ? 'source_unavailable' : 'recovery_pending',
        'Attio source or working evidence is unavailable or invalid; retained work requires review or restored access.'
      );
      p.phase = 'seal';
    }
    return persist(false);
  }
}
