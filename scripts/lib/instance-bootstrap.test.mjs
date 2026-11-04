import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

const company = '00000000-0000-4000-8000-000000000001';
const member = '00000000-0000-4000-8000-000000000002';
const type = 'Event/00000000-0000-4000-8000-000000000003';
const scripts = resolve('scripts');

async function installation(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'connector-company-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, '.env.example'), 'OWNER_USER_ID=""\nCONNECTORS_BACKEND="workflow"\n');
  const cli = join(cwd, 'fake-fulcra.mjs');
  await writeFile(
    cli,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.ACCEPTANCE_LOG, JSON.stringify({cli:process.argv.slice(2)})+'\\n');
if(process.argv[2]==='user-info') console.log(JSON.stringify({userid:process.env.ACCEPTANCE_USER}));
else if(process.argv[2]==='data-type') console.log(JSON.stringify({id:${JSON.stringify(type)}}));
else if(process.argv[2]==='auth') console.log('synthetic-test-token');
else process.exit(2);
`,
    { mode: 0o700 }
  );
  const loader = join(cwd, 'no-real-network.mjs');
  await writeFile(
    loader,
    `import {appendFileSync} from 'node:fs';
globalThis.fetch=async(url,options={})=>{
 appendFileSync(process.env.ACCEPTANCE_LOG,JSON.stringify({url:String(url),method:options.method??'GET'})+'\\n');
 if(String(url).endsWith('/input/v1/data_type'))return Response.json([]);
 if(String(url).endsWith('/user/v1alpha1/info'))return Response.json({userid:process.env.ACCEPTANCE_TOKEN_USER??process.env.ACCEPTANCE_USER});
 if(String(url).includes('/data/v1/catalog/'))return Response.json({properties:{evidence:{type:'string'}}});
 throw Error('Unexpected network call blocked by acceptance fixture');
};`
  );
  const log = join(cwd, 'effects.jsonl');
  await writeFile(log, '');
  const run = (name, args = [], user = company, extra = {}) =>
    spawnSync(process.execPath, ['--import', loader, join(scripts, name), ...args], {
      cwd,
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, FULCRA_CLI: cli, ACCEPTANCE_LOG: log, ACCEPTANCE_USER: user, ...extra }
    });
  const effects = async () =>
    (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const statePath = join(cwd, '.private/deployment.json');
  const saveState = async (state) => {
    await mkdir(join(cwd, '.private'), { recursive: true });
    await writeFile(statePath, JSON.stringify(state));
  };
  return { cwd, run, effects, saveState, statePath };
}

test('first company harness and environment use the verified account and retain keys on repeat', async (t) => {
  const f = await installation(t);
  const harness = f.run('harness.mjs', ['init']);
  assert.equal(harness.status, 0, harness.stderr);
  assert.deepEqual(JSON.parse(await readFile(f.statePath, 'utf8')), {
    ownerId: company,
    harnessType: type
  });
  const init = f.run('init-env.mjs');
  assert.equal(init.status, 0, init.stderr);
  const before = await readFile(join(f.cwd, '.env'), 'utf8'),
    values = parseEnv(before);
  assert.equal(values.OWNER_USER_ID, company);
  assert.equal(values.HARNESS_DATA_TYPE, type);
  assert.equal(Buffer.from(values.CREDENTIAL_ENCRYPTION_KEY, 'base64').length, 32);
  assert.ok(values.CONNECTORS_DEPLOYMENT_ID);
  assert.equal(f.run('init-env.mjs').status, 0);
  assert.equal(await readFile(join(f.cwd, '.env'), 'utf8'), before);
  assert.ok(!init.stdout.includes(values.CREDENTIAL_ENCRYPTION_KEY));
});

test('missing CLI prerequisite leaves environment and deployment state absent', async (t) => {
  const f = await installation(t);
  const result = f.run('init-env.mjs', [], company, { FULCRA_CLI: join(f.cwd, 'missing-cli') });
  assert.notEqual(result.status, 0);
  await assert.rejects(readFile(join(f.cwd, '.env')), { code: 'ENOENT' });
  await assert.rejects(readFile(f.statePath), { code: 'ENOENT' });
  assert.deepEqual(await f.effects(), []);
});

test('wrong account cannot reuse company environment or rotate its identity', async (t) => {
  const f = await installation(t);
  assert.equal(f.run('init-env.mjs').status, 0);
  const before = await readFile(join(f.cwd, '.env'), 'utf8');
  const result = f.run('init-env.mjs', [], member);
  assert.notEqual(result.status, 0, 'a member login must not pass company initialization');
  assert.match(result.stderr, /owner|account/i);
  assert.equal(await readFile(join(f.cwd, '.env'), 'utf8'), before);
});

test('copied company state cannot initialize an environment under a member account', async (t) => {
  const f = await installation(t);
  await f.saveState({ ownerId: company, harnessType: type });
  const before = await readFile(f.statePath, 'utf8');
  assert.notEqual(f.run('init-env.mjs', [], member).status, 0);
  await assert.rejects(readFile(join(f.cwd, '.env')), { code: 'ENOENT' });
  assert.equal(await readFile(f.statePath, 'utf8'), before);
});

test('unknown authenticated identity cannot create owner or secrets', async (t) => {
  const f = await installation(t);
  assert.notEqual(f.run('init-env.mjs', [], '').status, 0);
  await assert.rejects(readFile(join(f.cwd, '.env')), { code: 'ENOENT' });
});

test('harness rejects a different account before any remote schema/type operation', async (t) => {
  const f = await installation(t);
  await f.saveState({ ownerId: company, harnessType: type });
  const before = await readFile(f.statePath, 'utf8');
  const result = f.run('harness.mjs', ['init'], member);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /owner|account/i);
  assert.equal(await readFile(f.statePath, 'utf8'), before);
  assert.equal((await f.effects()).filter((x) => x.url || x.cli?.[0] === 'data-type').length, 0);
});

test('deployment rejects configured company/member mismatch before namespace or token effects', async (t) => {
  const f = await installation(t);
  assert.equal(f.run('init-env.mjs').status, 0);
  const before = await readFile(join(f.cwd, '.env'), 'utf8');
  const result = f.run('deploy.mjs', [], member, { FULCRA_PROJECT_NAME: 'synthetic-company' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /owner|account/i);
  assert.equal((await f.effects()).filter((x) => x.url || x.cli?.[0] === 'auth').length, 0);
  assert.equal(await readFile(join(f.cwd, '.env'), 'utf8'), before);
  await assert.rejects(readFile(f.statePath), { code: 'ENOENT' });
});

test('deployment verifies the exact deployment token even if CLI identity was checked earlier', async (t) => {
  const f = await installation(t);
  assert.equal(f.run('init-env.mjs').status, 0);
  const result = f.run('deploy.mjs', [], company, {
    FULCRA_PROJECT_NAME: 'synthetic-company',
    ACCEPTANCE_TOKEN_USER: member
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /owner|account/i);
  const remote = (await f.effects()).filter((x) => x.url);
  assert.deepEqual(
    remote.map((x) => x.url),
    ['https://api.fulcradynamics.com/user/v1alpha1/info']
  );
  await assert.rejects(readFile(f.statePath), { code: 'ENOENT' });
});
