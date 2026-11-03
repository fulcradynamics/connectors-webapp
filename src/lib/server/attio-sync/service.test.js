import { it, expect } from 'vitest';
import { createAttioDocumentService } from './service.js';
import { freshState, nativeStore } from '../native/state.js';
import { loadManifest, saveManifest, localId, bucketId, folder } from './state.js';
import { memoryFiles } from './fixtures.js';
import { projectRecord, encodeDocument } from '../../attio-documents.js';
import { contentHash } from '../sync/identity.js';
import { baselineFor } from './reconcile.js';
const uuid = (/** @type {number} */ n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const crypto = { key: Buffer.alloc(32, 7).toString('base64'), keyId: 'v1' };
async function fixture() {
  const connection = /** @type {any} */ ({
    id: uuid(1),
    connector: 'attio',
    account_id: uuid(2),
    status: 'ready',
    generation: 1,
    config: {
      resources: [`${uuid(3)}:${uuid(4)}`],
      intervalSeconds: 60,
      route: { mode: 'file', folder: '/attio' },
      attio: { twoWay: true, includeNotes: false, writableAttributes: { [uuid(3)]: [uuid(5)] } }
    }
  });
  const state = freshState('deployment', 'owner');
  state.connections[connection.id] = connection;
  const store = nativeStore(state),
    f = memoryFiles();
  const projection = {
    binding: { workspaceId: uuid(2), objectId: uuid(3), recordId: uuid(4) },
    title: 'Synthetic',
    url: '',
    attributes: [
      {
        id: uuid(5),
        title: 'Demo',
        slug: 'demo',
        type: 'text',
        multiple: false,
        required: false,
        writable: true
      }
    ],
    rawValues: { [uuid(5)]: [{ value: 'Original' }] }
  };
  const document = projectRecord(projection, [uuid(5)]),
    id = localId(connection, 'record', connection.config.resources[0]),
    prefix = bucketId(id),
    path = `${folder(connection)}/records/${prefix}/${id}.json`,
    file = f.put(path, encodeDocument(document));
  const m = await loadManifest(store, connection, crypto);
  m.activeBucket = {
    version: 1,
    prefix,
    entries: {
      [id]: {
        id,
        kind: 'record',
        resourceId: connection.config.resources[0],
        binding: document.binding,
        title: document.title,
        status: 'synced',
        fileId: file.id,
        baseline: baselineFor(document)
      }
    }
  };
  await saveManifest(store, connection, m, crypto);
  const api = { schema: async () => projection.attributes, readRecord: async () => projection };
  const service = createAttioDocumentService({
    store,
    connection,
    crypto,
    client: f.client,
    credential: {},
    api
  });
  return { ...f, state, store, connection, service, document, id, prefix, path, file, api };
}
it('queues exact owner edits encrypted with stale revision and routing guards', async () => {
  const f = await fixture(),
    document = structuredClone(f.document);
  document.values[uuid(5)] = ['Edited'];
  await expect(
    f.service.mutate({ operation: 'save', id: uuid(99), expectedRevision: f.file.id, document })
  ).rejects.toThrow(/scope|selected/i);
  await expect(
    f.service.mutate({ operation: 'save', id: f.id, expectedRevision: 'old', document })
  ).rejects.toThrow(/changed|revision/i);
  await expect(
    f.service.mutate({
      operation: 'save',
      id: f.id,
      expectedRevision: f.file.id,
      document,
      path: '/foreign'
    })
  ).rejects.toThrow(/fields/i);
  expect(
    await f.service.mutate({ operation: 'save', id: f.id, expectedRevision: f.file.id, document })
  ).toMatchObject({ queued: true });
  const m = await loadManifest(f.store, f.connection, crypto);
  expect(m.queue[0].document.values[uuid(5)]).toEqual(['Edited']);
  expect(JSON.stringify(f.state.grants)).not.toContain('Edited');
  expect((await f.client.latestFile(f.path)).content).toBe(encodeDocument(f.document));
});
it('shows retained accepted content readonly if current read fails and bounds paged listing', async () => {
  const f = await fixture(),
    m = await loadManifest(f.store, f.connection, crypto);
  m.activeBucket.entries[f.id].recovery = {
    document: { ...f.document, values: { [uuid(5)]: ['Retained'] } }
  };
  await saveManifest(f.store, f.connection, m, crypto);
  f.client.latestFile = async () => {
    throw Error('unavailable');
  };
  const read = await f.service.read(f.id);
  expect(read.document.values[uuid(5)]).toEqual(['Retained']);
  expect(read.workingReadUnavailable).toBe(true);
  expect(read.revision).toBe(null);
  expect((await f.service.list()).documents).toHaveLength(1);
  await expect(f.service.list('not-a-bucket')).rejects.toThrow(/cursor/i);
});
it('rejects capacity before accepting a candidate into a dense recovery bucket', async () => {
  const f = await fixture(),
    m = await loadManifest(f.store, f.connection, crypto);
  m.activeBucket.entries[f.id].padding = 'x'.repeat(125 * 1024);
  await saveManifest(f.store, f.connection, m, crypto);
  const document = structuredClone(f.document);
  document.values[uuid(5)] = ['y'.repeat(6000)];
  await expect(
    f.service.mutate({ operation: 'save', id: f.id, expectedRevision: f.file.id, document })
  ).rejects.toThrow(/capacity/i);
  expect((await loadManifest(f.store, f.connection, crypto)).queue).toHaveLength(0);
});
it('allows server-verified schema discovery before two-way enablement', async () => {
  const f = await fixture();
  delete f.connection.config.attio;
  await f.store.saveResources(f.connection.id, [
    { id: f.connection.config.resources[0], name: 'Synthetic' }
  ]);
  expect(await f.service.schema(f.connection.config.resources[0])).toMatchObject({
    attributes: [{ id: uuid(5) }]
  });
  await expect(f.service.schema(`${uuid(3)}:${uuid(99)}`)).rejects.toThrow(
    /scope|selected|discovered/i
  );
});

it('resolves only a current conflict and rebases chosen editable values onto fresh protected metadata', async () => {
  const f = await fixture(),
    m = await loadManifest(f.store, f.connection, crypto),
    entry = m.activeBucket.entries[f.id],
    provider = structuredClone(f.document),
    own = structuredClone(f.document);
  provider.values[uuid(5)] = ['Remote'];
  own.values[uuid(5)] = ['Accepted'];
  const { providerHash } = await import('./projection.js');
  const expected = providerHash(provider);
  const refs = [
    ['provider', provider],
    ['fulcra', own]
  ].map(([view, document]) => {
    const content = encodeDocument(document),
      file = f.put('/conflicts/' + view, content);
    return { view, fileId: file.id, hash: contentHash(content) };
  });
  entry.conflict = {
    id: uuid(80),
    expectedProvider: expected,
    expectedRevision: f.file.id,
    paths: refs
  };
  entry.status = 'conflict';
  entry.recovery = { document: own };
  await saveManifest(f.store, f.connection, m, crypto);
  f.api.readRecord = async () => ({
    .../** @type {any} */ (await Promise.resolve({})),
    binding: provider.binding,
    title: provider.title,
    url: provider.url,
    attributes: provider.attributes,
    rawValues: { [uuid(5)]: [{ value: 'Remote' }] }
  });
  const input = {
    operation: 'resolve',
    id: f.id,
    choice: 'fulcra',
    conflictId: uuid(80),
    expectedRevision: f.file.id,
    expectedProvider: 'stale'
  };
  await expect(f.service.mutate(input)).rejects.toThrow(/changed/i);
  input.expectedProvider = expected;
  await f.service.mutate(input);
  const saved = await loadManifest(f.store, f.connection, crypto);
  expect(saved.queue[0].document.values[uuid(5)]).toEqual(['Accepted']);
  expect(saved.queue[0].resolution.expectedProvider).toBe(expected);
});

it('keeps retained conflict content inspectable through provider and original-snapshot outages', async () => {
  const f = await fixture(),
    m = await loadManifest(f.store, f.connection, crypto),
    e = m.activeBucket.entries[f.id];
  e.conflict = { id: uuid(90), paths: [] };
  e.recovery = { document: f.document };
  e.sourceSnapshot = { fileId: 'missing-original', hash: '0'.repeat(64) };
  await saveManifest(f.store, f.connection, m, crypto);
  f.api.readRecord = async () => {
    throw Error('source inaccessible');
  };
  const result = await f.service.read(f.id);
  expect(result.document).toEqual(f.document);
  expect(result.providerReadUnavailable).toBe(true);
  expect(result.expectedProvider).toBe(null);
  expect(result.sourceReadUnavailable).toBe(true);
  expect(result.sourceReference?.fileId).toBe('missing-original');
});
it('rejects forged current working identity and capabilities before accepting another draft', async () => {
  const f = await fixture(),
    forged = structuredClone(f.document);
  forged.binding.recordId = uuid(99);
  const changed = f.put(f.path, encodeDocument(forged));
  await expect(
    f.service.mutate({
      operation: 'save',
      id: f.id,
      expectedRevision: changed.id,
      document: forged
    })
  ).rejects.toThrow(/binding|scope/i);
  expect((await loadManifest(f.store, f.connection, crypto)).queue).toHaveLength(0);
  const altered = structuredClone(f.document);
  altered.attributes[0].writable = false;
  const second = f.put(f.path, encodeDocument(altered));
  await expect(
    f.service.mutate({
      operation: 'save',
      id: f.id,
      expectedRevision: second.id,
      document: altered
    })
  ).rejects.toThrow(/schema|protected|conflict/i);
});
it('shows the newest accepted reviewed resolution before an older retained recovery candidate', async () => {
  const f = await fixture(),
    m = await loadManifest(f.store, f.connection, crypto);
  m.activeBucket.entries[f.id].recovery = {
    document: { ...f.document, values: { [uuid(5)]: ['Older'] } }
  };
  const document = { ...f.document, values: { [uuid(5)]: ['Reviewed newest'] } };
  m.queue.push({ id: f.id, document, expectedRevision: f.file.id, operationId: uuid(90) });
  await saveManifest(f.store, f.connection, m, crypto);
  expect((await f.service.read(f.id)).document.values[uuid(5)]).toEqual(['Reviewed newest']);
  f.client.latestFile = async () => {
    throw Error('unavailable');
  };
  expect((await f.service.read(f.id)).document.values[uuid(5)]).toEqual(['Reviewed newest']);
});
