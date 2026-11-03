import { canonical, contentHash } from './sync/identity.js';
import { unseal } from './secrets.js';
import { scopeHash as notionScope } from './notion-sync/state.js';
import { scopeHash as attioScope } from './attio-sync/state.js';
import { advanceFile, fileIntent } from './attio-sync/files.js';

const schema = 'fulcra.knowledge-sources/1';
const producer = 'fulcra-connectors';
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const fileId = /^[A-Za-z0-9_-]{1,128}$/;
const providers = new Set(['notion', 'attio', 'github', 'slack', 'asana', 'granola', 'garmin']);
const limit = 64 * 1024;
/** @param {any} state */
export function knowledgeSourcesPath(state) {
  if (!uuid.test(state.deploymentId) || !uuid.test(state.ownerId))
    throw Error('Discovery requires a bound instance and owner');
  return `/knowledge-sources/v1/${producer}/${state.deploymentId}.json`;
}
/** @param {any} value */
function path(value) {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\u0000-\u001f\u007f]/.test(value) ||
    /%2e|%2f|%5c/i.test(value) ||
    value.split('/').some((x) => x === '.' || x === '..')
  )
    throw Error('Invalid discovery output path');
  return value.replace(/\/$/, '') || '/';
}
/** @param {any} value */
function time(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
/** @param {any} c */
function scope(c) {
  return contentHash(
    canonical({
      provider: c.connector,
      account: c.account_id,
      resources: [...(c.config.resources ?? [])].sort(),
      route: c.config.route,
      twoWay: c.config.twoWay ?? null,
      attio: c.config.attio ?? null
    })
  );
}
/** @param {any} state @param {any} c @param {any} crypto */
function indexMetadata(state, c, crypto) {
  if (c.connector === 'notion' && c.config.twoWay?.enabled) {
    const saved = state.grants[`notion-sync:${c.id}`];
    if (!saved) return null;
    const m = unseal(
      saved.encrypted,
      `${state.deploymentId}:${state.ownerId}:notion-sync:${c.id}`,
      crypto
    );
    if (m.scopeHash !== notionScope(c)) throw Error('Notion discovery scope changed');
    return {
      index: m.indexStatus,
      conflict: Object.values(m.entries ?? {}).some((e) => /** @type {any} */ (e).conflict)
    };
  }
  if (c.connector === 'attio' && c.config.attio?.twoWay) {
    const saved = state.grants[`attio-sync:${c.id}`];
    if (!saved) return null;
    const m = unseal(
      saved.encrypted,
      `${state.deploymentId}:${state.ownerId}:attio:${c.id}:manifest`,
      crypto
    );
    if (m.scopeHash !== attioScope(c)) throw Error('Attio discovery scope changed');
    return {
      index: m.index,
      conflict: Object.values(m.indexSummary ?? {}).some(
        (e) => /** @type {any} */ (e).conflicts > 0
      )
    };
  }
  return null;
}
/** Strict metadata projection: no source bodies, selected IDs, labels or grants.
 * @param {any} state @param {any} crypto */
export function knowledgeSourcesView(state, crypto) {
  knowledgeSourcesPath(state);
  const connections = /** @type {any[]} */ (Object.values(state.connections));
  if (connections.length > 20) throw Error('Discovery connection capacity exceeded');
  const sources = connections
    .filter((c) => providers.has(c.connector))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => {
      if (!uuid.test(c.id) || typeof c.account_id !== 'string' || c.account_id.length > 200)
        throw Error('Invalid discovery connection identity');
      const route = c.config.route ?? {},
        twoWay =
          (c.connector === 'notion' && c.config.twoWay?.enabled) ||
          (c.connector === 'attio' && c.config.attio?.twoWay);
      /** @type {any} */ const source = {
        provider: c.connector,
        connection_id: c.id,
        provider_account_id: c.account_id,
        workspace_id: null,
        identity_kind: 'account',
        mode: twoWay ? 'two-way' : 'read-only',
        status: 'pending',
        selected_count: (c.config.resources ?? []).length,
        scope_hash: scope(c)
      };
      if (c.connector === 'notion') source.identity_kind = 'integration';
      if (c.connector === 'attio') {
        source.identity_kind = 'workspace';
        source.workspace_id = c.account_id;
      }
      if (c.connector === 'github' && c.account_id.startsWith('installation:'))
        source.identity_kind = 'installation';
      if (c.connector === 'granola') source.identity_kind = 'unknown';
      if (c.connector === 'slack' && /^[A-Z0-9]+:[A-Z0-9]+$/.test(c.account_id))
        source.workspace_id = c.account_id.split(':')[0];
      if (route.mode === 'file' || route.mode === 'both') source.files_path = path(route.folder);
      if (route.mode === 'record' || route.mode === 'both') {
        if (
          typeof route.recordType !== 'string' ||
          route.recordType.length > 200 ||
          !route.recordType.startsWith('Event/')
        )
          throw Error('Invalid discovery v1 record route');
        source.record_type = route.recordType;
      }
      let meta;
      try {
        meta = indexMetadata(state, c, crypto);
      } catch {
        source.status = 'unknown';
      }
      const index = meta?.index;
      if (index?.fileId && fileId.test(index.fileId) && source.files_path && twoWay) {
        const expected = `${source.files_path === '/' ? '' : source.files_path}/live/${c.id}/index.md`;
        if (index.path && index.path !== expected) source.status = 'unknown';
        else {
          source.index_path = expected;
          source.index_revision = index.fileId;
          if (time(index.publishedAt)) source.last_verified_at = time(index.publishedAt);
          source.status = meta?.conflict
            ? 'conflict'
            : index.state === 'current'
              ? 'ready'
              : 'pending';
        }
      } else if (!twoWay && c.lastVerified) source.status = 'ready';
      const retained = state.knowledgeSources?.pointers?.[c.id];
      if (
        !source.index_revision &&
        retained?.scope_hash === source.scope_hash &&
        retained?.index_path &&
        fileId.test(retained.index_revision)
      ) {
        source.index_path = path(retained.index_path);
        source.index_revision = retained.index_revision;
        if (time(retained.last_verified_at))
          source.last_verified_at = time(retained.last_verified_at);
      }
      if (c.lastError) source.status = 'unknown';
      if (['paused', 'disconnected', 'disabled'].includes(c.status)) source.status = 'disabled';
      if (c.status === 'draft') source.status = 'pending';
      return source;
    });
  const view = { schema, producer: { id: producer, instance_id: state.deploymentId }, sources };
  if (Buffer.byteLength(canonical(view)) > limit - 256)
    throw Error('Discovery metadata capacity exceeded');
  return view;
}
/** @param {string} content @param {any} state */
function owned(content, state) {
  const value = JSON.parse(content);
  if (
    value.schema !== schema ||
    value.producer?.id !== producer ||
    value.producer?.instance_id !== state.deploymentId ||
    !Array.isArray(value.sources) ||
    value.sources.length > 20
  )
    throw Error('Discovery producer path is occupied by an unrelated document');
  return value;
}
/** @param {any} value */
function semantic(value) {
  const { published_at: _at, ...view } = value;
  return contentHash(canonical(view));
}
/** One persisted metadata publication phase. Failure yields to ordinary ingestion.
 * @param {any} state @param {{crypto:any,client:any,now?:number}} options @returns {Promise<boolean>} */
