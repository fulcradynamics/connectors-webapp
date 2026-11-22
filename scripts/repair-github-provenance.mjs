// Owner-run, file-only repair of one independently bound historical GitHub copy.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { acquireRepairLock } from './lib/repair-lock.mjs';
import { token, ownerId, readState } from './lib/fulcra.mjs';
import { FulcraClient } from '../src/lib/server/fulcra.js';
import {
  githubRepairTarget,
  planGitHubRepair,
  advanceGitHubRepair
} from '../src/lib/server/connectors/github-provenance-repair.js';
const args = process.argv.slice(2),
  allowed = new Set(['--connection', '--record', '--apply']);
let connectionId,
  recordId,
  apply = false;
for (let n = 0; n < args.length; n++) {
  const flag = args[n];
  if (!allowed.has(flag)) throw Error('Use --connection UUID --record UUID [--apply]');
  if (flag === '--apply') apply = true;
  else if (flag === '--connection') connectionId = args[++n];
  else recordId = args[++n];
}
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
assert(
  uuid.test(connectionId ?? '') && uuid.test(recordId ?? ''),
  'Exact connection and existing v1 record UUIDs required'
);
const env = parseEnv(await readFile('.env', 'utf8')),
  deployment = await readState(),
  owner = ownerId();
assert.equal(env.OWNER_USER_ID, owner, 'Use this deployment owner account');
const domain = deployment.project?.domain;
assert(
  typeof domain === 'string' && /^[a-z0-9-]+\.my\.fulcra\.ai$/.test(domain),
  'Existing Fulcra deployment required'
);
const base = 'https://' + domain,
  access = token();
const connection = async () => {
  const r = await fetch(base + '/api/connections/' + connectionId, {
    headers: { Cookie: 'fulcra_access_token=' + access },
    signal: AbortSignal.timeout(25000)
  });
  if (!r.ok) throw Error('Owner connection read returned ' + r.status);
  return (await r.json()).connection;
};
const c = await connection();
assert.equal(c.connector, 'github');
assert(
  c.config.route.mode === 'both' && /^Event\//.test(c.config.route.recordType),
  'Repair requires independently recorded v1 source evidence; file-only copies need source reprocessing'
);
const client = new FulcraClient({
  endpoint: 'https://api.fulcradynamics.com/',
  accessToken: access,
  deadline: Date.now() + 60000
});
const record = await client.readRecord(c.config.route.recordType, recordId);
assert(record, 'Existing source record required');
const target = githubRepairTarget(c, record, owner),
  before = (await client.fileState(target.path, { maxBytes: 256 * 1024 })).file;
const plan = planGitHubRepair(c, record, owner, before);
const summary = {
  mode: apply ? 'apply' : 'dry-run',
  source_id: target.source_id,
  path: target.path,
  recordId,
  sourceRecordUntouched: true,
  providerWrites: 0
};
if (!apply) {
  console.log(
    JSON.stringify({
      ...summary,
      status: plan.status,
      requiresPausedConnection: plan.status === 'ready'
    })
  );
} else {
  assert.equal(
    c.status,
    'paused',
    'Pause this existing connection before --apply; retain its settings and resume afterward'
  );
  const dir = '.private/github-provenance-repairs',
    path = `${dir}/${connectionId}-${recordId}.json`;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const releaseLock = await acquireRepairLock(path + '.lock');
  try {
    let saved;
    try {
      saved = JSON.parse(await readFile(path, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (saved) {
      assert.equal(
        saved.scope_hash,
        target.scope_hash,
        'Repair scope changed; retain the old intent for review'
      );
      assert.equal(saved.path, target.path);
      assert.equal(saved.intent.file.content, target.content, 'Bound source evidence changed');
    }
    if (plan.status === 'unchanged' && (!saved || saved.complete)) {
      console.log(JSON.stringify({ ...summary, status: 'unchanged', fileId: before.id }));
    } else {
      saved ??= { scope_hash: target.scope_hash, path: target.path, recordId, intent: plan.intent };
      assert(saved.intent, 'Retained repair intent required');
      const save = async () => {
        await writeFile(path + '.tmp', JSON.stringify(saved), { mode: 0o600 });
        await rename(path + '.tmp', path);
      };
      await save();
      try {
        assert(!saved.needsReview, 'Intervening version retained; review before any retry');
        let verified = false;
        for (let n = 0; n < 10; n++) {
          const current = await connection();
          assert.equal(
            current.status,
            'paused',
            'Collector resumed; pause before continuing this retained repair'
          );
          assert.equal(
            githubRepairTarget(current, record, owner).scope_hash,
            saved.scope_hash,
            'Connection scope changed'
          );
          const outcome = await advanceGitHubRepair(saved.intent, client);
          await save();
          if (outcome === 'changed') {
            saved.needsReview = true;
            await save();
            throw Error('Repair file changed; retained intent needs review');
          }
          if (outcome === 'verified') {
            const actual = await client.fileState(target.path, { maxBytes: 256 * 1024 });
            assert.equal(actual.file?.content, target.content);
            assert.equal(actual.file.id, saved.intent.file.file.id);
            saved.complete = true;
            saved.verifiedFileId = actual.file.id;
            await save();
            verified = true;
            console.log(
              JSON.stringify({
                ...summary,
                status: 'verified',
                fileId: actual.file.id,
                retainedIntent: path
              })
            );
            break;
          }
        }
        assert(verified, 'Repair is pending; preserve and rerun the same intent after inspection');
      } catch (e) {
        await save();
        throw e;
      }
    }
  } finally {
    await releaseLock();
  }
}
