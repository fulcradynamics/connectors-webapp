import { it, expect, vi } from 'vitest';
import { seal } from '../secrets.js';
import { freshState, stage } from './state.js';
const mocks = vi.hoisted(() => ({ getRun: vi.fn(), getHookByToken: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({
  env: {
    CONNECTORS_BACKEND: 'workflow',
    CONNECTORS_DEPLOYMENT_ID: 'test',
    OWNER_USER_ID: 'owner',
    CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    CONNECTORS_NATIVE_ROOT_RUN_ID: 'wrun_' + '0'.repeat(26)
  }
}));
vi.mock('../owner.js', () => ({
  requireOwner: async () => ({ userId: 'owner', accessToken: 'token' })
}));
vi.mock('workflow/api', () => ({ ...mocks, start: vi.fn() }));
import { nativeHTTP } from './http.js';
const crypto = { key: Buffer.alloc(32, 7).toString('base64'), keyId: 'v1' },
  id = '11111111-1111-4111-8111-111111111111';
/** @param {boolean} known */
async function interrupted(known) {
  const state = freshState('test', 'owner');
  if (known)
    state.commands[id] = {
      at: Date.now(),
      result: stage(
        state,
        'result:' + id,
        { httpStatus: 201, body: { connection: { id: 'created' } } },
        crypto
      )
    };
  const controller = 'wrun_' + '0'.repeat(26),
    operation = 'wrun_' + '1'.repeat(26);
  mocks.getHookByToken.mockResolvedValue({ runId: controller });
  mocks.getRun.mockImplementation((runId) =>
    runId === operation
      ? { status: 'cancelled' }
      : {
          status: 'running',
          getReadable: () =>
            Object.assign(
              new ReadableStream({
                start(c) {
                  c.enqueue({ server: seal(state, 'test:owner:native-snapshot', crypto) });
                  c.close();
                }
              }),
              { getTailIndex: async () => 0 }
            )
        }
  );
  const ticket = seal(
    { runId: operation, commandId: id, expiresAt: Date.now() + 600000 },
    'test:owner:native-operation',
    crypto
  );
  const url = new URL(
    'https://app.example/api/native/operations/' +
      Buffer.from(JSON.stringify(ticket)).toString('base64url')
  );
  const response = await nativeHTTP({ url, request: new Request(url), cookies: {} });
  if (!response) throw Error('Operation route was not handled');
  return response.json();
}
it('recovers a committed command after its operation workflow was cancelled', async () => {
  expect(await interrupted(true)).toMatchObject({
    done: true,
    httpStatus: 201,
    body: { connection: { id: 'created' } }
  });
});
it('keeps an interrupted unknown command uncertain and retryable with its original ID', async () => {
  expect(await interrupted(false)).toMatchObject({
    done: true,
    httpStatus: 503,
    body: { uncertain: true, retrySameCommand: true, operationId: id }
  });
});
