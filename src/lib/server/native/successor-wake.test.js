import { beforeEach, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  queue: vi.fn(),
  start: vi.fn(),
  reenqueue: vi.fn()
}));
vi.mock('workflow/runtime', () => ({
  getWorld: async () => ({ runs: { get: mocks.get }, queue: mocks.queue })
}));
vi.mock('@workflow/core/runtime', () => ({ reenqueueRun: mocks.reenqueue }));
vi.mock('workflow/api', () => ({ start: mocks.start, resumeHook: vi.fn() }));
import { wakeSuccessor } from '../../../../workflows/native-steps.js';
beforeEach(() => vi.clearAllMocks());
it('re-enqueues only the existing pending successor ID without creating another run', async () => {
  mocks.get.mockResolvedValue({ status: 'pending' });
  await wakeSuccessor('same-successor');
  expect(mocks.get).toHaveBeenCalledWith('same-successor', { resolveData: 'none' });
  expect(mocks.reenqueue).toHaveBeenCalledWith(
    expect.objectContaining({ runs: expect.any(Object) }),
    'same-successor'
  );
  expect(mocks.start).not.toHaveBeenCalled();
});
it.each(['running', 'completed', 'failed', 'cancelled'])(
  'does not re-enqueue a %s successor',
  async (status) => {
    mocks.get.mockResolvedValue({ status });
    await wakeSuccessor('same-successor');
    expect(mocks.reenqueue).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  }
);
it('propagates wake failure while retaining the same run for a persisted-step retry', async () => {
  mocks.get.mockResolvedValue({ status: 'pending' });
  mocks.reenqueue
    .mockRejectedValueOnce(Error('queue unavailable'))
    .mockResolvedValueOnce(undefined);
  await expect(wakeSuccessor('same-successor')).rejects.toThrow('queue unavailable');
  await wakeSuccessor('same-successor');
  expect(mocks.reenqueue.mock.calls.map((call) => call[1])).toEqual([
    'same-successor',
    'same-successor'
  ]);
  expect(mocks.start).not.toHaveBeenCalled();
});
