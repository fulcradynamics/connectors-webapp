import { beforeEach, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  start: vi.fn(),
  wake: vi.fn(),
  dispose: vi.fn(),
  sleep: vi.fn(),
  calls: /** @type {string[]} */ ([])
}));
// Execute the actual workflow body with controlled collaborators. The normal
// Vite workflow transform intentionally prohibits invoking a workflow directly.
const source = readFileSync(
  new URL('../../../../workflows/native-controller.js', import.meta.url),
  'utf8'
);
const body = source
  .slice(source.indexOf('/** @param {any} state'))
  .replaceAll('export async function', 'async function');
const nativeController = new Function(
  'createHook',
  'sleep',
  'steps',
  `const { applyCommand, publishState, replyToCommand, startSuccessor, wakeSuccessor, workPhase, sendCommand, operationFailure, workFailure } = steps; ${body}; return nativeController;`
)(
  () => ({
    getConflict: async () => null,
    [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    dispose: mocks.dispose
  }),
  async (/** @type {number} */ duration) => {
    mocks.sleep(duration);
  },
  {
    publishState: mocks.publish,
    startSuccessor: mocks.start,
    wakeSuccessor: mocks.wake,
    workPhase: async (/** @type {any} */ state) => state
  }
);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.start.mockImplementation(async () => {
    mocks.calls.push('start');
    return 'same-successor';
  });
  mocks.publish.mockImplementation(async (_state, id) => {
    if (id) mocks.calls.push('publish:' + id);
  });
  mocks.wake.mockImplementation(async (id) => {
    mocks.calls.push('wake:' + id);
  });
});
it('publishes the successor pointer before a separate persisted wake', async () => {
  const state = { connections: {}, epoch: 0, rolloverRequested: true };
  await expect(nativeController(state, 'token')).resolves.toEqual({ nextRunId: 'same-successor' });
  expect(mocks.calls).toEqual(['start', 'publish:same-successor', 'wake:same-successor']);
  expect(mocks.start).toHaveBeenCalledTimes(1);
});
it('leaves the published pointer intact when the separate wake fails', async () => {
  mocks.wake.mockRejectedValueOnce(Error('wake failed'));
  await expect(
    nativeController({ connections: {}, epoch: 0, rolloverRequested: true }, 'token')
  ).rejects.toThrow('wake failed');
  expect(mocks.start).toHaveBeenCalledTimes(1);
  expect(mocks.publish).toHaveBeenLastCalledWith(
    expect.objectContaining({ epoch: 1 }),
    'same-successor'
  );
  expect(mocks.wake).toHaveBeenCalledWith('same-successor');
});

it('wakes for retained discovery even when all source connections are paused', async () => {
  const due = Date.now() + 5000;
  await nativeController(
    {
      connections: {},
      epoch: 0,
      rolloverRequested: true,
      grants: { fulcra: { status: 'ready' } },
      knowledgeSources: { nextDue: due }
    },
    'token'
  );
  expect(mocks.sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(4000);
  expect(mocks.sleep.mock.calls[0][0]).toBeLessThanOrEqual(5000);
});
it('does not schedule discovery wakeups without background authorization', async () => {
  await nativeController(
    {
      connections: {},
      epoch: 0,
      rolloverRequested: true,
      grants: {},
      knowledgeSources: { nextDue: 0 }
    },
    'token'
  );
  expect(mocks.sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(3599000);
});
