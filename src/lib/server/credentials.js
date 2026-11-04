import { githubInstallationCredential } from './connectors/github-auth.js';
import { garminPersonalCredential } from './connectors/garmin-auth.js';
import { seal, unseal } from './secrets.js';
/** @param {any} store @param {{crypto:{key:string,keyId:string},clientId:string,auth0Domain:string,fetchImpl?:typeof fetch}} options */
export async function getFulcraCredential(
  store,
  { crypto, clientId, auth0Domain, fetchImpl = fetch }
) {
  const context = `${store.deploymentId}:${store.ownerId}:fulcra`;
  const result = await store.withGrantLock('fulcra', async (/** @type {any} */ row) => {
    if (!row) throw new Error('Background authorization required_configuration');
    if (row.status !== 'ready') throw new Error('Background authorization reauthorize');
    const grant = unseal(row.encrypted, context, crypto);
    if (Date.parse(row.expiresAt) > Date.now() + 60000) return { value: grant.access_token };
    if (!grant.refresh_token) return { patch: { status: 'reauthorize' }, error: 'reauthorize' };
    const response = await fetchImpl(`https://${auth0Domain}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: grant.refresh_token
      }),
      signal: AbortSignal.timeout(10000)
    });
    const data = await response.json();
    if (data.error === 'invalid_grant')
      return { patch: { status: 'reauthorize' }, error: 'reauthorize' };
    if (!response.ok || !data.access_token)
      throw new Error('Background authorization temporarily unavailable');
    return {
      value: data.access_token,
      patch: {
        encrypted: seal(
          {
            access_token: data.access_token,
            refresh_token: data.refresh_token ?? grant.refresh_token
          },
          context,
          crypto
        ),
        expiresAt: new Date(Date.now() + Number(data.expires_in) * 1000).toISOString(),
        status: 'ready'
      }
    };
  });
  if (result.error) throw new Error('Background authorization ' + result.error);
  return result.value;
}
/** @param {any} store @param {string} connectionId @param {{key:string,keyId:string}} crypto @param {{fetchImpl?:typeof fetch}} options */
export async function getProviderCredential(store, connectionId, crypto, options = {}) {
  const key = 'provider:' + connectionId,
    context = `${store.deploymentId}:${store.ownerId}:${key}`;
  const result = await store.withGrantLock(key, async (/** @type {any} */ row) => {
    if (!row || row.status !== 'ready')
      throw new Error('Provider authorization required_configuration');
    const grant = unseal(row.encrypted, context, crypto);
    try {
      const value =
        grant.kind === 'garmin_personal'
          ? await garminPersonalCredential(grant, options)
          : await githubInstallationCredential(grant, options);
      return {
        value,
        ...(value !== grant ? { patch: { encrypted: seal(value, context, crypto) } } : {})
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('reauthorize'))
        return { patch: { status: 'reauthorize' }, error: 'reauthorize' };
      throw error;
    }
  });
  if (result.error) throw new Error('Provider reauthorize');
  return result.value;
}

/** Revoke under the same lock as refresh so a rotated token cannot escape disconnect.
 * @param {any} store @param {{crypto:{key:string,keyId:string},clientId:string,auth0Domain:string,fetchImpl?:typeof fetch}} options */
export async function disconnectFulcraCredential(
  store,
  { crypto, clientId, auth0Domain, fetchImpl = fetch }
) {
  await store.pauseAllConnections();
  const result = await store.withGrantLock('fulcra', async (/** @type {any} */ row) => {
    if (!row || row.status === 'disconnected') return { value: 'disconnected' };
    const grant = unseal(row.encrypted, `${store.deploymentId}:${store.ownerId}:fulcra`, crypto);
    let revoked = false;
    try {
      const response = await fetchImpl(`https://${auth0Domain}/oauth/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, token: grant.refresh_token }),
        signal: AbortSignal.timeout(10000)
      });
      revoked = response.ok;
    } catch {
      /* Keep the credential disabled while remote revocation is retried. */
    }
    const status = revoked ? 'disconnected' : 'revocation_pending';
    return {
      value: status,
      patch: {
        status,
        ...(revoked
          ? {
              encrypted: seal({}, `${store.deploymentId}:${store.ownerId}:fulcra`, crypto),
              expiresAt: null
            }
          : {})
      }
    };
  });
  return result.value;
}
