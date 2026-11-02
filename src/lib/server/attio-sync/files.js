import { contentHash } from '../sync/identity.js';
/** @param {string} path @param {string} content @param {any} before @param {number} maxBytes @returns {any} */
export function fileIntent(path, content, before, maxBytes = 64 * 1024) {
  if (
    !path.startsWith('/') ||
    /[\\\0]/.test(path) ||
    path.split('/').some((x) => x === '..' || x === '.') ||
    Buffer.byteLength(content) > maxBytes
  )
    throw Error('Invalid bounded Attio file intent');
  return {
    path,
    content,
    maxBytes,
    beforeId: before?.id ?? null,
    phase: 'guard',
    history: [],
    deleted: [],
    receipt: null
  };
}
/** One persisted file phase. The caller must retain its accepted candidate until verified convergence.
 * @param {any} p @param {any} client @returns {Promise<'pending'|'changed'|'verified'>} */
export async function advanceFile(p, client) {
  const state = await client.fileState(p.path, { maxBytes: p.maxBytes }),
    current = state.file,
    versions = /** @type {any[]} */ (state.versions);
  const intervening = () => {
    const ids = new Set(p.history),
      deleted = new Set(p.deleted);
    const changed = versions.filter(
      (v) =>
        v.id !== p.receipt?.inputId &&
        !(v.state === 'deleted' && v.uploaded_at === null) &&
        (!ids.has(v.id) || (v.state === 'deleted' && !deleted.has(v.id)))
    );
    if (changed.length) {
      p.interveningFileIds = [
        ...new Set([...(p.interveningFileIds ?? []), ...changed.map((v) => v.id)])
      ];
      p.interveningFileId = changed.find((v) => v.id === current?.id)?.id ?? changed[0].id;
    }
    return changed.length > 0;
  };
  if (p.phase === 'guard') {
    if ((current?.id ?? null) !== p.beforeId) {
      intervening();
      return 'changed';
    }
    p.history = versions.map((v) => v.id);
    p.deleted = versions.filter((v) => v.state === 'deleted').map((v) => v.id);
    p.phase = 'allocate';
    return 'pending';
  }
  if (p.phase === 'allocate') {
    const changed = intervening();
    if ((current?.id ?? null) !== p.beforeId || changed) return 'changed';
    const receipt = await client.allocateFile(p.path, p.content, 'application/json');
    p.receipt = { inputId: receipt.file.id, url: receipt.url };
    p.phase = 'transfer';
    return 'pending';
  }
  const ours = versions.find((v) => v.id === p.receipt.inputId);
  if (ours?.state === 'deleted' || (ours?.state === 'archived' && !current)) return 'changed';
  if (p.phase === 'transfer') {
    if (ours) p.phase = 'verify';
    else {
      const changed = intervening();
      if ((current?.id ?? null) !== p.beforeId || changed) return 'changed';
      await client.transferFile({ url: p.receipt.url }, p.content, 'application/json');
      p.phase = 'verify';
    }
    return 'pending';
  }
  if (intervening() || (current && current.id !== p.receipt.inputId)) return 'changed';
  if (!current || !ours) return (current?.id ?? null) === p.beforeId ? 'pending' : 'changed';
  if (contentHash(current.content) !== contentHash(p.content))
    throw Error('Attio file readback mismatch');
  p.file = { id: current.id, hash: contentHash(p.content) };
  return 'verified';
}
