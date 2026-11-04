import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { deploymentEnvironment } from './lib/deploy-env.mjs';
import { deployFulcra } from './lib/deploy-fulcra.mjs';
import { readState, saveState, token, ownerId } from './lib/fulcra.mjs';
import { verifyInstanceOwner } from './lib/instance-owner.mjs';

const state = await readState();
const projectName = process.env.FULCRA_PROJECT_NAME || state.project?.name;
if (!projectName)
  throw Error('Set FULCRA_PROJECT_NAME to your own authorized namespace before first deployment');
let values = deploymentEnvironment(parseEnv(await readFile('.env', 'utf8')));
if (!values.OWNER_USER_ID) throw Error('Run init-env before deployment to bind the verified owner');
verifyInstanceOwner(ownerId(), values.OWNER_USER_ID, state.ownerId);
async function deploy(values) {
  const result = await deployFulcra({
    name: projectName,
    framework: 'sveltekit',
    expectedDomain: process.env.FULCRA_EXPECTED_DOMAIN || state.project?.domain,
    values,
    expectedOwnerId: values.OWNER_USER_ID,
    accessToken: token(),
    stateFile: '.private/deployment.json'
  });
  Object.assign(state, await readState());
  console.log(
    JSON.stringify({
      domain: result.project.domain,
      projectId: result.project.id,
      runtimePreflight: 'verified'
    })
  );
}
if (values.CONNECTORS_BACKEND === 'workflow' && !values.CONNECTORS_NATIVE_ROOT_RUN_ID) {
  if (!values.CONNECTORS_NATIVE_BOOTSTRAP_SECRET)
    throw Error('Run init-env before native deployment');
  values.CONNECTORS_NATIVE_ALLOW_BOOTSTRAP = '1';
}
await deploy(values);
if (values.CONNECTORS_BACKEND === 'workflow' && !values.CONNECTORS_NATIVE_ROOT_RUN_ID) {
  const base = `https://${state.project.domain}`;
  const before = await fetch(base + '/api/setup', {
    headers: { Cookie: 'fulcra_access_token=' + token() }
  });
  console.log(JSON.stringify({ nativeInitialSetupStatus: before.status }));
  const initialized = await fetch(base + '/api/native/initialize', {
    method: 'POST',
    headers: {
      Cookie: 'fulcra_access_token=' + token(),
      Origin: base,
      'X-Bootstrap-Secret': values.CONNECTORS_NATIVE_BOOTSTRAP_SECRET
    },
    signal: AbortSignal.timeout(60000)
  });
  if (!initialized.ok)
    throw Error(
      `Native initialization returned ${initialized.status}; preserve marker/project, do not reset instance identity`
    );
  const result = await initialized.json();
  if (!/^wrun_[0-9A-HJKMNP-TV-Z]{26}$/.test(result.runId))
    throw Error('Unexpected native controller identity');
  state.nativeControllerRunId = result.runId;
  await saveState(state);
  let source = await readFile('.env', 'utf8');
  for (const [key, value] of Object.entries({
    CONNECTORS_NATIVE_ROOT_RUN_ID: result.runId,
    CONNECTORS_NATIVE_ALLOW_BOOTSTRAP: '0'
  })) {
    const line = `${key}=${JSON.stringify(value)}`,
      pattern = new RegExp('^' + key + '=.*$', 'm');
    source = pattern.test(source) ? source.replace(pattern, line) : source + '\n' + line + '\n';
    values[key] = value;
  }
  await writeFile('.env', source, { mode: 0o600 });
  console.log(
    'Native controller initialized and marker read back; pinning its identity and disabling first-deploy bootstrap.'
  );
  await deploy(values);
}
