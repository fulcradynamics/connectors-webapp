import { randomUUID } from 'node:crypto';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { start, getRun, getHookByToken } from 'workflow/api';
import { nativeController, nativeOperation } from '../../../../workflows/native-controller.js';
import { freshState, nativeStore, commandResult } from './state.js';
import { commandRoute, cryptoOptions, executeCommand } from './commands.js';
import { seal, unseal } from '../secrets.js';
import { requireOwner } from '../owner.js';
import { sameOrigin } from '../runtime.js';
import { FulcraClient } from '../fulcra.js';
const headers = { 'Cache-Control': 'private, no-store' };
export const controllerToken = () =>
  `connectors:controller:${env.CONNECTORS_DEPLOYMENT_ID}:${env.OWNER_USER_ID}`;
const context = (/** @type {string} */ kind) =>
  `${env.CONNECTORS_DEPLOYMENT_ID}:${env.OWNER_USER_ID}:${kind}`;
/** @type {string|undefined} */ let initialRunId = env.CONNECTORS_NATIVE_ROOT_RUN_ID || undefined;
/** @param {string} runId @returns {Promise<any>} */
export async function readSnapshot(runId) {
  const stream = getRun(runId).getReadable({ namespace: 'state', startIndex: -1 });
  const reader = stream.getReader();
  let timer;
  try {
    return await Promise.race([
      reader.read().then((result) => result.value),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          try {
            error(
              503,
              'Controller state read is temporarily unavailable; retry the saved operation'
            );
          } catch (cause) {
            reject(cause);
          }
        }, 20000);
      })
    ]);
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
  }
}
/** @param {string} accessToken */
async function ensureMarker(accessToken) {
  if (initialRunId) return initialRunId;
  if (!env.CONNECTORS_DEPLOYMENT_ID || !env.CREDENTIAL_ENCRYPTION_KEY || !env.OWNER_USER_ID)
    error(503, 'Deployment identity/encryption is required');
  const client = new FulcraClient({ endpoint: publicEnv.PUBLIC_FULCRA_API_ENDPOINT, accessToken });
  const path =
    '/' +
    (env.WORKSPACE_PATH || 'workspace/connectors-webapp').replace(/^\/+|\/+$/g, '') +
    `/runtime/controller-${env.CONNECTORS_DEPLOYMENT_ID}.json`;
  const existing = await client.readFile(path);
  if (existing) {
    const marker = JSON.parse(existing);
    if (
      marker.deploymentId !== env.CONNECTORS_DEPLOYMENT_ID ||
      marker.ownerId !== env.OWNER_USER_ID ||
      !/^wrun_[0-9A-HJKMNP-TV-Z]{26}$/.test(marker.runId)
    )
      error(503, 'Controller marker mismatch; preserve it for recovery');
    initialRunId = marker.runId;
    return initialRunId;
  }
  error(
    503,
    'Native controller has not been initialized. Run the deployment bootstrap; missing state is never an empty database.'
  );
}
/** Explicit first-deploy action; ordinary setup requests cannot initialize empty state.
 * @param {string} accessToken */
