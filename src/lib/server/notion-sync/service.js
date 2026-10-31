import { retainArchivedBody } from './archive-body.js';
import { randomUUID } from 'node:crypto';
import { loadManifest, saveManifest, workingFolder } from './state.js';
import { pageId, createNotionPages } from './notion.js';
import { normalizeDocument, decodeDocument, documentHash } from './document.js';
import { contentHash } from '../sync/identity.js';
/** Protected owner operations queue edits; only the persisted worker performs provider writes.
 * @param {any} options */
export function createDocumentService({
  store,
  connection,
  crypto,
  client,
  notion = createNotionPages(),
  credential
}) {
  const folder = () => workingFolder(connection);
  async function manifest() {
    if (!store.supportsTwoWay) throw Error('Two-way sync requires the native Workflow backend');
    if (connection.connector !== 'notion' || !connection.config.twoWay?.enabled)
      throw Error('Enable two-way Notion configuration first');
    return loadManifest(store, connection, crypto);
  }
  /** @param {any} m @param {string} id */
  function selected(m, id) {
    id = pageId(id);
    const e = m.entries[id];
    if (
      !e ||
      (e.origin === 'selected'
        ? !connection.config.resources.includes(e.notionId)
        : e.parentId !== connection.config.twoWay.parentId)
    )
      throw Error('Document is outside the selected connection scope');
    return e;
  }
  /** @param {any} ref */
  async function snapshot(ref) {
    let text;
    if (ref.fileId && client.readFileBytes)
      text = new TextDecoder('utf-8', { fatal: true }).decode(
        await client.readFileBytes(ref.fileId)
      );
    else text = (await client.latestFile(ref.path))?.content;
    if (typeof text !== 'string' || contentHash(text) !== ref.hash)
      throw Error('Conflict evidence changed or is unavailable');
    return decodeDocument(text);
  }
  /** @param {any} m */
  async function save(m) {
    if (Object.keys(m.queue).length > 5)
      throw Error('Two-way edit queue capacity reached; wait for the pending edits');
    await saveManifest(store, connection, m, crypto);
    await store.enqueue(connection.id);
  }
  async function list() {
    const m = await manifest();
    return {
      folder: folder(),
      discoveryWarnings: m.discoveryWarnings ?? [],
      pending: m.pending ? { kind: m.pending.kind, phase: m.pending.phase } : null,
      queued: Object.keys(m.queue).length,
      documents: Object.values(m.entries).map((/** @type {any} */ e) => ({
        id: e.localId,
        notionId: e.notionId,
        title: e.title ?? 'Pending document',
        archived: !!e.archived,
        status: m.queue[e.localId] ? 'queued' : e.status,
        lastVerified: e.lastVerified ?? null,
        conflictId: e.conflict?.id ?? null,
        error: e.error ?? null
      })),
      status: connection.twoWayStatus ?? null
    };
  }
  /** @param {string} id @param {string} view */
  async function read(id, view = 'current') {
    if (!['current', 'notion', 'fulcra'].includes(view)) throw Error('Invalid conflict view');
    const m = await manifest(),
      e = selected(m, id);
    const path = folder() + '/' + e.localId + '.md';
    let file;
    try {
      file = await client.latestFile(path);
    } catch (cause) {
      const invalid =
        /** @type {any} */ (cause)?.code === 'ERR_ENCODING_INVALID_ENCODED_DATA' ||
        (cause instanceof Error && cause.message === 'Working-file content exceeds bound');
      if (!e.recoveryEdit || !invalid) throw cause;
      file = null;
    }
    let document =
      e.recoveryEdit?.document ??
      (file ? decodeDocument(file.content) : m.queue[e.localId]?.document);
    if (!document) throw Error('Document is waiting for its first verified working copy');
    let expectedNotion = null;
    if (e.conflict) {
      const remote = await retainArchivedBody(
        await notion.read(e.notionId, credential),
        e,
        client,
        m.pending
      );
      if (!remote.supported) throw Error('Notion Markdown is incomplete or unsupported');
      expectedNotion = documentHash(remote.document);
      if (view !== 'current')
        document = await snapshot(e.conflict.paths[view === 'notion' ? 0 : 1]);
    } else if (view !== 'current') throw Error('Document has no active conflict');
    return {
      id: e.localId,
      notionId: e.notionId,
      document,
      path,
      revision: file?.id ?? null,
      queued:
        !!m.queue[e.localId] ||
        (!!e.recoveryEdit && !e.conflict) ||
        m.pending?.entryId === e.localId,
      status: m.queue[e.localId] ? 'queued' : e.status,
      conflict: e.conflict ? { id: e.conflict.id, detectedAt: e.conflict.detectedAt } : null,
      expectedNotion
    };
  }
  /** @param {any} input */
  async function mutate(input) {
    const m = await manifest();
    if (connection.status !== 'ready')
      throw Error('Enable the verified two-way connection before editing');
    const fields = /** @type {Record<string,string[]>} */ ({
      create: ['document'],
      save: ['id', 'document', 'expectedRevision'],
      archive: ['id', 'archived', 'expectedRevision'],
      resolve: ['id', 'choice', 'conflictId', 'expectedRevision', 'expectedNotion'],
      sync: ['id']
    });
    if (
      !input ||
      !fields[input.operation] ||
      Object.keys(input).some((k) => !['operation', ...fields[input.operation]].includes(k))
    )
      throw Error('Invalid document action fields');
    if (input.operation === 'create') {
      if (Object.keys(m.entries).length >= 50) throw Error('Two-way mapped-page capacity reached');
      const document = normalizeDocument(input.document),
        id = randomUUID();
      if (document.archived) throw Error('Create an unarchived document first');
      m.entries[id] = {
        localId: id,
        notionId: null,
        parentId: connection.config.twoWay.parentId,
        folder: folder(),
        origin: 'local',
        status: 'pending',
        title: document.title
      };
      m.queue[id] = { document, expectedRevision: null };
      await save(m);
      return { id, queued: true };
    }
    if (input.operation === 'sync') {
      if (input.id) {
        selected(m, input.id);
        m.priority = [
          input.id,
          ...m.priority.filter((/** @type {string} */ id) => id !== input.id)
        ];
      } else m.priority = [...new Set([...m.priority, ...Object.keys(m.entries)])];
      m.scanRequested = true;
      await save(m);
      return { queued: true };
    }
    const e = selected(m, input.id),
      file = await client.latestFile(folder() + '/' + e.localId + '.md');
    if (!file || typeof input.expectedRevision !== 'string' || input.expectedRevision !== file.id)
      throw Error('Document changed: a newer working-file revision exists; reload before saving');
    if (m.pending?.entryId === e.localId)
      throw Error('Document is syncing; wait for it to finish and reload before saving');
    if (e.recoveryEdit && input.operation !== 'resolve')
      throw Error(
        'A saved edit is retained for recovery; sync and review the conflict before editing'
      );
    if (m.queue[e.localId]) throw Error('Document already has a queued edit; wait and reload');
    if (input.operation === 'resolve') {
      if (!['notion', 'fulcra'].includes(input.choice) || input.conflictId !== e.conflict?.id)
        throw Error('Conflict changed; reload both versions before resolving');
      const remote = await retainArchivedBody(
          await notion.read(e.notionId, credential),
          e,
          client,
          m.pending
        ),
        local = decodeDocument(file.content);
      if (!remote.supported || input.expectedNotion !== documentHash(remote.document))
        throw Error('Conflict changed: a newer Notion version exists; reload');
      const expected = e.conflict.expectedCurrent;
      if (
        !expected ||
        expected.notion !== documentHash(remote.document) ||
        expected.fulcra !== documentHash(local)
      )
        throw Error('Conflict changed: sync and reload the current versions');
      const chosen = await snapshot(e.conflict.paths[input.choice === 'notion' ? 0 : 1]);
      if (input.choice === 'fulcra' && documentHash(chosen) !== documentHash(local))
        m.queue[e.localId] = { document: chosen, expectedRevision: file.id };
      m.resolutions[e.localId] = {
        choice: input.choice,
        conflictId: e.conflict.id,
        notion: documentHash(remote.document),
        fulcra: input.choice === 'fulcra' ? documentHash(chosen) : documentHash(local)
      };
      m.priority = [
        e.localId,
        ...m.priority.filter((/** @type {string} */ id) => id !== e.localId)
      ];
    } else {
      if (e.status.startsWith('conflict'))
        throw Error('Resolve the document conflict before editing');
      const document =
        input.operation === 'archive'
          ? normalizeDocument({ ...decodeDocument(file.content), archived: input.archived })
          : normalizeDocument(input.document);
      m.queue[e.localId] = { document, expectedRevision: file.id };
    }
    await save(m);
    return { id: e.localId, queued: true };
  }
  return { list, read, mutate };
}
