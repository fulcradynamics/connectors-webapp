import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { ownerId, readState } from './lib/fulcra.mjs';
import { verifyInstanceOwner } from './lib/instance-owner.mjs';
let source;
try {
  source = await readFile('.env', 'utf8');
} catch {
  source = await readFile('.env.example', 'utf8');
}
const values = parseEnv(source),
  state = await readState();
const verifiedOwner = verifyInstanceOwner(ownerId(), values.OWNER_USER_ID, state.ownerId);
const defaults = {
  OWNER_USER_ID: verifiedOwner,
  HARNESS_DATA_TYPE: state.harnessType || '',
  CONNECTORS_DEPLOYMENT_ID: randomUUID(),
  CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  CREDENTIAL_KEY_ID: 'v1',
  CRON_SECRET: randomBytes(32).toString('base64url'),
  CONNECTORS_NATIVE_BOOTSTRAP_SECRET: randomBytes(32).toString('base64url')
};
for (const [key, value] of Object.entries(defaults))
  if (!values[key]) {
    const line = `${key}=${JSON.stringify(value)}`;
    const pattern = new RegExp('^' + key + '=.*$', 'm');
    source = pattern.test(source) ? source.replace(pattern, line) : source + '\n' + line + '\n';
  }
await writeFile('.env', source, { mode: 0o600 });
await chmod('.env', 0o600);
console.log(
  'Local server values initialized without printing secrets. Native Workflow deployments initialize their backing automatically; PostgreSQL is an optional alternate backend.'
);
