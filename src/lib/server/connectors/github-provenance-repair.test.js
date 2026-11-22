import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prepareOutput } from '../sync/runner.js';
import { legacyGitHubDocument, renderGitHubDocument } from './github-document.js';
import {
  githubRepairTarget,
  planGitHubRepair,
  advanceGitHubRepair
} from './github-provenance-repair.js';
function fixture() {
  const owner = randomUUID(),
    c = {
      connector: 'github',
      account_id: '123',
      config: {
        resources: ['example/repo'],
        routeVersion: 1,
        route: {
          mode: 'both',
          folder: '/imports',
          recordType: `Event/${randomUUID()}`,
          ownerId: owner
        }
      }
    };
  const payload = {
    kind: 'issue',
    repository: 'example/repo',
    id: 7,
    number: 2,
    title: 'Title',
    body: 'body',
    state: 'open',
    url: 'https://github.com/example/repo/issues/2',
    user: 'sample'
  };
  const change = {
    id: 'example/repo:issues:7',
    version: '2026-10-01T00:00:00Z',
    timestamp: '2026-10-01T00:00:00Z',
    operation: 'upsert',
    payload
  };
  const record = prepareOutput(c, change, owner).record;
  const item = { ...payload, html_url: payload.url };
  const before = { id: randomUUID(), content: legacyGitHubDocument(item) };
  return { owner, c, record, before, item };
}
it('binds a legacy repair to exact selected scope, record identity, route and bytes', () => {
  const { owner, c, record, before, item } = fixture();
  const target = githubRepairTarget(c, record, owner),
    plan = planGitHubRepair(c, record, owner, before);
  expect(target.path).toBe(`/imports/${record.id}/issue.md`);
  expect(plan.status).toBe('ready');
  expect(plan.intent.file.content).toBe(renderGitHubDocument('example/repo', 'issues', item));
  expect(plan.intent.file.beforeId).toBe(before.id);
  expect(
    planGitHubRepair(c, record, owner, { ...before, content: plan.intent.file.content }).status
  ).toBe('unchanged');
  expect(() =>
    planGitHubRepair(c, record, owner, { ...before, content: before.content + 'manual edit' })
  ).toThrow(/legacy|changed/);
});
it('rejects forged record bindings, unselected repos and wrong owner without writing', () => {
  const { owner, c, record, before } = fixture();
  expect(() => planGitHubRepair(c, { ...record, id: randomUUID() }, owner, before)).toThrow(
    /binding/
  );
  expect(() => planGitHubRepair(c, record, randomUUID(), before)).toThrow(/owner/);
  expect(() =>
    planGitHubRepair(
      { ...c, config: { ...c.config, resources: ['other/repo'] } },
      record,
      owner,
      before
    )
  ).toThrow(/selected/);
  expect(() =>
    planGitHubRepair(c, { ...record, source_id: 'other/repo:issues:7' }, owner, before)
  ).toThrow(/binding/);
});
it('keeps normalized event identity unchanged when only file provenance is added', () => {
  const { owner, c, record, item } = fixture();
  const change = {
    id: record.source_id,
    version: record.source_version,
    timestamp: record.start_time,
    operation: record.operation,
    payload: record.payload
  };
  const old = prepareOutput(
      c,
      {
        ...change,
        files: [
          { name: 'issue.md', content: legacyGitHubDocument(item), contentType: 'text/markdown' }
        ]
      },
      owner
    ),
    updated = prepareOutput(
      c,
      {
        ...change,
        files: [
          {
            name: 'issue.md',
            content: renderGitHubDocument('example/repo', 'issues', item),
            contentType: 'text/markdown'
          }
        ]
      },
      owner
    );
  expect(updated.record).toEqual(old.record);
  expect(updated.files[0].path).toBe(old.files[0].path);
});
it('recovers a committed repair with lost response without duplicate upload and uses Markdown', async () => {
  const { owner, c, record, before } = fixture(),
    plan = planGitHubRepair(c, record, owner, before);
  let current = before,
    versions = [{ id: before.id, state: 'uploaded', uploaded_at: new Date().toISOString() }],
    allocations = 0,
    transfers = 0,
    receipt = /** @type {any} */ (null);
  const client = {
    fileState: async () => ({ file: current, versions }),
    allocateFile: async (
      /** @type {string} */ path,
      /** @type {string} */ content,
      /** @type {string} */ type
    ) => {
      expect(type).toBe('text/markdown');
      allocations++;
      receipt = { id: randomUUID() };
      return { file: receipt, url: 'https://upload.invalid/one' };
    },
    transferFile: async (
      /** @type {any} */ upload,
      /** @type {string} */ content,
      /** @type {string} */ type
    ) => {
      expect(type).toBe('text/markdown');
      transfers++;
      versions = [
        { ...versions[0], state: 'archived' },
        { id: receipt.id, state: 'uploaded', uploaded_at: new Date().toISOString() }
      ];
      current = { id: receipt.id, content };
      throw Error('lost response');
    }
  };
  let state = plan.intent;
  for (let n = 0; n < 8; n++) {
    try {
      const r = await advanceGitHubRepair(state, client);
      if (r === 'verified') break;
    } catch {}
    state = JSON.parse(JSON.stringify(state));
  }
  expect(state.file.file.id).toBe(current.id);
  expect(allocations).toBe(1);
  expect(transfers).toBe(1);
});
it('replaces a rejected capability only after fresh history excludes its allocation', async () => {
  const { owner, c, record, before } = fixture(),
    plan = planGitHubRepair(c, record, owner, before);
  let current = before,
    versions = [{ id: before.id, state: 'uploaded', uploaded_at: new Date().toISOString() }],
    allocations = 0,
    transfers = 0;
  /** @type {any} */ let receipt;
  /** @type {string|undefined} */ let expired;
  const client = {
    fileState: async () => ({ file: current, versions }),
    allocateFile: async () => {
      allocations++;
      receipt = { id: randomUUID() };
      return { file: receipt, url: 'https://upload.invalid/' + receipt.id };
    },
    transferFile: async (/** @type {any} */ upload, /** @type {string} */ content) => {
      expired ??= upload.url;
      if (upload.url === expired) throw Error('File transfer returned 403');
      transfers++;
      versions = [
        { ...versions[0], state: 'archived' },
        { id: receipt.id, state: 'uploaded', uploaded_at: new Date().toISOString() }
      ];
      current = { id: receipt.id, content };
    }
  };
  for (let n = 0; n < 12; n++) {
    try {
      if ((await advanceGitHubRepair(plan.intent, client)) === 'verified') break;
    } catch {}
  }
  expect(plan.intent.file.file.id).toBe(current.id);
  expect(allocations).toBe(2);
  expect(transfers).toBe(1);
  expect(plan.intent.previous).toHaveLength(1);
});
it('retains an intervening version instead of rewriting a changed legacy copy', async () => {
  const { owner, c, record, before } = fixture(),
    plan = planGitHubRepair(c, record, owner, before);
  const newer = { id: randomUUID(), content: 'manual change' };
  let allocations = 0;
  const client = {
    fileState: async () => ({
      file: newer,
      versions: [{ id: newer.id, state: 'uploaded', uploaded_at: new Date().toISOString() }]
    }),
    allocateFile: async () => {
      allocations++;
      throw Error('must not allocate');
    }
  };
  expect(await advanceGitHubRepair(plan.intent, client)).toBe('changed');
  expect(allocations).toBe(0);
  expect(plan.intent.file.interveningFileIds).toContain(newer.id);
});

