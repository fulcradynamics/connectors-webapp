import { adapters } from './connectors/index.js';
import { githubInstallationCredential } from './connectors/github-auth.js';
import { garminPersonalCredential } from './connectors/garmin-auth.js';
/** Select auth handling from the server-checked connector, never a caller's credential kind.
 * @param {keyof typeof adapters} connector @param {any} input @param {{fetchImpl?:typeof fetch}} options */
export async function enrollProviderCredential(connector, input = {}, options = {}) {
  if (
    connector === 'attio' &&
    (typeof input?.token !== 'string' || !input.token || /[\r\n]/.test(input.token))
  )
    throw Error('Attio token credential required_configuration');
  let credential;
  if (connector === 'garmin') {
    credential = await garminPersonalCredential(
      { kind: 'garmin_personal', apiKey: input.token },
      options
    );
  } else {
    if (input.kind && !(connector === 'github' && input.kind === 'github_app'))
      throw Error('Invalid credential kind');
    credential =
      connector === 'github'
        ? await githubInstallationCredential(input, options)
        : connector === 'attio'
          ? { token: input.token }
          : input;
  }
  const verified = await adapters[connector].validate(credential);
  if (!verified.accountId) throw Error('Stable source account identity required_configuration');
  if (connector === 'garmin') {
    const details = /** @type {{accountId:string,timeZone:string}} */ (verified);
    credential = { ...credential, accountId: details.accountId, timeZone: details.timeZone };
  }
  if (connector === 'attio') {
    const details = /** @type {{accountId:string,workspaceId:string,scopes:string[]}} */ (verified);
    if (
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(details.workspaceId) ||
      details.accountId !== details.workspaceId ||
      !Array.isArray(details.scopes) ||
      details.scopes.some(
        (scope) => typeof scope !== 'string' || !/^[a-z_]+:read(?:-write)?$/.test(scope)
      ) ||
      new Set(details.scopes).size !== details.scopes.length
    )
      throw Error('Attio verified workspace identity and scopes required_configuration');
    credential = {
      token: credential.token,
      workspaceId: details.workspaceId,
      scopes: [...details.scopes]
    };
  }
  return { credential, accountId: verified.accountId };
}
