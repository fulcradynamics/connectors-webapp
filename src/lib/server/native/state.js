import { randomUUID } from 'node:crypto';
import { seal, unseal } from '../secrets.js';
/** @param {string} deploymentId @param {string} ownerId @returns {any} */
export function freshState(deploymentId, ownerId) {
  return {
    version: 1,
    deploymentId,
    ownerId,
    connections: {},
    grants: {},
    resources: {},
    checkpoints: {},
    deliveries: {},
    hints: {},
    commands: {},
    active: null,
    epoch: 0,
    lastTick: null,
    lastError: null
  };
}
/** @param {any} state @param {string} id @param {any} value @param {any} crypto @param {number} now @param {number|undefined} expiresAt */
export function stage(state, id, value, crypto, now = Date.now(), expiresAt = now + 86400000) {
  if (Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024)
    throw Error('Staging capacity exceeded; choose a smaller source');
  const encrypted = seal(
    { value, expiresAt },
    `${state.deploymentId}:${state.ownerId}:native:${id}`,
    crypto
  );
  return encrypted;
}
/** @param {any} state @param {string} id @param {any} value @param {any} crypto @param {number} now */
export function unstage(state, id, value, crypto, now = Date.now()) {
  const result = unseal(value, `${state.deploymentId}:${state.ownerId}:native:${id}`, crypto);
  if (result.expiresAt <= now) throw Error('Staging expired');
  return result.value;
}
/** Serialized actor-local adapter. Never expose this object across requests/steps.
 * @param {any} state @returns {any} */
export function nativeStore(state) {
  const connection = (/** @type {string} */ id) => {
    const c = state.connections[id];
    if (!c) throw Error('Unknown connection');
    return c;
  };
  const tx = {
    query: async (/** @type {string} */ sql) => {
      if (!sql.startsWith('SELECT pg_advisory_xact_lock'))
        throw Error('Unsupported native transaction statement');
      return { rows: [] };
    }
  };
  const store = {
    supportsTwoWay: true,
    deploymentId: state.deploymentId,
    ownerId: state.ownerId,
    assertOwner: async () => true,
    initialize: async () => true,
    saveGrant: async (
      /** @type {string} */ key,
      /** @type {any} */ grant,
      /** @type {any} */ _db = undefined
    ) => {
      const next = { ...state.grants, [key]: { ...grant } };
      if (Buffer.byteLength(JSON.stringify({ ...state, grants: next })) > 2 * 1024 * 1024 - 64000)
        throw Error('Configuration capacity reached');
      state.grants = next;
    },
    getGrant: async (/** @type {string} */ key) => state.grants[key] ?? null,
    deleteGrant: async (/** @type {string} */ key) => {
      delete state.grants[key];
    },
    withGrantLock: async (
      /** @type {string} */ key,
      /** @type {(row:any,db:any)=>Promise<any>} */ fn
    ) => {
      const before = structuredClone(state.grants);
      try {
        const r = await fn(state.grants[key] ?? null, tx);
        if (r.patch) state.grants[key] = { ...state.grants[key], ...r.patch };
        return r;
      } catch (e) {
        state.grants = before;
        throw e;
      }
    },
    createConnection: async (/** @type {any} */ input) => {
      if (Object.keys(state.connections).length >= 20) throw Error('Connection capacity reached');
      const id = randomUUID(),
        c = {
          id,
          connector: input.connector,
          label: input.label,
          account_id: input.accountId,
          config: input.config,
          status: 'draft',
          generation: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          nextDue: null
        };
      state.connections[id] = c;
      return c;
    },
    listConnections: async () => Object.values(state.connections),
    getConnection: async (/** @type {string} */ id) => state.connections[id] ?? null,
    changeGeneration: async (
      /** @type {string} */ id,
      /** @type {string} */ status,
      /** @type {any} */ config = null,
      /** @type {any} */ expected = null,
      reset = !!config
    ) => {
      const c = connection(id);
      if (expected !== null && String(c.generation) !== String(expected))
        throw Error('Configuration changed; reload');
      c.generation++;
      c.status = status;
      c.updated_at = new Date().toISOString();
      if (config) c.config = config;
      if (reset) {
        delete state.checkpoints[id];
        delete state.deliveries[id];
      }
      return c;
    },
    enqueue: async (/** @type {string} */ id) => {
      const c = connection(id);
      if (c.status === 'ready') c.nextDue = Date.now();
    },
    retryQueued: async (/** @type {string} */ id) => {
      const c = connection(id);
      if (c.status === 'ready') c.nextDue = Date.now();
    },
    pauseAllConnections: async () => {
      for (const c of /** @type {any[]} */ (Object.values(state.connections)))
        if (c.status === 'ready') {
          c.generation++;
          c.status = 'paused';
        }
    },
    saveResources: async (/** @type {string} */ id, /** @type {any[]} */ resources) => {
      const c = connection(id),
        attio = c.connector === 'attio',
        now = Date.now();
      const next = { ...(state.resources[id] ?? {}) };
      if (attio)
        for (const [key, value] of Object.entries(next))
          if (value.verifiedAt <= now - 86400000 && !c.config?.resources?.includes(key))
            delete next[key];
      for (const resource of resources)
        next[resource.id] = attio
          ? {
              id: resource.id,
              name: [...String(resource.name ?? resource.id)].slice(0, 48).join(''),
              kind: 'record',
              verifiedAt: now
            }
          : { ...resource, verifiedAt: now };
      if (
        Object.keys(next).length > (attio ? 1200 : 500) ||
        Buffer.byteLength(JSON.stringify(next)) > (attio ? 384 * 1024 : 64000)
      )
        throw Error('Discovery capacity exceeded; choose a smaller account scope');
      if (
        Buffer.byteLength(
          JSON.stringify({ ...state, resources: { ...state.resources, [id]: next } })
        ) >
        2 * 1024 * 1024 - 64000
      )
        throw Error('Discovery capacity reached');
      state.resources[id] = next;
    },
    getResources: async (/** @type {string} */ id) =>
      Object.values(state.resources[id] ?? {}).filter(
        (/** @type {any} */ r) => r.verifiedAt > Date.now() - 86400000
      ),
    connectionStatus: async (/** @type {string} */ id) => {
      const c = connection(id);
      return {
        last_attempt: c.lastAttempt ?? null,
        last_verified_sync: c.lastVerified ?? null,
        last_verified_delivery: c.lastDelivery ?? null,
        backlog: c.status === 'ready' ? 1 : 0,
        last_error: c.lastError ?? null,
        failed_items: c.failedItems ?? 0,
        credential_status: state.grants['provider:' + id]?.status ?? null
      };
    },
    recordWebhook: async (
      /** @type {string} */ id,
      /** @type {string} */ eventId,
      /** @type {any} */ payload
    ) => {
      const c = connection(id);
      if (!['ready', 'paused'].includes(c.status)) throw Error('Inactive connection');
      state.hints[id] ??= {};
      if (state.hints[id][eventId]) return false;
      if (Object.keys(state.hints[id]).length >= 500)
        throw Error('Webhook backlog capacity reached');
      state.hints[id][eventId] = { event_id: eventId, payload };
      if (c.status === 'ready') c.nextDue = Date.now();
      return true;
    }
  };
  return store;
}
/** Browser-safe projection; grants and source staging never leave the server.
 * @param {any} state */
