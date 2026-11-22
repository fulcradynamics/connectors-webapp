import { getWritable } from 'workflow';
import { start, resumeHook } from 'workflow/api';
import { reenqueueRun } from '@workflow/core/runtime';
import { getWorld } from 'workflow/runtime';
import { nativeController } from './native-controller.js';
import { executeCommand, cryptoOptions } from '../src/lib/server/native/commands.js';
import {
  publicState,
  stage,
  unstage,
  cacheResult,
  commandResult
} from '../src/lib/server/native/state.js';
import { seal, unseal } from '../src/lib/server/secrets.js';
import { advanceWorker } from '../src/lib/server/native/worker.js';
/** @param {any} state @param {any} command */
export async function applyCommand(state, command) {
  'use step';
  if (!state.commands[command.id]) {
    const input = unseal(
      command.envelope,
      `${state.deploymentId}:${state.ownerId}:native-command`,
      cryptoOptions()
    );
    const result = await executeCommand(state, input);
    cacheResult(state, command.id, result, cryptoOptions());
  }
  // Bound retained completed command results without dropping recent ambiguous operations.
  for (const [id, value] of Object.entries(state.commands))
    if (id !== command.id && /** @type {any} */ (value).at < Date.now() - 86400000)
      delete state.commands[id];
  return state;
}
applyCommand.maxRetries = 0;
/** @param {any} state @param {any} command */
export async function operationFailure(state, command) {
  'use step';
  // A failed command may have exchanged a rotating token; never blindly resume it.
  if (state.grants.fulcra) {
    state.grants.fulcra.status = 'refresh_uncertain';
    for (const c of /** @type {any[]} */ (Object.values(state.connections)))
      if (c.status === 'ready') {
        c.status = 'paused';
        c.generation++;
      }
  }
  state.commands[command.id] = {
    at: Date.now(),
    error: 'Operation outcome uncertain; check status and reauthorize background sync'
  };
  return state;
}
/** @param {any} state @param {any} command */
export async function replyToCommand(state, command) {
  'use step';
  const result = commandResult(state, command.id, cryptoOptions());
  try {
    await resumeHook(command.replyToken, result);
  } catch {
    /* A client timeout never undoes the committed command. */
  }
}
/** @param {any} state @param {string|undefined} nextRunId */
export async function publishState(state, nextRunId = undefined) {
  'use step';
  const writer = getWritable({ namespace: 'state' }).getWriter();
  try {
    await writer.write({
      view: publicState(state),
      server: seal(
        state,
        `${state.deploymentId}:${state.ownerId}:native-snapshot`,
        cryptoOptions()
      ),
      nextRunId
    });
  } finally {
    writer.releaseLock();
  }
}
/** @param {any} state @param {string} token @returns {Promise<string>} */
export async function startSuccessor(state, token) {
  'use step';
  return (await start(nativeController, [state, token], { deploymentId: 'latest' })).runId;
}
/** Re-deliver only an existing pending successor after its pointer is durable.
 * This separate step retries the same run and never repeats successor creation.
 * @param {string} runId */
export async function wakeSuccessor(runId) {
  'use step';
  const world = await getWorld();
  const run = await world.runs.get(runId, { resolveData: 'none' });
  if (run.status === 'pending') await reenqueueRun(world, runId);
}
/** @param {string} token @param {any} command */
export async function sendCommand(token, command) {
  'use step';
  try {
    await resumeHook(token, command);
  } catch {
    /* Handoff/in-flight delivery: retry the same command ID. */
  }
}
/** @param {any} state */
export async function workPhase(state) {
  'use step';
  return advanceWorker(state);
}
workPhase.maxRetries = 0;

/** @param {any} state */
export async function workFailure(state) {
  'use step';
  if (state.grants.fulcra?.status === 'refreshing') {
    state.grants.fulcra.status = 'refresh_uncertain';
    for (const c of /** @type {any[]} */ (Object.values(state.connections)))
      if (c.status === 'ready') {
        c.status = 'paused';
        c.generation++;
      }
  }
  state.lastError = 'Native phase interrupted; retained intents require reconciliation';
  if (state.active) {
    const c = state.connections[state.active.connectionId];
    if (c) c.nextDue = Date.now() + 30000;
    state.active = null;
  }
  return state;
}
