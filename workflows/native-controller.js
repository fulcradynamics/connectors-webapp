import { createHook, sleep, getWorkflowMetadata } from 'workflow';
import {
  applyCommand,
  publishState,
  replyToCommand,
  startSuccessor,
  wakeSuccessor,
  workPhase,
  sendCommand,
  operationFailure,
  workFailure
} from './native-steps.js';
/** @param {any} state @param {string} token @returns {Promise<any>} */
export async function nativeController(state, token) {
  'use workflow';
  const hook = createHook({ token, experimental_minRetention: '30d' }),
    conflict = await hook.getConflict();
  if (conflict) return { duplicateRunId: conflict.runId };
  const iterator = hook[Symbol.asyncIterator]();
  let next = iterator.next();
  await publishState(state);
  for (let transition = 0; transition < 500; transition++) {
    const event = await Promise.race([
      next.then((value) => ({ kind: 'command', value })),
      sleep(
        state.active
          ? 1
          : Math.max(
              1000,
              Math.min(
                3600000,
                Math.min(
                  ...Object.values(state.connections)
                    .filter((/** @type {any} */ c) => c.status === 'ready' && c.nextDue !== null)
                    .map((/** @type {any} */ c) => c.nextDue),
                  state.grants?.fulcra?.status === 'ready'
                    ? (state.knowledgeSources?.nextDue ?? Date.now() + 60000)
                    : Date.now() + 3600000,
                  state.probe?.dueAt ?? Date.now() + 3600000
                ) - Date.now()
              )
            )
      ).then(() => ({ kind: 'tick' }))
    ]);
    if (event.kind === 'command') {
      const incoming = /** @type {any} */ (event).value;
      if (incoming.done) break;
      next = iterator.next();
      const command = incoming.value;
      try {
        state = await applyCommand(state, command);
      } catch {
        state = await operationFailure(state, command);
      }
      await publishState(state);
      await replyToCommand(state, command);
    } else {
      try {
        state = await workPhase(state);
      } catch {
        state = await workFailure(state);
      }
      await publishState(state);
    }
    if (state.rolloverRequested) {
      delete state.rolloverRequested;
      break;
    }
  }
  // The caller retries its stable command ID if delivery raced this handoff.
  hook.dispose();
  state.epoch++;
  const nextRunId = await startSuccessor(state, token);
  await publishState(state, nextRunId);
  await wakeSuccessor(nextRunId);
  return { nextRunId };
}
/** @param {string} token @param {string} id @param {any} envelope */
export async function nativeOperation(token, id, envelope) {
  'use workflow';
  const replyToken = `connectors:reply:${getWorkflowMetadata().workflowRunId}`;
  const hook = createHook({ token: replyToken });
  await hook.getConflict();
  const response = Promise.resolve(hook);
  for (let attempt = 0; attempt < 8; attempt++) {
    await sendCommand(token, { id, replyToken, envelope });
    const result = await Promise.race([
      response.then((body) => ({ done: true, body })),
      sleep('15s').then(() => ({ done: false }))
    ]);
    if (result.done) {
      hook.dispose();
      return /** @type {any} */ (result).body;
    }
  }
  hook.dispose();
  return {
    httpStatus: 503,
    body: {
      message: 'Operation is unresolved; preserve its operation ID and check before retrying',
      operationId: id
    }
  };
}
