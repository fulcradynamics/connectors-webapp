/** Resolve native operations, preserving a stable command ID without storing request secrets.
 * @param {string} path @param {RequestInit} init @param {{fetchImpl?:typeof fetch,delay?:(ms:number)=>Promise<void>,operationScope?:string}} options */
export async function connectorRequest(
  path,
  init = {},
  {
    fetchImpl = fetch,
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    operationScope
  } = {}
) {
  const storageKey =
    'fulcra.connector.pending:' +
    init.method +
    ':' +
    path +
    (operationScope ? ':' + operationScope : '');
  const remember = (/** @type {any} */ value) => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
        else sessionStorage.removeItem(storageKey);
      }
    } catch {}
  };
  let saved;
  try {
    if (typeof sessionStorage !== 'undefined')
      saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
  } catch {}
  if (init.body && typeof init.body !== 'string')
    throw Error('Connector requests require JSON text');
  if (saved?.createdAt && Date.now() - saved.createdAt > 23 * 3600000)
    throw Error(
      'Saved action is too old to retry safely; inspect its outcome before a new action.'
    );
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify([init.method, path, init.body ?? null]))
  );
  const requestHash = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
  if (saved?.requestHash && saved.requestHash !== requestHash)
    throw Error(
      'An earlier action is unresolved. Retry its original values before changing this request.'
    );
  const commandId = saved?.operationId || crypto.randomUUID();
  const intent = { operationId: commandId, requestHash, createdAt: saved?.createdAt ?? Date.now() };
  let body = saved;
  if (!saved?.statusUrl) {
    // Persist identity before the first POST: even its initial response can be lost.
    remember(intent);
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetchImpl(path, {
          ...init,
          headers: { ...init.headers, 'X-Command-ID': commandId }
        });
        if (
          response.status >= 500 &&
          attempt === 0 &&
          (init.method === 'GET' ||
            /^\/api\/connections\/[a-f0-9-]{36}\/documents(?:\?|$)/i.test(path))
        ) {
          // Document mutations require the deduplicated Workflow backend. Other writes may not.
          await response.body?.cancel();
          await delay(300);
          continue;
        }
        break;
      } catch (e) {
        if (attempt === 1) throw e;
      }
    }
    if (!response) throw Error('Request unavailable');
    body = await response.json();
    if (!response.ok) {
      if (response.status < 500 && !body.uncertain) remember(null);
      throw Error(body.message ?? 'Request failed');
    }
    if (response.status !== 202 || body.pending !== true) {
      remember(null);
      return body;
    }
    body = { ...intent, pending: true, statusUrl: body.statusUrl };
    remember(body);
  }
  const statusUrl = body.statusUrl;
  if (typeof statusUrl !== 'string' || !statusUrl.startsWith('/api/native/operations/'))
    throw Error('Invalid operation reference');
  for (let n = 0; n < 100; n++) {
    await delay(1200);
    const status = await fetchImpl(statusUrl);
    body = await status.json();
    if (!status.ok)
      throw Error(body.message ?? 'Operation status unavailable; keep this page open');
    if (body.done) {
      if (body.httpStatus >= 400) {
        if (body.body?.uncertain) {
          if (body.body.retrySameCommand) remember(intent);
        } else remember(null);
        throw Error(
          body.body?.message ?? 'Operation remains uncertain; check status before repeating'
        );
      }
      remember(null);
      return body.body;
    }
  }
  throw Error(
    'Operation remains pending. Its reference is saved; use this action again to check status without repeating it.'
  );
}
