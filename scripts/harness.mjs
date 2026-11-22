import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRunEvent, ingestRunEvent } from './lib/harness-events.mjs';
import { verifyInstanceOwner } from './lib/instance-owner.mjs';
import { cli, request, readState, saveState, ownerId, verifyRecord, uploadWorkspace } from './lib/fulcra.mjs';

const [command, ...args] = process.argv.slice(2);
const state = await readState();
const namespace = 'com.fulcradynamics.connectors.harness.v1';
if (command === 'init') {
  const configured = await readFile('.env', 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  state.ownerId = verifyInstanceOwner(ownerId(), parseEnv(configured).OWNER_USER_ID, state.ownerId);
  if (!state.harnessType) {
    const types = await request('/input/v1/data_type');
    const existing = types.filter(x => x.description === namespace && x.api_version === 'v1');
    if (existing.length > 1) throw new Error('Ambiguous existing harness types; resolve canonical ID');
    if (existing.length) state.harnessType = existing[0].id;
    else {
      const properties = Object.fromEntries(['run_id','milestone_id','role','step','status','detail','evidence','revision'].map(k => [k, { type: 'string', minLength: 1 }]));
      const fields = JSON.stringify({ type: 'object', properties, required: Object.keys(properties) });
      const result = JSON.parse(execFileSync(cli, ['data-type','create','Event','Harness Runs: connectors-webapp','--description',namespace,'--fields',fields], { encoding:'utf8', stdio:['ignore','pipe','pipe'] }));
      state.harnessType = result.id;
    }
    await saveState(state); // persist the canonical ID before any next action
  }
  const schema = await request(`/data/v1/catalog/${encodeURIComponent(state.harnessType)}/v1/schema`);
  if (!schema.properties?.evidence) throw new Error('Harness custom schema not visible');
  console.log(JSON.stringify({ harnessType: state.harnessType, schemaFields: Object.keys(schema.properties), ownerConfigured: !!state.ownerId }));
} else if (command === 'start') {
  state.runId = randomUUID(); state.milestone = args[0] || 'M1'; state.runStartedAt = new Date().toISOString();
  await saveState(state);
  console.log(JSON.stringify({ runId: state.runId, milestone: state.milestone }));
} else if (command === 'event') {
  const [role, step, status, detail, evidence] = args;
  if (!state.runId || !state.harnessType) throw new Error('Initialize and start a run first');
  const revision = execFileSync('git', ['rev-parse','HEAD'], { encoding:'utf8' }).trim();
  const record = createRunEvent({ run_id: state.runId, milestone_id: state.milestone, role, step, status, detail, evidence, revision });
  await mkdir('.private/events', {recursive:true, mode:0o700});
  await writeFile(`.private/events/${record.id}.json`, JSON.stringify(record), {mode:0o600});
  const receipt = await ingestRunEvent(request, state.harnessType, record);
  const readback = await verifyRecord(state.harnessType, record.id);
  if (readback.evidence !== evidence || readback.run_id !== state.runId) throw new Error('Run event readback mismatch');
  console.log(JSON.stringify({ eventId: record.id, uploadId: receipt.upload_id, verified: true, step, status }));
} else if (command === 'workspace') {
  for (const [local, name] of [
    ['docs/plan.md','plan.md'],['docs/design.md','spec.md'],['docs/decisions.md','decisions.md'],['docs/progress.md','progress.md'],['docs/overview.md','overview.md'],['docs/outstanding-issues.md','outstanding-issues.md']
  ]) { await uploadWorkspace(local, `workspace/connectors-webapp/${name}`); console.log(`Verified workspace ${name}`); }
} else if (command === 'verify') {
  const record = JSON.parse(await readFile(`.private/events/${args[0]}.json`,'utf8'));
  const found = await verifyRecord(state.harnessType, record.id);
  console.log(JSON.stringify({ eventId: found.id, verified: found.evidence === record.evidence }));
} else throw new Error('Commands: init | start MILESTONE | event ROLE STEP STATUS DETAIL EVIDENCE | workspace | verify EVENT_ID');
