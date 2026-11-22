import { isHttpError } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { withRuntime } from '../runtime-context.js';
import { nativeStore } from './state.js';
import * as connections from '../../../routes/api/connections/+server.js';
import * as connection from '../../../routes/api/connections/[id]/+server.js';
import * as resources from '../../../routes/api/connections/[id]/resources/+server.js';
import * as action from '../../../routes/api/connections/[id]/action/+server.js';
import * as credentials from '../../../routes/api/connections/[id]/credentials/+server.js';
import * as documents from '../../../routes/api/connections/[id]/documents/+server.js';
import * as preview from '../../../routes/api/preview/+server.js';
import * as backgroundStart from '../../../routes/api/background-auth/start/+server.js';
import * as backgroundComplete from '../../../routes/api/background-auth/complete/+server.js';
import * as backgroundDisconnect from '../../../routes/api/background-auth/disconnect/+server.js';
import * as destinationTypes from '../../../routes/api/destinations/types/+server.js';
import * as webhook from '../../../routes/api/webhooks/[provider]/[connection]/+server.js';
/** @param {string} path @param {string} method @returns {{handler:any,params:any}|null} */
export function commandRoute(path, method) {
  const exact = /** @type {Record<string,any>} */ ({
    '/api/connections': connections,
    '/api/preview': preview,
    '/api/background-auth/start': backgroundStart,
    '/api/background-auth/complete': backgroundComplete,
    '/api/background-auth/disconnect': backgroundDisconnect
  });
  let module = exact[path],
    params = {};
  const match = path.match(
    /^\/api\/connections\/([a-f0-9-]{36})(?:\/(resources|action|credentials|documents))?$/i
  );
  if (match) {
    params = { id: match[1] };
    module =
      { resources, action, credentials, documents }[
        /** @type {'resources'|'action'|'credentials'|'documents'} */ (match[2])
      ] ?? connection;
  }
  const hook = path.match(/^\/api\/webhooks\/(slack|github|granola)\/([a-f0-9-]{36})$/i);
  if (hook) {
    params = { provider: hook[1], connection: hook[2] };
    module = webhook;
  }
  if (path === '/api/destinations/types' && method === 'POST') module = destinationTypes;
  const handler = module?.[method];
  return handler ? { handler, params } : null;
}
export const cryptoOptions = () => ({
  key: env.CREDENTIAL_ENCRYPTION_KEY,
  keyId: env.CREDENTIAL_KEY_ID || 'v1',
  previousKeys: JSON.parse(env.CREDENTIAL_PREVIOUS_KEYS || '{}')
});
/** @param {any} state @param {any} command */
export async function executeCommand(state, command) {
  if (new URL(command.url).pathname === '/api/native/probe') {
    if (command.body && JSON.parse(command.body).rollover === true) state.rolloverRequested = true;
    state.probe = {
      count: (state.probe?.count ?? 0) + 1,
      dueAt: Date.now() + 2000,
      completedAt: null
    };
    return { httpStatus: 200, body: { scheduled: true, count: state.probe.count } };
  }
  const route = commandRoute(new URL(command.url).pathname, command.method);
  if (!route) return { httpStatus: 404, body: { message: 'Unknown native operation' } };
  const request = new Request(command.url, {
    method: command.method,
    headers: {
      ...command.headers,
      Origin: new URL(command.url).origin,
      'Content-Type': 'application/json'
    },
    ...(command.body !== undefined ? { body: command.body } : {})
  });
  const event = {
    request,
    url: new URL(command.url),
    params: route.params,
    cookies: {
      get: (/** @type {string} */ key) =>
        key === 'fulcra_access_token' ? command.accessToken : undefined
    }
  };
  try {
    const response = await withRuntime({ store: nativeStore(state), crypto: cryptoOptions() }, () =>
      route.handler(event)
    );
    return { httpStatus: response.status, body: await response.json() };
  } catch (e) {
    return {
      httpStatus: isHttpError(e) ? e.status : 503,
      body: {
        uncertain: !isHttpError(e),
        message: isHttpError(e)
          ? e.body.message
          : 'Operation could not finish; check status before retrying'
      }
    };
  }
}