async function initializeNative(accessToken) {
  try {
    return await ensureMarker(accessToken);
  } catch (cause) {
    if (!cause || typeof cause !== 'object' || !('status' in cause) || cause.status !== 503)
      throw cause;
  }
  if (env.CONNECTORS_NATIVE_ROOT_RUN_ID)
    error(503, 'Configured controller unavailable; recovery is required');
  if (env.CONNECTORS_NATIVE_ALLOW_BOOTSTRAP !== '1')
    error(503, 'First-deploy initialization is disabled; preserve the existing controller');
  const client = new FulcraClient({ endpoint: publicEnv.PUBLIC_FULCRA_API_ENDPOINT, accessToken });
  const path =
    '/' +
    (env.WORKSPACE_PATH || 'workspace/connectors-webapp').replace(/^\/+|\/+$/g, '') +
    `/runtime/controller-${env.CONNECTORS_DEPLOYMENT_ID}.json`;
  let hook;
  try {
    hook = await getHookByToken(controllerToken());
  } catch {
    /* First setup only; the saved marker prevents empty recovery. */
  }
  const candidate =
    hook?.runId ??
    (
      await start(nativeController, [
        freshState(env.CONNECTORS_DEPLOYMENT_ID, env.OWNER_USER_ID),
        controllerToken()
      ])
    ).runId;
  let winner = candidate;
  for (let i = 0; i < 20; i++) {
    try {
      const found = await getHookByToken(controllerToken());
      if (found?.runId) {
        winner = found.runId;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // Never publish the candidate if another run won initial admission.
  const admitted = await getHookByToken(controllerToken());
  winner = admitted.runId;
  const marker = JSON.stringify({
    version: 1,
    deploymentId: env.CONNECTORS_DEPLOYMENT_ID,
    ownerId: env.OWNER_USER_ID,
    runId: winner
  });
  const file = await client.uploadFile(path, marker, 'application/json');
  let verified = false;
  for (let i = 0; i < 10; i++) {
    try {
      if (new TextDecoder().decode(await client.readFileBytes(file.id)) === marker) {
        verified = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!verified)
    error(503, 'Controller marker readback pending; retain deployment and retry setup');
  initialRunId = winner;
  return winner;
}

/** @param {string|undefined} accessToken @returns {Promise<any>} */
async function currentSnapshot(accessToken = undefined) {
  const root = accessToken ? await ensureMarker(accessToken) : initialRunId;
  let active;
  try {
    active = await getHookByToken(controllerToken());
  } catch {}
  if (active?.runId) {
    const status = await getRun(active.runId).status;
    if (status !== 'running' && status !== 'pending')
      error(503, 'Native controller stopped; preserve its run for recovery');
    const snapshot = await readSnapshot(active.runId);
    if (snapshot) return { runId: active.runId, ...snapshot };
  }
  // A handoff may briefly have no inbox. Follow the saved chain; never initialize empty state.
  if (root) {
    let id = root;
    for (let i = 0; i < 32; i++) {
      const snapshot = await readSnapshot(id);
      if (snapshot?.nextRunId) {
        id = snapshot.nextRunId;
        continue;
      }
      error(503, 'Controller handoff/recovery pending; retry this operation');
    }
  }
  error(503, 'Native controller is not available');
}
/** @param {any} event @returns {Promise<Response|undefined>} */
export async function nativeHTTP(event) {
  if (env.CONNECTORS_BACKEND !== 'workflow') return;
  const { url, request, cookies } = event,
    path = url.pathname,
    method = request.method;
  if (path === '/api/cron') return; // Existing independently authenticated endpoint remains fail-closed; native timer needs no cron.
  const operation = path.match(/^\/api\/native\/operations\/([A-Za-z0-9_-]+)$/);
  const initialize = path === '/api/native/initialize' && method === 'POST';
  const route = commandRoute(path, method),
    setup = path === '/api/setup' && method === 'GET',
    probe = path === '/api/native/probe' && method === 'POST';
  if (!operation && !route && !setup && !probe && !initialize) return;
  let owner;
  const isWebhook = path.startsWith('/api/webhooks/');
  if (!isWebhook) {
    owner = await requireOwner(cookies);
    if (method !== 'GET') sameOrigin(request, url);
  }
  if (initialize) {
    if (
      !env.CONNECTORS_NATIVE_BOOTSTRAP_SECRET ||
      request.headers.get('X-Bootstrap-Secret') !== env.CONNECTORS_NATIVE_BOOTSTRAP_SECRET
    )
      error(403, 'Deployment bootstrap authorization required');
    const runId = await initializeNative((await requireOwner(cookies)).accessToken);
    return json({ runId }, { headers });
  }
  if (operation) {
    if (method !== 'GET') error(405, 'Method not allowed');
    let ticket;
    try {
      ticket = unseal(
        JSON.parse(Buffer.from(operation[1], 'base64url').toString()),
        context('native-operation'),
        cryptoOptions()
      );
    } catch {
      error(403, 'Invalid operation reference');
    }
    if (ticket.expiresAt < Date.now() || !/^wrun_[0-9A-HJKMNP-TV-Z]{26}$/.test(ticket.runId))
      error(403, 'Operation reference expired');
    const run = getRun(ticket.runId),
      status = await run.status;
    if (status === 'completed') {
      const result = await run.returnValue;
      if (result.httpStatus === 503 && result.body?.operationId && ticket.commandId) {
        const snapshot = await currentSnapshot((await requireOwner(cookies)).accessToken);
        const state = unseal(snapshot.server, context('native-snapshot'), cryptoOptions());
        if (state.commands[ticket.commandId])
          return json(
            { done: true, ...commandResult(state, ticket.commandId, cryptoOptions()) },
            { headers }
          );
        return json({ done: false, status: 'awaiting_controller' }, { headers });
      }
      return json({ done: true, ...result }, { headers });
    }
    if (status === 'failed' || status === 'cancelled') {
      const snapshot = await currentSnapshot((await requireOwner(cookies)).accessToken);
      const state = unseal(snapshot.server, context('native-snapshot'), cryptoOptions());
      if (ticket.commandId && state.commands[ticket.commandId])
        return json(
          { done: true, ...commandResult(state, ticket.commandId, cryptoOptions()) },
          { headers }
        );
      return json(
        {
          done: true,
          httpStatus: 503,
          body: {
            uncertain: true,
            retrySameCommand: true,
            operationId: ticket.commandId,
            message: 'Native operation interrupted; retry this action with its original command ID'
          }
        },
        { headers }
      );
    }
    return json({ done: false, status }, { headers });
  }
  const snapshot = await currentSnapshot(owner?.accessToken);
  if (setup)
    return json(
      {
        ready: true,
        missing: [],
        backend: 'workflow',
        backgroundStatus: snapshot.view.backgroundStatus,
        schedulerStatus: 'native_workflow',
        lastTick: snapshot.view.lastTick,
        probe: snapshot.view.probe,
        controllerRunId: snapshot.runId
      },
      { headers }
    );
  if (method === 'GET' && path === '/api/connections')
    return json({ connections: Object.values(snapshot.view.connections) }, { headers });
  const detail = path.match(/^\/api\/connections\/([a-f0-9-]{36})$/i);
  if (method === 'GET' && detail) {
    const c = snapshot.view.connections[detail[1]];
    if (!c) error(404, 'Unknown connection');
    return json(
      {
        connection: c,
        status: {
          last_attempt: c.lastAttempt ?? null,
          last_verified_sync: c.lastVerified ?? null,
          last_verified_delivery: c.lastDelivery ?? null,
          last_error: c.lastError ?? null,
          backlog: c.status === 'ready' ? 1 : 0,
          failed_items: c.failedItems ?? 0,
          credential_status: snapshot.view.credentialStatus['provider:' + c.id]
        }
      },
      { headers }
    );
  }
  const text = method === 'GET' ? undefined : await request.text();
  if (
    text &&
    Buffer.byteLength(text) >
      (isWebhook
        ? 128000
        : /^\/api\/connections\/[a-f0-9-]{36}\/documents$/i.test(path)
          ? 64000
          : 32000)
  )
    error(413, 'Request too large');
  let commandHeaders = {};
  if (isWebhook) {
    commandHeaders = Object.fromEntries(
      [...request.headers].filter(([key]) =>
        [
          'x-slack-signature',
          'x-slack-request-timestamp',
          'x-hub-signature-256',
          'x-github-delivery',
          'x-webhook-id',
          'x-webhook-timestamp',
          'x-webhook-signature',
          'webhook-id',
          'webhook-timestamp',
          'webhook-signature'
        ].includes(key)
      )
    );
    const state = unseal(snapshot.server, context('native-snapshot'), cryptoOptions());
    const validation = await executeCommand(structuredClone(state), {
      url: url.href,
      method,
      body: text,
      headers: commandHeaders
    });
    if (validation.httpStatus >= 400)
      return json(validation.body, { status: validation.httpStatus, headers });
  }
  const id = request.headers.get('X-Command-ID') || randomUUID();
  if (!/^[a-f0-9-]{36}$/i.test(id)) error(400, 'Invalid command ID');
  const envelope = seal(
    { url: url.href, method, body: text, accessToken: owner?.accessToken, headers: commandHeaders },
    context('native-command'),
    cryptoOptions()
  );
  const run = await start(nativeOperation, [controllerToken(), id, envelope]);
  if (isWebhook) {
    const deadline = Date.now() + 22000;
    while (Date.now() < deadline) {
      const status = await run.status;
      if (status === 'completed') {
        const result = await run.returnValue;
        return json(result.body, { status: result.httpStatus, headers });
      }
      if (status === 'failed' || status === 'cancelled') break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return json(
      { message: 'Webhook acceptance pending; retry the same delivery' },
      { status: 503, headers }
    );
  }
  const ticket = seal(
    { runId: run.runId, commandId: id, expiresAt: Date.now() + 86400000 },
    context('native-operation'),
    cryptoOptions()
  );
  const statusUrl =
    '/api/native/operations/' + Buffer.from(JSON.stringify(ticket)).toString('base64url');
  return json({ pending: true, operationId: id, statusUrl }, { status: 202, headers });
}
