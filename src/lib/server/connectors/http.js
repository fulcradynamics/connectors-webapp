import { MAX_SELECTED_SOURCES } from '../../connectors/setup.js';
/** Structured provider errors never contain bearer tokens or raw response bodies. */
export class ProviderError extends Error {
  /** @param {number} status @param {string|null} retryAt */
  constructor(status, retryAt = null) {
    super(status === 401 || status === 403 ? 'Provider reauthorize' : `Provider status ${status}`);
    this.status = status;
    this.retryAt = retryAt;
  }
}
/** @param {{base:string,credential:any,headers?:Record<string,string>,fetchImpl?:typeof fetch,deadline?:number}} options */
export function providerHTTP({
  base,
  credential,
  headers = {},
  fetchImpl = fetch,
  deadline = Date.now() + 10000
}) {
  /** @param {string} path @param {RequestInit} init @param {number[]} allowed */
  return async (path, init = {}, allowed = []) => {
    const url = new URL(path, base);
    if (url.origin !== new URL(base).origin) throw new Error('Untrusted provider pagination URL');
    const response = await fetchImpl(url, {
      ...init,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${credential.token}`,
        'Content-Type': 'application/json',
        ...headers,
        ...init.headers
      },
      signal: AbortSignal.timeout(Math.max(1, Math.min(8000, deadline - Date.now() - 500)))
    });
    if (
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.has('retry-after') ||
          response.headers.get('x-ratelimit-remaining') === '0'))
    ) {
      const delay = Number(response.headers.get('retry-after') ?? 60);
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      throw new ProviderError(
        429,
        new Date(
          reset
            ? reset * 1000
            : Date.now() + Math.max(1, Number.isFinite(delay) ? delay : 60) * 1000
        ).toISOString()
      );
    }
    if (!response.ok && !allowed.includes(response.status))
      throw new ProviderError(response.status);
    if (Number(response.headers.get('content-length')) > 2_000_000)
      throw new Error('Provider page exceeds 2MB bound');
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error('Provider page exceeds 2MB bound');
    const data = text ? JSON.parse(text) : {};
    return { data, status: response.status, headers: response.headers };
  };
}
/** @param {()=>Promise<any>} fn */
export async function rateAware(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ProviderError && error.retryAt)
      return { changes: [], retryAt: error.retryAt };
    throw error;
  }
}
/** @param {any} connection */
export function selectedResources(connection) {
  const ids = connection.config.resources;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > MAX_SELECTED_SOURCES ||
    ids.some((id) => typeof id !== 'string' || !id || id.length > 200)
  )
    throw new Error('Selected resources required_configuration');
  return ids;
}
