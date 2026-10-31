import { randomUUID } from 'node:crypto';
import { nativeStore } from '../native/state.js';
import { createNotionPages, markerTitle, pageId } from './notion.js';
import { loadManifest, saveManifest, workingFolder } from './state.js';
import {
  encodeDocument,
  decodeDocument,
  documentHash,
  decideSync,
  normalizeDocument
} from './document.js';
import { contentHash } from '../sync/identity.js';
/** @param {any} e */
const filePath = (e) => e.folder + '/' + e.localId + '.md';
/** @param {any} connection @param {any} entry */
function allowed(connection, entry) {
  return entry.origin === 'selected'
    ? connection.config.resources.includes(entry.notionId)
    : entry.parentId === connection.config.twoWay.parentId;
}
/** @param {any} m @param {any} entry */
function finish(m, entry) {
  m.pending = null;
  m.priority = m.priority.filter((/** @type {string} */ id) => id !== entry.localId);
  const ids = Object.keys(m.entries);
  m.index = (ids.indexOf(entry.localId) + 1) % Math.max(1, ids.length);
  if (m.index === 0) {
    m.lastCycle = new Date().toISOString();
    m.scan = 'pages';
  }
}
/** @param {any} m @param {any} entry @param {any} notion @param {any} fulcra */
function conflict(m, entry, notion, fulcra) {
  const id = randomUUID();
  entry.status = 'conflict_pending';
  m.pending = {
    kind: 'conflict',
    entryId: entry.localId,
    id,
    phase: 'start',
    index: 0,
    snapshots: [notion, fulcra],
    paths: [],
    receipt: null
  };
}
/** @param {any} m @param {any} entry @param {any} doc @param {any} file @param {string} purpose @param {any} extra */
function fileIntent(m, entry, doc, file, purpose, extra = {}) {
  if (purpose !== 'conflict-snapshot') entry.status = 'pending';
  m.pending = {
    kind: 'file',
    entryId: entry.localId,
    purpose,
    phase: 'guard',
    path: filePath(entry),
    content: encodeDocument(doc),
    document: doc,
    beforeId: file?.id ?? null,
    beforeVersions: file?.versions?.map((/** @type {any} */ v) => v.id) ?? [],
    receipt: null,
    ...extra
  };
}
/** @param {any} entry @param {any} notion @param {any} fulcra @param {any} file */
function converged(entry, notion, fulcra, file) {
  entry.baseline = { notion: documentHash(notion), fulcra: documentHash(fulcra) };
  entry.fileId = file.id;
  entry.title = fulcra.title;
  entry.archived = fulcra.archived;
  entry.status = 'synced';
  entry.lastVerified = new Date().toISOString();
  delete entry.conflict;
  delete entry.error;
  delete entry.createdPending;
}
/** Advance one bounded persisted phase. The controller publishes the returned state before another call.
 * @param {any} state @param {any} connection @param {any} dependencies */