export async function advanceKnowledgeSources(state, { crypto, client, now = Date.now() }) {
  if (state.active) return false;
  // Native enrollment validates production UUIDs. Legacy/custom runners remain independent.
  if (!uuid.test(state.deploymentId) || !uuid.test(state.ownerId)) return false;
  if (state.knowledgeSources?.nextDue > now) return false;
  const pub = (state.knowledgeSources ??= {});
  try {
    const target = knowledgeSourcesPath(state),
      view = knowledgeSourcesView(state, crypto),
      hash = semantic(view);
    if (!view.sources.length && !pub.fileId && !pub.pending) {
      pub.nextDue = now + 60000;
      return false;
    }
    if (pub.pending && pub.pending.hash !== hash && !pub.pending.intent?.receipt)
      delete pub.pending;
    if (!pub.pending) {
      const current = (await client.fileState(target, { maxBytes: limit })).file;
      if (current) {
        const existing = owned(current.content, state);
        if (semantic(existing) === hash) {
          complete(pub, existing, current.id, hash, now, hash);
          return true;
        }
      }
      const document = { ...view, published_at: new Date(now).toISOString() },
        content = canonical(document) + '\n';
      if (Buffer.byteLength(content) > limit) throw Error('Discovery metadata capacity exceeded');
      pub.pending = { hash, document, intent: fileIntent(target, content, current, limit) };
      pub.nextDue = now;
      delete pub.error;
      return true;
    }
    const p = pub.pending;
    const current = (await client.fileState(target, { maxBytes: limit })).file;
    if (current) owned(current.content, state);
    const result = await advanceFile(p.intent, client);
    if (result === 'verified') complete(pub, p.document, p.intent.file.id, p.hash, now, hash);
    else if (result === 'changed') {
      // Only metadata owned by this producer can be regenerated; provider data is untouched.
      pub.previous = [
        ...(pub.previous ?? []),
        {
          path: p.intent.path,
          revision: contentHash(p.intent.content),
          receipt: p.intent.receipt,
          history: p.intent.history,
          interveningFileIds: p.intent.interveningFileIds ?? []
        }
      ].slice(-4);
      pub.pending = null;
      pub.nextDue = now + 30000;
      pub.error = 'Discovery publication changed; regeneration pending';
    } else pub.nextDue = now;
    return true;
  } catch {
    pub.error = 'Discovery publication unverified; ingestion continues';
    pub.nextDue = now + 30000;
    return false;
  }
}
/** @param {any} pub @param {any} document @param {string} id @param {string} hash @param {number} now @param {string} latestHash */
function complete(pub, document, id, hash, now, latestHash) {
  pub.fileId = id;
  pub.viewHash = hash;
  pub.publishedAt = document.published_at;
  pub.pointers = Object.fromEntries(
    document.sources
      .filter((/** @type {any} */ s) => s.index_revision)
      .map((/** @type {any} */ s) => [
        s.connection_id,
        {
          scope_hash: s.scope_hash,
          index_path: s.index_path,
          index_revision: s.index_revision,
          last_verified_at: s.last_verified_at ?? null
        }
      ])
  );
  pub.pending = null;
  pub.nextDue = hash === latestHash ? now + 60000 : now;
  delete pub.error;
}
