import { beforeEach, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  start: vi.fn(),
  wake: vi.fn(),
  dispose: vi.fn(),
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
  async () => {},
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