export async function advanceNotionSync(
  state,
  connection,
  { crypto, client, provider, notion = createNotionPages() }
) {
  const store = nativeStore(state),
    folder = workingFolder(connection);
  const m = await loadManifest(store, connection, crypto);
  for (const e of Object.values(m.entries)) /** @type {any} */ (e).folder = folder;
  let keepActive = false;
  /** @param {any} p */
  async function writePhase(p) {
    const latest = await client.latestFile(p.path);
    if (p.phase === 'guard') {
      if ((latest?.id ?? null) !== p.beforeId) return 'changed';
      p.phase = 'allocate';
      return 'pending';
    }
    if (p.phase === 'allocate') {
      // Guard again after the durable intent, immediately before allocating a new version.
      if ((latest?.id ?? null) !== p.beforeId) return 'changed';
      const upload = await client.allocateFile(p.path, p.content, 'text/markdown');
      p.receipt = { inputId: upload.file.id, transfer: { url: upload.url } };
      p.phase = 'transfer';
      return 'pending';
    }
    if (p.phase === 'transfer') {
      if (latest?.versions?.some((/** @type {any} */ v) => v.id === p.receipt.inputId))
        p.phase = 'verify';
      else {
        await client.transferFile(p.receipt.transfer, p.content, 'text/markdown');
        p.phase = 'verify';
      }
      return 'pending';
    }
    if (!latest || !latest.versions?.some((/** @type {any} */ v) => v.id === p.receipt.inputId))
      return 'pending';
    const known = new Set(p.beforeVersions);
    if (
      latest.versions.some((/** @type {any} */ v) => v.id !== p.receipt.inputId && !known.has(v.id))
    )
      return 'changed';
    if (latest.id !== p.receipt.inputId || contentHash(latest.content) !== contentHash(p.content))
      return 'changed';
    p.file = latest;
    return 'verified';
  }
  try {
    const credential = await provider(connection);
    let p = m.pending,
      entry = p ? m.entries[p.entryId] : null;
    if (entry && !allowed(connection, entry)) throw Error('Two-way scope configuration mismatch');
    if (p?.kind === 'file') {
      const result = await writePhase(p);
      if (result === 'changed') {
        if (p.purpose === 'conflict-snapshot')
          throw Error('Conflict evidence changed; inspect working files');
        const local = await client.latestFile(filePath(entry));
        const remote = entry.notionId ? await notion.read(entry.notionId, credential) : null;
        if (remote?.supported && local)
          conflict(m, entry, remote.document, decodeDocument(local.content));
        else {
          entry.status = 'edit_stale';
          entry.error = 'Working file changed before delivery';
          finish(m, entry);
        }
      } else if (result === 'verified') {
        if (p.purpose === 'edit') {
          entry.fileId = p.file.id;
          entry.status = 'pending';
          delete m.queue[entry.localId];
          m.pending = null;
          m.priority.unshift(entry.localId);
        } else if (p.purpose === 'conflict-snapshot') {
          m.pending = p.continuation;
          m.pending.paths.push({ path: p.path, hash: contentHash(p.content) });
          m.pending.index++;
        } else {
          converged(entry, p.notionDocument ?? p.document, p.document, p.file);
          connection.lastDelivery = entry.lastVerified;
          connection.lastVerified = entry.lastVerified;
          finish(m, entry);
        }
      }
      keepActive = !!m.pending;
    } else if (p?.kind === 'conflict') {
      if (p.index < 2) {
        fileIntent(m, entry, p.snapshots[p.index], null, 'conflict-snapshot', {
          path: `${folder}/.conflicts/${p.id}/${p.index === 0 ? 'notion' : 'fulcra'}.md`,
          continuation: p
        });
      } else {
        entry.status = 'conflict';
        entry.conflict = { id: p.id, paths: p.paths, detectedAt: new Date().toISOString() };
        finish(m, entry);
      }
      keepActive = !!m.pending;
    } else if (p?.kind === 'create') {
      if (p.phase === 'create') {
        // This separate, retained guard makes a restarted apply recover, never send another POST.
        const guardPath = `${folder}/.sync/create/${entry.localId}.json`;
        const existing = await client.latestFile(guardPath);
        if (existing && JSON.parse(existing.content).attempt === (p.attemptId ?? p.operationId))
          p.phase = 'recover';
        else {
          const guard = JSON.stringify({
            operation: p.operationId,
            attempt: p.attemptId ?? p.operationId,
            localId: entry.localId,
            parentId: entry.parentId
          });
          await client.uploadFile(guardPath, guard, 'application/json');
          const proof = await client.latestFile(guardPath);
          if (!proof || proof.content !== guard) throw Error('Creation guard readback pending');
          p.createCallStarted = true;
          const created = await notion.createMarker(entry.parentId, entry.localId, credential);
          entry.notionId = created.id;
          entry.createdPending = true;
          entry.status = 'pending';
          m.pending = null;
          m.priority.unshift(entry.localId);
        }
      } else {
        const children = await notion.children(entry.parentId, credential, p.cursor ?? null);
        const matches = children.pages.filter(
          (/** @type {any} */ child) => child.title === markerTitle(entry.localId)
        );
        if (matches.length > 1)
          throw Error('Multiple creation recovery markers require inspection');
        if (matches.length) {
          entry.notionId = matches[0].id;
          entry.createdPending = true;
          entry.status = 'pending';
          m.pending = null;
          m.priority.unshift(entry.localId);
        } else {
          p.cursor = children.cursor;
          entry.status = 'creation_uncertain';
          if (!children.cursor) {
            p.cursor = null;
            connection.lastError =
              'Creation outcome uncertain; recovering marker without a duplicate POST';
          }
        }
      }
      keepActive = !!m.pending;
    } else if (p?.kind === 'notion') {
      const file = await client.latestFile(filePath(entry));
      const remote = await notion.read(entry.notionId, credential);
      if (!remote.supported)
        throw Error('Notion Markdown representation is incomplete or unsupported');
      const actual = remote.document,
        desired = p.desired;
      // No later local edit may be mistaken for the version this intent is sending.
      if (!file || documentHash(decodeDocument(file.content)) !== p.sourceHash) {
        if (file) conflict(m, entry, actual, decodeDocument(file.content));
        else {
          entry.status = 'missing';
          finish(m, entry);
        }
      } else {
        const expected = p.expected;
        const same = (/** @type {any} */ a, /** @type {any} */ b) =>
          documentHash(a) === documentHash(b);
        let recognized = same(actual, expected);
        // Reconcile a committed write whose response/step result was lost.
        if (
          !recognized &&
          p.phase === 'title' &&
          same(actual, { ...expected, title: desired.title })
        ) {
          p.expected = { ...expected, title: desired.title };
          recognized = true;
        }
        if (
          !recognized &&
          p.phase === 'body' &&
          same(actual, { ...expected, markdown: desired.markdown })
        ) {
          p.expected = { ...expected, markdown: desired.markdown };
          recognized = true;
        }
        if (
          !recognized &&
          ['restore', 'archive'].includes(p.phase) &&
          same(actual, { ...expected, archived: p.phase === 'archive' ? desired.archived : false })
        ) {
          p.expected = { ...expected, archived: actual.archived };
          recognized = true;
        }
        if (!recognized) conflict(m, entry, actual, decodeDocument(file.content));
        else if (p.phase === 'guard') p.phase = 'restore';
        else if (p.phase === 'restore') {
          if (p.expected.archived && !desired.archived) {
            await notion.setArchived(entry.notionId, false, credential);
            p.expected.archived = false;
          }
          p.phase = 'title';
        } else if (p.phase === 'title') {
          if (p.expected.title !== desired.title) {
            await notion.setTitle(entry.notionId, remote.titleProperty, desired.title, credential);
            p.expected.title = desired.title;
          }
          p.phase = 'body';
        } else if (p.phase === 'body') {
          if (p.expected.markdown !== desired.markdown)
            p.expected.markdown = await notion.setBody(
              entry.notionId,
              p.expected.markdown,
              desired.markdown,
              credential
            );
          p.phase = 'archive';
        } else if (p.phase === 'archive') {
          if (p.expected.archived !== desired.archived) {
            await notion.setArchived(entry.notionId, desired.archived, credential);
            p.expected.archived = desired.archived;
          }
          p.phase = 'verify';
        } else {
          if (same(actual, desired)) {
            converged(entry, actual, decodeDocument(file.content), file);
            connection.lastVerified = entry.lastVerified;
            connection.lastDelivery = entry.lastVerified;
            finish(m, entry);
          } else fileIntent(m, entry, actual, file, 'push-canonical', { notionDocument: actual });
        }
      }
      keepActive = !!m.pending;
    } else if (Object.keys(m.queue).length) {
      const id = Object.keys(m.queue)[0],
        edit = m.queue[id],
        e = m.entries[id];
      const current = await client.latestFile(filePath(e));
      if ((current?.id ?? null) !== edit.expectedRevision) {
        e.status = 'edit_stale';
        e.error = 'A newer Fulcra edit exists; reload before saving';
        delete m.queue[id];
      } else fileIntent(m, e, edit.document, current, 'edit');
      keepActive = !!m.pending;
    } else if (m.scanRequested || m.scan) {
      if (m.scanRequested) {
        m.scan = 'pages';
        m.scanCursor = null;
        m.scanRequested = false;
      }
      if (m.scan === 'pages') {
        const children = await notion.children(
          connection.config.twoWay.parentId,
          credential,
          m.scanCursor
        );
        for (const child of children.pages) {
          if (Object.values(m.entries).some((/** @type {any} */ e) => e.notionId === child.id))
            continue;
          if (Object.keys(m.entries).length >= 50)
            throw Error('Two-way mapped-page capacity reached');
          const localId = pageId(child.id);
          m.entries[localId] = {
            localId,
            notionId: child.id,
            folder,
            parentId: connection.config.twoWay.parentId,
            origin: 'child',
            status: 'pending'
          };
          m.priority.push(localId);
        }
        m.scanCursor = children.cursor;
        if (!children.cursor) m.scan = 'files';
      } else {
        const files = await client.listFiles(folder);
        const latest = new Map();
        for (const f of files.sort(
          (/** @type {any} */ a, /** @type {any} */ b) =>
            Date.parse(b.created_at) - Date.parse(a.created_at)
        ))
          if (!latest.has(f.name)) latest.set(f.name, f);
        for (const [name, f] of latest) {
          if (!/^[a-f0-9-]{36}\.md$/i.test(name)) continue;
          const id = pageId(name.slice(0, -3));
          if (!m.entries[id]) {
            if (Object.keys(m.entries).length >= 50)
              throw Error('Two-way mapped-page capacity reached');
            const body = await client.latestFile(folder + '/' + name);
            decodeDocument(body.content);
            m.entries[id] = {
              localId: id,
              notionId: null,
              folder,
              parentId: connection.config.twoWay.parentId,
              origin: 'local',
              status: 'pending'
            };
            m.priority.push(id);
          } else if (m.entries[id].fileId !== f.id) m.priority.push(id);
        }
        m.scan = null;
        m.priority = [...new Set(m.priority)];
      }
    } else {
      const ids = Object.keys(m.entries),
        id = m.priority[0] ?? ids[m.index % ids.length];
      entry = m.entries[id];
      if (!entry) throw Error('Select a two-way page');
      if (!allowed(connection, entry)) throw Error('Two-way selected scope mismatch');
      const file = await client.latestFile(filePath(entry));
      if (!entry.notionId) {
        if (file) {
          decodeDocument(file.content);
          m.pending = { kind: 'create', entryId: id, operationId: randomUUID(), phase: 'create' };
        } else {
          entry.status = 'missing';
          finish(m, entry);
        }
      } else {
        const remote = await notion.read(entry.notionId, credential);
        if (!remote.supported) {
          entry.status = 'unsupported';
          entry.title = remote.document.title;
          finish(m, entry);
        } else {
          const local = file ? decodeDocument(file.content) : null;
          const resolution = m.resolutions[id];
          let decision = decideSync(entry.baseline ?? null, {
            notion: remote.document,
            fulcra: local
          });
          if (
            entry.createdPending &&
            remote.document.title === markerTitle(entry.localId) &&
            remote.document.markdown === '' &&
            !remote.document.archived &&
            local
          )
            decision = 'push';
          if (entry.status === 'conflict' && decision !== 'converge' && decision !== 'noop')
            decision = 'hold';
          if (resolution) {
            if (
              local &&
              resolution.conflictId === entry.conflict?.id &&
              resolution.notion === documentHash(remote.document) &&
              resolution.fulcra === documentHash(local)
            )
              decision = resolution.choice === 'notion' ? 'pull' : 'push';
            delete m.resolutions[id];
          }
          if (decision === 'pull')
            fileIntent(m, entry, remote.document, file, 'pull', {
              notionDocument: remote.document
            });
          else if (decision === 'push') {
            m.pending = {
              kind: 'notion',
              entryId: id,
              phase: 'guard',
              before: remote.document,
              expected: remote.document,
              desired: local,
              sourceHash: documentHash(local)
            };
            entry.status = 'pending';
          } else if (decision === 'conflict') {
            if (entry.status !== 'conflict') conflict(m, entry, remote.document, local);
            else finish(m, entry);
          } else {
            if (['noop', 'converge'].includes(decision))
              converged(entry, remote.document, local, file);
            else if (decision !== 'hold') entry.status = decision;
            finish(m, entry);
          }
        }
      }
      keepActive = !!m.pending;
    }
    if (!m.pending && !connection.lastError?.startsWith('Creation outcome uncertain'))
      connection.lastError = null;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '';
    const status = /** @type {any} */ (cause)?.status;
    if (m.pending?.kind === 'create' && m.pending.phase === 'create') m.pending.phase = 'recover';
    connection.lastError =
      status === 401 || status === 403
        ? 'Notion authorization required: check Read, Update and Insert Content'
        : /capacity|scope|configuration|Invalid|Choose |bound|metadata|incomplete|unsupported|newer|readback/.test(
              message
            )
          ? message
          : 'Two-way sync retry pending; retained operation will be reconciled';
    if (status === 404 && m.pending?.entryId) {
      m.entries[m.pending.entryId].status = 'inaccessible';
      m.pending = null;
    }
    keepActive = false;
  }
  connection.twoWayStatus = {
    folder,
    mapped: Object.keys(m.entries).length,
    synced: Object.values(m.entries).filter((/** @type {any} */ e) => e.status === 'synced').length,
    conflicts: Object.values(m.entries).filter((/** @type {any} */ e) =>
      e.status.startsWith('conflict')
    ).length,
    phase: m.pending ? m.pending.kind + ':' + m.pending.phase : (m.scan ?? 'scan'),
    lastCycle: m.lastCycle
  };
  await saveManifest(store, connection, m, crypto);
  if (keepActive)
    state.active = {
      connectionId: connection.id,
      generation: connection.generation,
      phase: 'notion-two-way'
    };
  else {
    state.active = null;
    connection.nextDue =
      Date.now() +
      (connection.lastError
        ? 15000
        : m.scan || m.priority.length || m.index
          ? 1000
          : connection.config.intervalSeconds * 1000);
  }
  return state;
}
