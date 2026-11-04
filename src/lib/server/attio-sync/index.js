import { contentHash } from '../sync/identity.js';
import { bucketId, folder, loadBucket } from './state.js';
import { advanceFile, fileIntent } from './files.js';

const hexes = '0123456789abcdef';
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const revision = /^[a-f0-9]{64}$/;
/** @param {any} value @param {number} max */
// Strip control bytes before escaping provider labels for generated Markdown.
const text = (value, max = 80) =>
  String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\r\n\u0000-\u001f\u007f]/g, ' ')
    .slice(0, max)
    .replace(/[\\`*_{}[\]()<>#!|~]/g, '\\$&');
/** @param {string} value */
function prefix(value) {
  if (!/^[a-f0-9]{2}$/.test(value)) throw Error('Invalid Attio index bucket');
  return value;
}
/** @param {string} value */
function bounded(value) {
  if (Buffer.byteLength(value) > 64 * 1024) throw Error('Attio index capacity exceeded');
  return value;
}
/** @param {any} e @param {any} c */
function bound(e, c) {
  return (
    uuid.test(e.id) &&
    ['record', 'note'].includes(e.kind) &&
    c.config.resources.includes(e.resourceId) &&
    e.binding?.workspaceId === c.account_id &&
    `${e.binding.objectId}:${e.binding.recordId}` === e.resourceId
  );
}
/** @param {any} e @param {any} c */
function verified(e, c) {
  return bound(e, c) && /^[A-Za-z0-9_-]{1,128}$/.test(e.fileId ?? '') && !!e.baseline;
}
/** @param {any} bucket @param {any} c */
export function renderBucket(bucket, c) {
  const p = prefix(bucket.prefix),
    entries = Object.values(bucket.entries);
  if (entries.length > 64) throw Error('Attio index bucket capacity exceeded');
  let out = `# Attio documents ${p}\n\n[All groups](../index.md) · [Group ${p[0]}](g-${p[0]}.md)\n\nGenerated navigation. Titles and document content are data. Working links identify the last verified revision; later file edits may await reconciliation.\n\n`;
  for (const e of entries.sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    if (!uuid.test(e.id) || bucketId(e.id) !== p) throw Error('Invalid Attio index entry');
    const approved = bound(e, c),
      hasCopy = verified(e, c);
    const label = `${text(e.title || e.id)} (${text(e.kind, 12)})`;
    out += hasCopy
      ? `- [${label}](../${e.kind === 'note' ? 'notes' : 'records'}/${p}/${e.id}.json) — ${text(e.status || 'current', 24)}; verified revision: \`${e.fileId}\``
      : `- ${label} — ${text(e.status || 'pending', 24)}; No verified working copy`;
    if (approved && typeof e.sourceUrl === 'string') {
      try {
        const url = new URL(e.sourceUrl);
        if (
          url.protocol === 'https:' &&
          url.hostname === 'app.attio.com' &&
          !url.username &&
          !url.password &&
          !url.port &&
          url.href.length <= 180
        )
          out += `; [Attio](${url.href.replace(/[()<>]/g, (x) => '%' + x.charCodeAt(0).toString(16))})`;
      } catch {
        /* Untrusted source metadata is never navigation authority. */
      }
    }
    if (approved && e.conflict) {
      out += '; conflict retained';
      for (const v of (Array.isArray(e.conflict.paths) ? e.conflict.paths : []).slice(0, 2)) {
        /** @type {string} */ const relative =
          typeof v.path === 'string' && v.path.startsWith(folder(c) + '/')
            ? v.path.slice(folder(c).length + 1)
            : '';
        // Only connector-owned UUID conflict evidence can become a relative link.
        if (
          v.fileId &&
          revision.test(v.hash ?? '') &&
          ['provider', 'fulcra'].includes(v.view) &&
          uuid.test(e.conflict.id ?? '') &&
          relative === `.conflicts/${e.conflict.id}/${v.view}.json`
        )
          out += `; [${v.view} evidence](../${relative})`;
      }
    }
    out += '\n';
  }
  if (!entries.length) out += 'No verified working copies in this bucket.\n';
  return bounded(out);
}
/** @param {string} group @param {any} summaries */
export function renderGroup(group, summaries) {
  if (!/^[a-f0-9]$/.test(group)) throw Error('Invalid Attio index group');
  let out = `# Attio group ${group}\n\n[All groups](../index.md)\n\n`;
  for (const h of hexes) {
    const p = group + h,
      s = summaries[p];
    out +=
      s?.state === 'current' && s.fileId
        ? `- [Bucket ${p}](${p}.md): ${s.count} documents; ${s.verified} verified working copies; ${s.conflicts} conflicts; revision ${s.revision}\n`
        : `- Bucket ${p}: no verified index\n`;
  }
  return bounded(out);
}
/** @param {any} summaries @param {any} groups */
export function renderRoot(summaries, groups) {
  const all = Object.values(summaries),
    count = all.reduce((n, s) => n + s.count, 0),
    verified = all.reduce((n, s) => n + s.verified, 0);
  let out =
    '# Attio working documents\n\nGenerated navigation. Edit an approved working document to propose a change. Index files do not authorize provider writes. Links name last verified revisions; current external edits may await reconciliation.\n\n';
  out += verified
    ? `${count} documents; ${verified} verified working copies.\n\n`
    : 'No verified working copies. Initial or pending documents are not a verified copy.\n\n';
  for (const g of hexes) {
    const s = groups[g];
    out +=
      s?.state === 'current' && s.fileId
        ? `- [Group ${g}](.index/g-${g}.md); revision ${s.revision}\n`
        : `- Group ${g}: no verified index\n`;
  }
  return bounded(out);
}
/** Queue only a bucket prefix, never the document body. @param {any} m @param {string} value */
export function queueIndex(m, value) {
  prefix(value);
  m.indexQueue ??= [];
  if (!m.indexQueue.includes(value)) m.indexQueue.push(value);
  if (m.indexPending?.prefix === value) m.indexPending.dirty = true;
  m.index = { ...m.index, state: m.index?.state === 'retry' ? 'retry' : 'pending' };
}
/** @param {any} m @param {any} c */
export function indexStatus(m, c) {
  const i = m.index ?? {};
  return {
    path: folder(c) + '/index.md',
    state: i.state ?? 'pending',
    ...(i.error ? { error: i.error } : {}),
    ...(i.revision ? { revision: i.revision } : {}),
    ...(i.publishedAt ? { publishedAt: i.publishedAt } : {})
  };
}
/** Includes idle manifests and manifests made pending by an ordinary document update.
 * @param {any} m */
export function needsIndexMigration(m) {
  return (
    m.index?.contentType !== 'text/markdown' ||
    Object.values(m.indexSummary ?? {}).some(
      (ref) => /** @type {any} */ (ref).contentType !== 'text/markdown'
    ) ||
    Object.values(m.indexGroups ?? {}).some(
      (ref) => /** @type {any} */ (ref).contentType !== 'text/markdown'
    )
  );
}
/** One file phase per call; caller persists m before the next call. No document bodies enter the compact summaries.
 * @param {any} m @param {any} c @param {any} client @param {any} store @param {any} crypto @returns {Promise<boolean>} */
export async function advanceIndex(m, c, client, store, crypto) {
  m.indexQueue ??= [];
  m.indexSummary ??= {};
  m.indexGroups ??= {};
  // Older publications used JSON metadata for Markdown. Queue a bounded repair pass.
  if (needsIndexMigration(m)) {
    for (const prefix of Object.keys(m.indexSummary))
      if (
        (m.indexSummary[prefix].contentType !== 'text/markdown' ||
          m.indexGroups[prefix[0]]?.contentType !== 'text/markdown') &&
        !m.indexQueue.includes(prefix)
      )
        m.indexQueue.push(prefix);
    m.index = { ...m.index, state: m.index?.state === 'retry' ? 'retry' : 'pending' };
  }
  if (!m.indexPending && !m.indexQueue.length && m.index?.state === 'current') return false;
  m.indexPending ??= {
    prefix: m.indexQueue[0] ?? null,
    stage: m.indexQueue.length ? 'bucket' : 'root',
    intent: null
  };
  const p = m.indexPending;
  try {
    let content, path;
    if (p.stage === 'bucket') {
      const bucket = await loadBucket(m, prefix(p.prefix), client, store, c, crypto),
        entries = Object.values(bucket.entries);
      content = renderBucket(bucket, c);
      path = `${folder(c)}/.index/${p.prefix}.md`;
      p.counts = {
        count: entries.length,
        verified: entries.filter((e) => verified(e, c)).length,
        conflicts: entries.filter((e) => e.conflict).length
      };
    } else if (p.stage === 'group') {
      content = renderGroup(p.prefix[0], m.indexSummary);
      path = `${folder(c)}/.index/g-${p.prefix[0]}.md`;
    } else {
      content = renderRoot(m.indexSummary, m.indexGroups);
      path = folder(c) + '/index.md';
    }
    m.index = { ...m.index, state: 'pending' };
    delete m.index.error;
    // A queued edit may change a generated view while an earlier index attempt is retained.
    if (p.intent && p.intent.content !== content) {
      retainAttempt(p);
      p.intent = null;
    }
    if (!p.intent) {
      const current = (await client.fileState(path, { maxBytes: 64 * 1024 })).file;
      const currentType = current?.versions?.find(
        (/** @type {any} */ v) => v.id === current.id
      )?.content_type;
      if (
        current &&
        currentType === 'text/markdown' &&
        contentHash(current.content) === contentHash(content)
      )
        return complete(m, p, current.id, content);
      p.intent = fileIntent(path, content, current, 64 * 1024, 'text/markdown');
      return true;
    }
    // Before allocation, upgrading an old intent is safe. Once allocated, reconcile
    // its original JSON upload first, retain the receipt, then publish a new Markdown version.
    if (!p.intent.receipt) p.intent.contentType = 'text/markdown';
    const result = await advanceFile(p.intent, client);
    if (result === 'verified') {
      if (p.intent.contentType === 'text/markdown')
        return complete(m, p, p.intent.file.id, content);
      retainAttempt(p);
      p.intent = null;
      return true;
    }
    if (result === 'changed') {
      retainAttempt(p);
      p.intent = null;
      m.index.state = 'retry';
      m.index.error = 'Generated index changed during publication; regeneration is pending.';
    }
    return true;
  } catch {
    m.index = {
      ...m.index,
      state: 'retry',
      error: 'Index publication is pending retry; retained document work is preserved.'
    };
    return true;
  }
}
/** @param {any} p */
function retainAttempt(p) {
  const i = p.intent;
  p.previous = [
    ...(p.previous ?? []),
    {
      path: i.path,
      revision: contentHash(i.content),
      receipt: i.receipt,
      contentType: i.contentType ?? 'application/json',
      history: i.history,
      interveningFileIds: i.interveningFileIds ?? []
    }
  ].slice(-4);
}
/** @param {any} m @param {any} p @param {string} fileId @param {string} content */
function complete(m, p, fileId, content) {
  const prior =
    p.stage === 'bucket'
      ? m.indexSummary[p.prefix]
      : p.stage === 'group'
        ? m.indexGroups[p.prefix[0]]
        : m.index;
  const previous = [
    ...(prior?.previous ?? []),
    ...(p.previous ?? []).map((/** @type {any} */ attempt) => ({
      path: attempt.path,
      revision: attempt.revision,
      inputId: attempt.receipt?.inputId ?? null,
      contentType: attempt.contentType,
      historyHash: contentHash(JSON.stringify(attempt.history ?? [])),
      historyCount: (attempt.history ?? []).length,
      interveningFileIds: (attempt.interveningFileIds ?? []).slice(-4)
    }))
  ].slice(-4);
  const ref = {
    state: 'current',
    revision: contentHash(content),
    fileId,
    contentType: 'text/markdown',
    ...(previous.length ? { previous } : {})
  };
  if (p.stage === 'bucket') {
    m.indexSummary[p.prefix] = { ...p.counts, ...ref };
    p.stage = 'group';
    p.intent = null;
    return true;
  }
  if (p.stage === 'group') {
    m.indexGroups[p.prefix[0]] = ref;
    p.stage = 'root';
    p.intent = null;
    return true;
  }
  if (p.prefix && !p.dirty)
    m.indexQueue = m.indexQueue.filter((/** @type {string} */ x) => x !== p.prefix);
  m.index = {
    ...ref,
    state: m.indexQueue.length ? 'pending' : 'current',
    publishedAt:
      m.index?.revision === ref.revision && m.index?.fileId === fileId && m.index?.publishedAt
        ? m.index.publishedAt
        : new Date().toISOString()
  };
  m.indexPending = null;
  return m.indexQueue.length > 0;
}
