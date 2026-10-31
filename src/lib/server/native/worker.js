import { advanceNotionSync } from '../notion-sync/worker.js';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { stage, unstage, nativeStore } from './state.js';
import { seal, unseal } from '../secrets.js';
import { adapters } from '../connectors/index.js';
import { getProviderCredential, getFulcraCredential } from '../credentials.js';
import { FulcraClient } from '../fulcra.js';
import { prepareOutput } from '../sync/runner.js';
import { contentHash, canonical } from '../sync/identity.js';
import { validateOutput, validateRoute, verify } from '../sync/sinks.js';
/** @param {any} state @param {any} dependencies */
export async function advanceWorker(state, dependencies = {}) {
  const crypto = dependencies.crypto ?? {
    key: privateEnv.CREDENTIAL_ENCRYPTION_KEY,
    keyId: privateEnv.CREDENTIAL_KEY_ID || 'v1',
    previousKeys: JSON.parse(privateEnv.CREDENTIAL_PREVIOUS_KEYS || '{}')
  };
  const store = nativeStore(state),
    grant = state.grants.fulcra;
  state.lastTick = new Date().toISOString();
  if (state.probe?.dueAt && state.probe.dueAt <= Date.now()) {
    state.probe.completedAt = new Date().toISOString();
    state.probe.dueAt = null;
  }
  if (!grant || !['ready', 'refreshing'].includes(grant.status)) return state;
  // Persist refresh intent as its own returned state before performing the exchange.
  if (grant.status === 'ready' && Date.parse(grant.expiresAt) <= Date.now() + 60000) {
    grant.status = 'refreshing';
    grant.refreshIntentAt = Date.now();
    return state;
  }
  if (grant.status === 'refreshing') {
    try {
      grant.status = 'ready';
      await getFulcraCredential(store, {
        crypto,
        clientId: publicEnv.PUBLIC_AUTH0_CLIENT_ID,
        auth0Domain: publicEnv.PUBLIC_AUTH0_DOMAIN
      });
    } catch {
      state.grants.fulcra.status = 'refresh_uncertain';
      state.lastError = 'Background refresh outcome uncertain; reauthorize';
      for (const c of /** @type {any[]} */ (Object.values(state.connections)))
        if (c.status === 'ready') {
          c.status = 'paused';
          c.generation++;
        }
    }
    return state;
  }
  if (!state.active) {
    const c = /** @type {any[]} */ (Object.values(state.connections))
      .filter((c) => c.status === 'ready' && c.nextDue !== null && c.nextDue <= Date.now())
      .sort((a, b) => a.nextDue - b.nextDue)[0];
    if (c) {
      state.active = { connectionId: c.id, generation: c.generation, phase: 'read' };
      c.lastAttempt = new Date().toISOString();
    }
    return state;
  }
  const active = state.active,
    c = state.connections[active.connectionId];
  if (!c || c.status !== 'ready' || c.generation !== active.generation) {
    state.active = null;
    return state;
  }
  const cp = (state.checkpoints[c.id] ??= {});
  /** @type {any} */ let pending;
  const save = () => {
    cp.pendingExpiresAt ??= cp.pending
      ? unseal(cp.pending, `${state.deploymentId}:${state.ownerId}:native:pending:${c.id}`, crypto)
          .expiresAt
      : Date.now() + 86400000;
    const encrypted = stage(
      state,
      'pending:' + c.id,
      pending,
      crypto,
      Date.now(),
      cp.pendingExpiresAt
    );
    const prospective = {
      ...state,
      checkpoints: { ...state.checkpoints, [c.id]: { ...cp, pending: encrypted } }
    };
    if (Buffer.byteLength(JSON.stringify(prospective)) > 1536 * 1024)
      throw Error('Staging capacity exceeded; choose a smaller source');
    cp.pending = encrypted;
  };
  const retry = (/** @type {string} */ message, delay = 30000) => {
    c.lastError = message;
    c.nextDue = Date.now() + delay;
    state.active = null;
  };
  try {
    const client =
      dependencies.client ??
      new FulcraClient({
        endpoint: publicEnv.PUBLIC_FULCRA_API_ENDPOINT,
        accessToken: unseal(
          grant.encrypted,
          `${state.deploymentId}:${state.ownerId}:fulcra`,
          crypto
        ).access_token,
        deadline: Date.now() + 25000
      });
    const provider =
      dependencies.provider ??
      ((/** @type {any} */ connection) => getProviderCredential(store, connection.id, crypto));
    if (c.connector === 'notion' && c.config.twoWay?.enabled)
      return advanceNotionSync(state, c, { crypto, client, provider, notion: dependencies.notion });
    if (active.phase === 'read') {
      if (cp.pending) {
        try {
          pending = unstage(state, 'pending:' + c.id, cp.pending, crypto);
        } catch {
          delete cp.pending;
          delete cp.pendingExpiresAt;
          delete cp.value;
          c.lastError = 'Staging expired; reconciling selected sources';
        }
      }
      if (!pending) {
        let checkpoint = null;
        if (cp.value) {
          try {
            checkpoint = unstage(state, 'value:' + c.id, cp.value, crypto);
          } catch {
            delete cp.value;
          }
        }
        const hints = Object.values(state.hints[c.id] ?? {}).slice(0, 20);
        const adapter = (dependencies.adapters ?? adapters)[c.connector];
        if (!adapter) throw Error('Unknown adapter');
        const page = await adapter.readPage({
          connection: c,
          credential: await provider(c),
          checkpoint,
          deadline: Date.now() + 25000,
          hints
        });
        if (page.retryAt) {
          retry('rate_limited', Math.max(1000, Date.parse(page.retryAt) - Date.now()));
          return state;
        }
        if (page.resetRequired) {
          delete cp.value;
          delete cp.pending;
          retry('reconciliation_required', 1000);
          return state;
        }
        if (!Array.isArray(page.changes) || page.changes.length > 100)
          throw Error('Invalid bounded page');
        pending = {
          outputs: page.changes.map((/** @type {any} */ change) =>
            prepareOutput(c, change, state.ownerId)
          ),
          candidateCheckpoint: page.candidateCheckpoint,
          continuation: page.continuation ?? null,
          ackHintIds: page.ackHintIds ?? hints.map((/** @type {any} */ h) => h.event_id)
        };
        save();
      }
      active.phase = 'intents';
      return state;
    }
    pending = unstage(state, 'pending:' + c.id, cp.pending, crypto);
    if (active.phase === 'intents') {
      const route = c.config.route,
        schema = route.mode === 'file' ? {} : await client.schema(route.recordType);
      validateRoute(route, route.mode === 'file' ? [] : await client.catalog(), schema);
      for (const output of pending.outputs) validateOutput(output, route, schema);
      if (!pending.items) {
        pending.items = [];
        for (let outputIndex = 0; outputIndex < pending.outputs.length; outputIndex++) {
          const output = pending.outputs[outputIndex];
          if (route.mode !== 'record')
            for (let fileIndex = 0; fileIndex < output.files.length; fileIndex++) {
              const file = output.files[fileIndex];
              if (
                file.path.startsWith('/') ||
                file.path.includes('\\') ||
                file.path.split('/').some((/** @type {string} */ s) => s === '..' || s === '.') ||
                /%2e|%2f|%5c/i.test(file.path)
              )
                throw Error('Invalid artifact path');
              pending.items.push({
                outputIndex,
                fileIndex,
                receipt: {
                  sink: 'file',
                  path: route.folder.replace(/\/$/, '') + '/' + file.path,
                  hash: contentHash(file.content),
                  status: 'intent',
                  inputId: ''
                }
              });
            }
          if (route.mode !== 'file') {
            const fields = Object.keys(output.record).filter(
              (k) => !['sources', 'tags', 'start_time', 'end_time'].includes(k)
            );
            pending.items.push({
              outputIndex,
              receipt: {
                sink: 'record',
                dataType: route.recordType,
                id: output.record.id,
                fields,
                hash: contentHash(
                  canonical(Object.fromEntries(fields.map((k) => [k, output.record[k]])))
                ),
                status: 'intent',
                uploadId: ''
              }
            });
          }
        }
      }
      save();
      active.phase = 'deliver';
      return state;
    }
    if (active.phase === 'deliver') {
      const item = pending.items.find(
        (/** @type {any} */ item) =>
          !['verified', 'pending', 'failed'].includes(item.receipt.status)
      );
      if (!item) {
        active.phase = 'verify';
        active.verifyIndex = 0;
        return state;
      }
      const receipt = item.receipt,
        output = pending.outputs[item.outputIndex];
      if (receipt.sink === 'file') {
        const found = await client.findFileByHash(receipt.path, receipt.hash);
        if (found) {
          receipt.inputId = found.id;
          receipt.status = 'verified';
          delete receipt.transfer;
        } else if (!receipt.transfer) {
          const file = output.files[item.fileIndex],
            upload = await client.allocateFile(receipt.path, file.content, file.contentType);
          receipt.inputId = upload.file.id;
          receipt.transfer = { url: upload.url };
          receipt.status = 'allocated';
        } else {
          const file = output.files[item.fileIndex];
          try {
            await client.transferFile(receipt.transfer, file.content, file.contentType);
            receipt.status = 'pending';
            delete receipt.transfer;
          } catch (cause) {
            if (cause instanceof Error && /returned (400|401|403|404|410)/.test(cause.message)) {
              delete receipt.transfer;
              receipt.previousInputId = receipt.inputId;
              receipt.inputId = '';
            }
            receipt.status = 'uncertain';
            save();
            retry('file_transfer_uncertain');
            return state;
          }
        }
      } else {
        const record = await client.readRecord(receipt.dataType, receipt.id);
        if (record) receipt.status = await verify(receipt, { readRecord: async () => record });
        else {
          // Deterministic record IDs were verified idempotent against Fulcra in M2.
          try {
            const upload = await client.writeRecords(receipt.dataType, [output.record]);
            receipt.uploadId = upload.upload_id;
            receipt.status = 'pending';
          } catch {
            receipt.status = 'uncertain';
            save();
            retry('record_submission_uncertain');
            return state;
          }
        }
      }
      save();
      return state;
    }
    if (active.phase === 'verify') {
      const item = pending.items[active.verifyIndex ?? 0];
      if (!item) {
        if (pending.items.every((/** @type {any} */ i) => i.receipt.status === 'verified'))
          active.phase = 'commit';
        else {
          save();
          retry('verification_pending');
        }
        return state;
      }
      if (item.receipt.status !== 'verified')
        item.receipt.status = await verify(item.receipt, client);
      if (item.receipt.status === 'failed') {
        c.failedItems = pending.items.filter(
          (/** @type {any} */ i) => i.receipt.status === 'failed'
        ).length;
        c.status = 'paused';
        c.generation++;
        save();
        retry('verification_failed; inspect destination and reconfigure before resuming');
        return state;
      }
      if (item.receipt.status === 'verified') c.lastDelivery = new Date().toISOString();
      active.verifyIndex = (active.verifyIndex ?? 0) + 1;
      save();
      return state;
    }
    if (active.phase === 'commit') {
      if (!pending.items.every((/** @type {any} */ i) => i.receipt.status === 'verified'))
        throw Error('Unverified checkpoint');
      cp.value = stage(state, 'value:' + c.id, pending.candidateCheckpoint, crypto);
      delete cp.pending;
      delete cp.pendingExpiresAt;
      for (const id of pending.ackHintIds ?? []) delete state.hints[c.id]?.[id];
      state.deliveries[c.id] = pending.items.map((/** @type {any} */ i) => i.receipt).slice(-200);
      c.nextDue =
        Date.now() + (pending.continuation ? 1000 : Math.max(60, c.config.intervalSeconds) * 1000);
      c.lastVerified = new Date().toISOString();
      c.lastError = null;
      c.failedItems = 0;
      state.active = null;
      return state;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : '';
    if (/capacity|Staging expired/.test(message)) {
      c.status = 'paused';
      c.generation++;
      retry(message);
    } else
      retry(
        /reauthorize|authorization|required_configuration/.test(message)
          ? 'authorization_required'
          : 'sync_pending'
      );
  }
  return state;
}