it('retains fresh published/deleted history after a rejected capability, even with the old head', async () => {
  for (const change of ['added-deleted', 'newly-deleted']) {
    const { owner, c, record, before } = fixture();
    const p = planGitHubRepair(c, record, owner, before).intent;
    const historical = { id: randomUUID(), state: 'archived', uploaded_at: '2026-01-01' };
    let versions = [historical, { id: before.id, state: 'uploaded', uploaded_at: '2026-01-02' }];
    const client = {
      fileState: async () => ({ file: before, versions }),
      allocateFile: async () => ({
        file: { id: randomUUID() },
        url: 'https://upload.invalid/expired'
      }),
      transferFile: async () => {
        throw Error('File transfer returned 403');
      }
    };
    await advanceGitHubRepair(p, client);
    await advanceGitHubRepair(p, client);
    await expect(advanceGitHubRepair(p, client)).rejects.toThrow(/403/);
    const receipt = structuredClone(p.file.receipt);
    const changedId = change === 'added-deleted' ? randomUUID() : historical.id;
    versions =
      change === 'added-deleted'
        ? [...versions, { id: changedId, state: 'deleted', uploaded_at: '2026-01-03' }]
        : versions.map((v) => (v.id === changedId ? { ...v, state: 'deleted' } : v));
    expect(await advanceGitHubRepair(p, client)).toBe('changed');
    expect(p.file.receipt).toEqual(receipt);
    expect(p.file.interveningFileIds).toContain(changedId);
    expect(p.rejected).toBe(true);
  }
});

it('stops replacement attempts at the bound without losing earlier evidence', async () => {
  const { owner, c, record, before } = fixture();
  const p = planGitHubRepair(c, record, owner, before).intent;
  const versions = [{ id: before.id, state: 'uploaded', uploaded_at: '2026-01-01' }];
  p.file.history = [before.id];
  p.file.phase = 'transfer';
  p.file.receipt = { inputId: randomUUID(), url: 'https://upload.invalid/expired' };
  p.rejected = true;
  p.previous = Array.from({ length: 4 }, () => ({ receipt: { inputId: randomUUID() } }));
  const previous = structuredClone(p.previous),
    receipt = structuredClone(p.file.receipt);
  await expect(
    advanceGitHubRepair(p, { fileState: async () => ({ file: before, versions }) })
  ).rejects.toThrow(/bound/);
  expect(p.previous).toEqual(previous);
  expect(p.file.receipt).toEqual(receipt);
});
