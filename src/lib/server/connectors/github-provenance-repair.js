import { canonical, contentHash } from '../sync/identity.js';
import { prepareOutput } from '../sync/runner.js';
import { fileIntent, advanceFile } from '../attio-sync/files.js';
import { renderGitHubDocument, legacyGitHubDocument } from './github-document.js';
/** Trusted record binding is independent of the editable file body.
 * @param {any} c @param {any} record @param {string} ownerId */
export function githubRepairTarget(c, record, ownerId) {
  if (c.connector !== 'github' || c.config.route.ownerId !== ownerId)
    throw Error('GitHub repair owner mismatch');
  const route = c.config.route;
  if (
    !['file', 'both'].includes(route.mode) ||
    typeof route.folder !== 'string' ||
    !route.folder.startsWith('/') ||
    /[\\\0]/.test(route.folder) ||
    route.folder.split('/').some((/** @type {string} */ x) => x === '.' || x === '..')
  )
    throw Error('Invalid repair route');
  const p = record.payload,
    repo = p?.repository;
  if (!c.config.resources.includes(repo)) throw Error('Repair source is not selected');
  const phase = p.kind === 'comment' ? 'comments' : 'issues';
  if (
    !['issue', 'pull_request', 'comment'].includes(p.kind) ||
    record.connector !== 'github' ||
    record.operation !== 'upsert' ||
    !record.sources?.includes('connectors.github') ||
    record.source_id !== `${repo}:${phase}:${p.id}`
  )
    throw Error('Repair record binding mismatch');
  const item = {
    ...p,
    html_url: p.url,
    ...(p.kind === 'pull_request' ? { pull_request: {} } : {})
  };
  const content = renderGitHubDocument(repo, phase, item),
    name = phase === 'comments' ? 'comment.md' : 'issue.md';
  const change = {
    id: record.source_id,
    version: record.source_version,
    timestamp: record.source_version,
    operation: record.operation,
    payload: p,
    files: [{ name, content, contentType: 'text/markdown' }]
  };
  const output = prepareOutput(c, change, ownerId);
  if (output.record.id !== record.id) throw Error('Repair record binding mismatch');
  const path = route.folder.replace(/\/$/, '') + '/' + output.files[0].path;
  return {
    path,
    content,
    legacy: legacyGitHubDocument(item),
    source_id: record.source_id,
    record_id: record.id,
    scope_hash: contentHash(canonical({ ownerId, account: c.account_id, config: c.config }))
  };
}
/** @param {any} c @param {any} record @param {string} ownerId @param {any} before @returns {any} */
export function planGitHubRepair(c, record, ownerId, before) {
  const target = githubRepairTarget(c, record, ownerId);
  if (!before || typeof before.id !== 'string' || !before.id)
    throw Error('Existing repair file required');
  if (before.path && before.path !== target.path) throw Error('Repair path binding mismatch');
  if (before.content === target.content) return { status: 'unchanged', target };
  if (before.content !== target.legacy) throw Error('Legacy copy changed; retain it for review');
  return {
    status: 'ready',
    target,
    intent: { file: fileIntent(target.path, target.content, before, 256 * 1024), previous: [] }
  };
}
/** One retained phase; caller saves after every phase/error before continuing.
 * @param {any} p @param {any} client */
export async function advanceGitHubRepair(p, client) {
  const file = p.file;
  if (p.rejected) {
    const remote = await client.fileState(file.path, { maxBytes: file.maxBytes });
    if (!remote.versions.some((/** @type {any} */ v) => v.id === file.receipt?.inputId)) {
      const known = new Set(file.history),
        deleted = new Set(file.deleted);
      const changed = remote.versions
        .filter(
          (/** @type {any} */ v) =>
            !(v.state === 'deleted' && v.uploaded_at === null) &&
            (!known.has(v.id) || (v.state === 'deleted' && !deleted.has(v.id)))
        )
        .map((/** @type {any} */ v) => v.id);
      const fresh = new Set(remote.versions.map((/** @type {any} */ v) => v.id));
      changed.push(...file.history.filter((/** @type {string} */ id) => !fresh.has(id)));
      if ((remote.file?.id ?? null) !== file.beforeId || changed.length) {
        file.interveningFileIds = [...new Set([...(file.interveningFileIds ?? []), ...changed])];
        file.rejectedReadback = remote.versions;
        return 'changed';
      }
      // Never discard an earlier receipt to make room for another attempt.
      if ((p.previous?.length ?? 0) >= 4)
        throw Error('Repair replacement bound reached; retain all receipts for review');
      p.previous = [
        ...(p.previous ?? []),
        { receipt: file.receipt, history: file.history, deleted: file.deleted }
      ];
      p.file = fileIntent(file.path, file.content, remote.file, file.maxBytes);
      delete p.rejected;
      return 'pending';
    }
  }
  try {
    return await advanceFile(file, {
      fileState: (/** @type {string} */ path, /** @type {any} */ options) =>
        client.fileState(path, options),
      allocateFile: (/** @type {string} */ path, /** @type {string} */ content) =>
        client.allocateFile(path, content, 'text/markdown'),
      transferFile: (/** @type {any} */ upload, /** @type {string} */ content) =>
        client.transferFile(upload, content, 'text/markdown')
    });
  } catch (e) {
    if (
      e instanceof Error &&
      /^File transfer returned (400|401|403|404|410)$/.test(e.message) &&
      file.phase === 'transfer'
    )
      p.rejected = true;
    throw e;
  }
}
