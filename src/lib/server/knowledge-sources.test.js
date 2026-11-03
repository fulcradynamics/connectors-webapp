import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { seal } from './secrets.js';
import { freshState } from './native/state.js';
import { advanceWorker } from './native/worker.js';
import { scopeHash as notionScope } from './notion-sync/state.js';
import { scopeHash as attioScope } from './attio-sync/state.js';
import {
  knowledgeSourcesPath,
  knowledgeSourcesView,
  advanceKnowledgeSources
} from './knowledge-sources.js';

const crypto = { key: Buffer.alloc(32, 31).toString('base64'), keyId: 'v1' };
const at = Date.parse('2026-11-03T12:00:00Z');
function fixture(provider = 'notion') {
  const state = freshState(randomUUID(), randomUUID());
  const id = randomUUID();
  state.connections[id] = {
    id,
    connector: provider,
    account_id: randomUUID(),
    status: 'ready',
    generation: 1,
    config: {
      resources: [randomUUID()],
      twoWay: { enabled: true },
      attio: { twoWay: true },
      route: { mode: 'file', folder: '/imports', ownerId: state.ownerId }
    }
  };
  const c = state.connections[id],
    path = `/imports/live/${id}/index.md`;
  const index = {
    state: 'current',
    path,
    fileId: randomUUID(),
    publishedAt: new Date(at).toISOString()
  };
  if (provider === 'notion')
    state.grants[`notion-sync:${id}`] = {
      encrypted: seal(
        { scopeHash: notionScope(c), indexStatus: index, entries: {} },
        `${state.deploymentId}:${state.ownerId}:notion-sync:${id}`,
        crypto
      )
    };
  if (provider === 'attio')
    state.grants[`attio-sync:${id}`] = {
      encrypted: seal(
        { scopeHash: attioScope(c), index, indexSummary: {} },
        `${state.deploymentId}:${state.ownerId}:attio:${id}:manifest`,
        crypto
      )
    };
  return { state, c, index };
}
class Files {
  current = new Map();
  versions = new Map();
  allocations = new Map();
  allocationCount = 0;
  transfers = 0;
  failReads = false;
  loseTransferResponse = false;
  /** @param {string} path */
  async fileState(path) {
    if (this.failReads) throw Error('transport');
    return { file: this.current.get(path) ?? null, versions: this.versions.get(path) ?? [] };
  }
  /** @param {string} path @param {string} content */
  async allocateFile(path, content) {
    this.allocationCount++;
    const id = randomUUID(),
      url = `https://upload.invalid/${id}`;
    this.allocations.set(url, { id, path, content });
    return { file: { id }, url };
  }
  /** @param {{url:string}} target @param {string} content */
  async transferFile({ url }, content) {
    const item = this.allocations.get(url);
    expect(item.content).toBe(content);
    this.transfers++;
    const versions = (this.versions.get(item.path) ?? []).map((/** @type {any} */ v) => ({
      ...v,
      state: 'archived'
    }));
    versions.push({ id: item.id, state: 'uploaded', uploaded_at: new Date(at).toISOString() });
    this.versions.set(item.path, versions);
    this.current.set(item.path, { id: item.id, content });
    if (this.loseTransferResponse) {
      this.loseTransferResponse = false;
      throw Error('response lost');
    }
  }
}
/** @param {any} state @param {Files} client @param {number} start */
async function publish(state, client, start = at) {
  for (let n = 0; n < 30; n++) {
    await advanceKnowledgeSources(state, { crypto, client, now: start + n * 1000 });
    if (state.knowledgeSources?.fileId && !state.knowledgeSources.pending) return;
  }
  throw Error('Publication did not verify');
}

