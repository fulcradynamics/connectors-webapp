import { providerHTTP } from './http.js';
export const GARMIN_BASE = 'https://personal.connectapi.garmin.com/';
/** Personal keys do not rotate during exchange. Renewal stays under the existing grant lock.
 * @param {any} credential @param {{fetchImpl?:typeof fetch}} options */
export async function garminPersonalCredential(credential, { fetchImpl = fetch } = {}) {
  if (credential.token && Date.parse(credential.expiresAt) > Date.now() + 60000) return credential;
  if (
    typeof credential.apiKey !== 'string' ||
    !credential.apiKey.trim() ||
    credential.apiKey.length > 16000 ||
    /[\r\n]/.test(credential.apiKey)
  )
    throw Error('Garmin Personal API key required_configuration');
  let data;
  try {
    ({ data } = await providerHTTP({ base: GARMIN_BASE, credential: {}, fetchImpl })(
      'personalapitoken-service/personal-api/personal-api-key/token',
      { method: 'POST', headers: { Authorization: 'ApiKey ' + credential.apiKey } }
    ));
  } catch (error) {
    if (error instanceof Error && error.message.includes('reauthorize'))
      throw Error('Garmin reauthorize');
    throw error;
  }
  const token = data?.access_token ?? data?.accessToken;
  if (typeof token !== 'string' || !token || token.length > 32000 || /\s/.test(token))
    throw Error('Invalid Garmin access token response');
  const now = Date.now();
  let expires = now + 86400000;
  if (data.expires_in !== undefined) {
    const seconds = Number(data.expires_in);
    if (!Number.isFinite(seconds) || seconds <= 60) throw Error('Invalid Garmin token expiry');
    expires = Math.min(expires, now + seconds * 1000);
  }
  // The trusted provider may return a JWT. Its expiry is only a conservative cache bound,
  // never proof of account identity or an authorization decision.
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    if (Number.isFinite(claims.exp)) expires = Math.min(expires, claims.exp * 1000);
  } catch {
    /* Opaque access tokens are also supported. */
  }
  if (expires <= now + 60000) throw Error('Invalid Garmin token expiry');
  return {
    ...credential,
    kind: 'garmin_personal',
    token,
    expiresAt: new Date(expires).toISOString()
  };
}
