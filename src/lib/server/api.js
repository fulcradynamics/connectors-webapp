import { error, isHttpError } from '@sveltejs/kit';
import { requireOwner } from './owner';
import { runtime, sameOrigin } from './runtime';
/** @param {any} event @param {boolean} mutate */
export async function ownerRuntime(event, mutate = false) {
  const owner = await requireOwner(event.cookies);
  if (mutate) sameOrigin(event.request, event.url);
  return { ...runtime(), owner };
}
/** @param {Request} request @param {{allowEmpty?:boolean,maxBytes?:number}} [options] */
export async function bodyJSON(request, { allowEmpty = false, maxBytes = 32000 } = {}) {
  if (Number(request.headers.get('content-length')) > maxBytes)
    error(413, 'Configuration too large');
  const text = await request.text();
  if (Buffer.byteLength(text) > maxBytes) error(413, 'Configuration too large');
  try {
    return allowEmpty && !text.trim() ? {} : JSON.parse(text);
  } catch {
    error(400, 'Invalid JSON');
  }
}
/** @param {any} store @param {string} id */
export async function ownedConnection(store, id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) error(404, 'Unknown connection');
  const c = await store.getConnection(id);
  if (!c) error(404, 'Unknown connection');
  return c;
}
/** @param {()=>Promise<any>} fn */
export async function configurationAction(fn) {
  try {
    return await fn();
  } catch (cause) {
    if (isHttpError(cause)) throw cause;
    error(
      400,
      cause instanceof Error &&
        /configuration|Select |Choose |preview|authorization|Polling |Invalid |Configuration changed|token|reauthorize|bound|Two-way|Document|Conflict|Markdown|Enable |Working|Notion Markdown|Resolve |Attio /i.test(
          cause.message
        )
        ? cause.message
        : 'Unable to complete this action; check source permissions and configuration'
    );
  }
}