it('advertises verified routes without pretending a Notion integration is a workspace', () => {
  const { state, c, index } = fixture();
  c.config.secret = 'must not appear in discovery';
  const view = knowledgeSourcesView(state, crypto),
    source = view.sources[0];
  expect(view.schema).toBe('fulcra.knowledge-sources/1');
  expect(source).toMatchObject({
    provider: 'notion',
    connection_id: c.id,
    provider_account_id: c.account_id,
    identity_kind: 'integration',
    workspace_id: null,
    index_path: index.path,
    index_revision: index.fileId,
    last_verified_at: index.publishedAt,
    mode: 'two-way',
    status: 'ready',
    files_path: '/imports',
    selected_count: 1
  });
  expect(source.scope_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(view)).not.toContain('must not appear');
  expect(JSON.stringify(view)).not.toContain(c.config.resources[0]);
  expect(JSON.stringify(view)).not.toContain(state.ownerId);
});
it('uses the verified Attio workspace and does not require a map, vault or agent', () => {
  const { state, c } = fixture('attio');
  const source = knowledgeSourcesView(state, crypto).sources[0];
  expect(source.workspace_id).toBe(c.account_id);
  expect(source.identity_kind).toBe('workspace');
  expect(source.status).toBe('ready');
});
it('keeps disabled routes and distinguishes transport uncertainty from lost access', () => {
  const { state, c, index } = fixture();
  c.lastError = 'transport';
  expect(knowledgeSourcesView(state, crypto).sources[0].status).toBe('unknown');
  c.status = 'paused';
  const source = knowledgeSourcesView(state, crypto).sources[0];
  expect(source.status).toBe('disabled');
  expect(source.index_revision).toBe(index.fileId);
});
it('represents generic file/v1 routes without inventing an index or freshness clock', () => {
  const { state, c } = fixture('github');
  c.config.twoWay = null;
  c.config.attio = null;
  c.config.route.mode = 'both';
  c.config.route.recordType = `Event/${randomUUID()}`;
  c.lastVerified = new Date(at).toISOString();
  const source = knowledgeSourcesView(state, crypto).sources[0];
  expect(source).toMatchObject({
    mode: 'read-only',
    files_path: '/imports',
    record_type: c.config.route.recordType,
    status: 'ready'
  });
  expect(source.index_path).toBeUndefined();
  expect(source.last_verified_at).toBeUndefined();
});
it('separates producer instances and refuses traversal and excess connections', () => {
  const a = fixture(),
    b = fixture();
  expect(knowledgeSourcesPath(a.state)).not.toBe(knowledgeSourcesPath(b.state));
  b.state.deploymentId = '../other';
  expect(() => knowledgeSourcesPath(b.state)).toThrow();
  a.c.config.route.folder = '/imports/../other';
  expect(() => knowledgeSourcesView(a.state, crypto)).toThrow();
  const { state, c } = fixture();
  for (let n = 0; n < 20; n++) {
    const id = randomUUID();
    state.connections[id] = { ...c, id };
  }
  expect(() => knowledgeSourcesView(state, crypto)).toThrow();
});
it('publishes only after exact readback and creates no version on unchanged checks', async () => {
  const { state } = fixture(),
    client = new Files();
  await advanceKnowledgeSources(state, { crypto, client, now: at });
  expect(state.knowledgeSources.fileId).toBeUndefined();
  await publish(state, client, at + 1000);
  const before = client.current.get(knowledgeSourcesPath(state));
  expect(state.knowledgeSources.fileId).toBe(before.id);
  const body = JSON.parse(before.content);
  expect(body.sources).toEqual(knowledgeSourcesView(state, crypto).sources);
  state.connections[Object.keys(state.connections)[0]].lastAttempt = new Date(
    at + 60000
  ).toISOString();
  await advanceKnowledgeSources(state, { crypto, client, now: at + 120000 });
  expect(client.allocationCount).toBe(1);
  expect(client.current.get(knowledgeSourcesPath(state))).toEqual(before);
});
it('recovers a committed transfer with lost response across a saved-state restart', async () => {
  const { state } = fixture(),
    client = new Files();
  client.loseTransferResponse = true;
  for (let n = 0; n < 6; n++)
    await advanceKnowledgeSources(state, { crypto, client, now: at + n * 1000 });
  const resumed = JSON.parse(JSON.stringify(state));
  await publish(resumed, client, at + 60000);
  expect(client.allocationCount).toBe(1);
  expect(client.transfers).toBe(1);
  expect(resumed.knowledgeSources.fileId).toBe(client.current.get(knowledgeSourcesPath(state)).id);
});
it('never overwrites another producer at the advertised instance path', async () => {
  const { state } = fixture(),
    client = new Files(),
    path = knowledgeSourcesPath(state);
  const original = {
    id: randomUUID(),
    content: JSON.stringify({ schema: 'unrelated', producer: { id: 'somebody-else' } })
  };
  client.current.set(path, original);
  await advanceKnowledgeSources(state, { crypto, client, now: at });
  expect(client.current.get(path)).toEqual(original);
  expect(client.allocationCount).toBe(0);
  expect(state.knowledgeSources.error).toBeTruthy();
  expect(state.knowledgeSources.nextDue).toBeGreaterThan(at);
});
it('yields after discovery transport failure without changing ingestion state', async () => {
  const { state, c } = fixture(),
    client = new Files();
  client.failReads = true;
  const before = JSON.stringify(c);
  expect(await advanceKnowledgeSources(state, { crypto, client, now: at })).toBe(false);
  expect(JSON.stringify(c)).toBe(before);
  expect(state.knowledgeSources.error).toBeTruthy();
});
it('the native actor publishes independently without reading any provider or invoking an agent', async () => {
  const { state, c } = fixture(),
    client = new Files();
  state.grants.fulcra = {
    status: 'ready',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    encrypted: {}
  };
  c.nextDue = 0;
  let providerReads = 0;
  for (let n = 0; n < 15 && !state.knowledgeSources?.fileId; n++)
    await advanceWorker(state, {
      crypto,
      client,
      provider: async () => {
        providerReads++;
        throw Error('No provider activity is needed for discovery');
      }
    });
  expect(state.knowledgeSources?.fileId).toBeTruthy();
  expect(providerReads).toBe(0);
  expect(
    JSON.parse(client.current.get(knowledgeSourcesPath(state)).content).sources[0].connection_id
  ).toBe(c.id);
});
it('the native actor continues selecting ordinary sync after metadata transport fails', async () => {
  const { state, c } = fixture(),
    client = new Files();
  state.grants.fulcra = {
    status: 'ready',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    encrypted: {}
  };
  c.nextDue = 0;
  client.failReads = true;
  await advanceWorker(state, { crypto, client });
  expect(state.knowledgeSources?.error).toBeTruthy();
  expect(state.active?.connectionId).toBe(c.id);
  expect(c.status).toBe('ready');
});

