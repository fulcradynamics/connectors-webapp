import { describe, expect, it, vi } from 'vitest';
import { createAttio } from './attio.js';
const W = '10000000-0000-4000-8000-000000000001';
const O = '20000000-0000-4000-8000-000000000001';
const R = '30000000-0000-4000-8000-000000000001';
const N = '50000000-0000-4000-8000-000000000001';
const id = O + ':' + R;
const credential = { token: 'synthetic-token' };
const connection = {
  account_id: W,
  config: { resources: [id], backfillSince: '2026-01-01T00:00:00Z', attio: { includeNotes: true } }
};
function fixture() {
  const methods = {
    validate: vi.fn().mockResolvedValue({ accountId: W, workspaceId: W, scopes: [] }),
    listResources: vi.fn().mockResolvedValue({ resources: [], nextCursor: null }),
    readRecord: vi.fn().mockResolvedValue({
      binding: { workspaceId: W, objectId: O, recordId: R },
      title: 'A record',
      createdAt: '2026-01-01T00:00:00Z',
      attributes: [],
      rawValues: {}
    }),
    listNotes: vi.fn().mockResolvedValue({
      notes: [
        {
          binding: { workspaceId: W, objectId: O, recordId: R, noteId: N },
          title: 'Note',
          text: 'Text only',
          createdAt: '2026-02-01T00:00:00Z',
          representation: 'api-text-projection',
          partial: true
        }
      ],
      nextCursor: null
    })
  };
  return { api: methods, adapter: createAttio({ api: methods }) };
}
describe('read-only Attio snapshots', () => {
  it('delegates credential verification and discovery with injectable client', async () => {
    const { adapter, api } = fixture();
    expect(await adapter.validate(credential)).toMatchObject({ accountId: W });
    expect(await adapter.listResources({ credential, cursor: null, deadline: 99 })).toEqual({
      resources: [],
      nextCursor: null
    });
    expect(api.listResources).toHaveBeenCalledWith({ credential, cursor: null, deadline: 99 });
  });
  it('emits bounded record and parent-linked note snapshots with resumable checkpoint; preview writes nothing', async () => {
    const { adapter, api } = fixture();
    const first = await adapter.readPage({ connection, credential, checkpoint: null });
    expect(first.changes).toHaveLength(1);
    expect(first.changes[0]).toMatchObject({
      id,
      operation: 'upsert',
      payload: { binding: { workspaceId: W, objectId: O, recordId: R } }
    });
    expect(first.continuation).toBe(true);
    const second = await adapter.readPage({
      connection,
      credential,
      checkpoint: first.candidateCheckpoint
    });
    expect(second.changes).toHaveLength(1);
    expect(second.changes[0]).toMatchObject({
      id: id + ':note:' + N,
      payload: { representation: 'api-text-projection', partial: true }
    });
    expect(second.continuation).toBe(false);
    expect(api.listNotes).toHaveBeenCalledWith(id, credential, W, null, expect.any(Number));
    expect(Object.keys(api)).toEqual(['validate', 'listResources', 'readRecord', 'listNotes']);
  });
  it('keeps versions stable across observation times and preserves all fields', async () => {
    const { adapter } = fixture();
    const first = await adapter.readPage({ connection, credential, checkpoint: null });
    const second = await adapter.readPage({ connection, credential, checkpoint: null });
    expect(first.changes[0].version).toBe(second.changes[0].version);
    expect(first.changes[0].timestamp).toBe(second.changes[0].timestamp);
  });
  it('only reads exact configured records and rejects replaced workspace/checkpoint scope', async () => {
    const { adapter, api } = fixture();
    api.validate.mockResolvedValueOnce({ accountId: O, workspaceId: O, scopes: [] });
    await expect(adapter.readPage({ connection, credential, checkpoint: null })).rejects.toThrow(
      /workspace|account/i
    );
    expect(api.readRecord).not.toHaveBeenCalled();
    const first = await adapter.readPage({ connection, credential, checkpoint: null });
    const changed = { ...connection, config: { ...connection.config, resources: [O + ':' + N] } };
    await expect(
      adapter.readPage({ connection: changed, credential, checkpoint: first.candidateCheckpoint })
    ).rejects.toThrow(/scope|checkpoint/i);
    await expect(
      adapter.readPage({ connection, credential, checkpoint: { index: -1 } })
    ).rejects.toThrow();
  });
  it('honors note opt-in and window without pretending record snapshots have an updated-since filter', async () => {
    const { adapter, api } = fixture();
    const without = {
      ...connection,
      config: { ...connection.config, attio: { includeNotes: false } }
    };
    const result = await adapter.readPage({ connection: without, credential, checkpoint: null });
    expect(result.continuation).toBe(false);
    expect(api.listNotes).not.toHaveBeenCalled();
    const withLaterWindow = {
      ...connection,
      config: { ...connection.config, backfillSince: '2026-03-01T00:00:00Z' }
    };
    const first = await adapter.readPage({
      connection: withLaterWindow,
      credential,
      checkpoint: null
    });
    expect(first.changes).toHaveLength(1);
    const notes = await adapter.readPage({
      connection: withLaterWindow,
      credential,
      checkpoint: first.candidateCheckpoint
    });
    expect(notes.changes).toEqual([]);
  });
  it('does not advance checkpoints on rate limiting', async () => {
    const { ProviderError } = await import('./http.js');
    const { adapter, api } = fixture();
    const retry = '2026-12-01T00:00:00Z';
    api.readRecord.mockRejectedValueOnce(new ProviderError(429, retry));
    expect(await adapter.readPage({ connection, credential, checkpoint: null })).toEqual({
      changes: [],
      retryAt: retry
    });
  });
});