export function publicState(state) {
  return {
    deploymentId: state.deploymentId,
    ownerId: state.ownerId,
    epoch: state.epoch,
    lastTick: state.lastTick,
    lastError: state.lastError,
    probe: state.probe,
    connections: state.connections,
    backgroundStatus: state.grants.fulcra?.status ?? 'required_configuration',
    credentialStatus: Object.fromEntries(
      Object.entries(state.grants)
        .filter(([k]) => k.startsWith('provider:'))
        .map(([k, v]) => [k, /** @type {any} */ (v).status])
    )
  };
}

/** Keep deduplication tombstones when evicting large completed results; never rerun them.
 * @param {any} state @param {string} id @param {any} result @param {any} crypto */
export function cacheResult(state, id, result, crypto) {
  for (const [key, entry] of Object.entries(state.commands))
    if (/** @type {any} */ (entry).at < Date.now() - 86400000) delete state.commands[key];
  if (Buffer.byteLength(JSON.stringify(result)) > 128000)
    result = {
      httpStatus: 413,
      body: { message: 'Result exceeds preview capacity; select a smaller source' }
    };
  state.commands[id] = { at: Date.now(), result: stage(state, 'result:' + id, result, crypto) };
  const entries = Object.entries(state.commands).sort((a, b) => a[1].at - b[1].at);
  let stateBytes = Buffer.byteLength(JSON.stringify(state));
  for (const [key, entry] of entries) {
    if (stateBytes <= 2 * 1024 * 1024) break;
    if (key !== id && entry.result) {
      const tombstone = { at: entry.at, expired: true };
      // Keys and separators are unchanged; only the serialized entry value shrinks.
      stateBytes -=
        Buffer.byteLength(JSON.stringify(entry)) - Buffer.byteLength(JSON.stringify(tombstone));
      state.commands[key] = tombstone;
    }
  }
  // Keep the current response small if staging consumed the normal result budget.
  if (stateBytes > 2 * 1024 * 1024)
    state.commands[id] = {
      at: Date.now(),
      error:
        'Operation committed; result capacity reached. Check connection status before repeating.'
    };
}
/** @param {any} state @param {string} id @param {any} crypto */
export function commandResult(state, id, crypto) {
  const entry = state.commands[id];
  if (!entry || entry.expired || entry.error)
    return {
      httpStatus: 503,
      body: {
        uncertain: true,
        message:
          entry?.error || 'Completed result expired; check connection status before repeating'
      }
    };
  try {
    return unstage(state, 'result:' + id, entry.result, crypto);
  } catch {
    return {
      httpStatus: 503,
      body: {
        uncertain: true,
        message: 'Completed result expired; check connection status before repeating'
      }
    };
  }
}