it('finishes a retained allocated version before advertising a changed scope', async () => {
  const { state, c } = fixture(),
    client = new Files();
  for (let n = 0; n < 3; n++) await advanceKnowledgeSources(state, { crypto, client, now: at + n });
  const old = state.knowledgeSources.pending;
  expect(old.intent.receipt).toBeTruthy();
  c.status = 'paused';
  const resumed = JSON.parse(JSON.stringify(state));
  await publish(resumed, client, at + 1000);
  expect(
    JSON.parse(client.current.get(knowledgeSourcesPath(state)).content).sources[0].status
  ).toBe('ready');
  await publish(resumed, client, at + 2000);
  expect(
    JSON.parse(client.current.get(knowledgeSourcesPath(state)).content).sources[0].status
  ).toBe('disabled');
  expect(client.allocationCount).toBe(2);
});
it('preserves the allocated receipt and intervening revision before regenerating owned metadata', async () => {
  const { state } = fixture(),
    client = new Files(),
    target = knowledgeSourcesPath(state);
  for (let n = 0; n < 3; n++) await advanceKnowledgeSources(state, { crypto, client, now: at + n });
  const receipt = state.knowledgeSources.pending.intent.receipt;
  const intervening = randomUUID();
  client.current.set(target, {
    id: intervening,
    content: JSON.stringify({
      ...knowledgeSourcesView(state, crypto),
      published_at: new Date(at).toISOString(),
      sources: []
    })
  });
  client.versions.set(target, [
    { id: intervening, state: 'uploaded', uploaded_at: new Date(at).toISOString() }
  ]);
  await advanceKnowledgeSources(state, { crypto, client, now: at + 1000 });
  expect(state.knowledgeSources.previous.at(-1)).toMatchObject({
    receipt,
    interveningFileIds: [intervening]
  });
  expect(client.transfers).toBe(0);
});
it('does not consume an active sync or authorize discovery without a Fulcra grant', async () => {
  const { state, c } = fixture(),
    client = new Files();
  state.active = { connectionId: c.id, generation: c.generation, phase: 'read' };
  expect(await advanceKnowledgeSources(state, { crypto, client, now: at })).toBe(false);
  state.active = null;
  await advanceWorker(state, { crypto, client });
  expect(state.knowledgeSources).toBeUndefined();
  expect(client.allocationCount).toBe(0);
});
