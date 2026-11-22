import { unseal } from '../secrets.js';
import { it, expect } from 'vitest';
import { freshState, stage, unstage } from './state.js';
import { advanceWorker } from './worker.js';
const crypto = { key: Buffer.alloc(32, 7).toString('base64'), keyId: 'v1' };
function fixture() {
  const s = freshState('d', 'o');
  s.grants.fulcra = {
    status: 'ready',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    encrypted: {}
  };
  s.connections.c = {
    id: 'c',
    connector: 'test',
    generation: 1,
    status: 'ready',
    account_id: 'a',
    nextDue: 0,
    config: {
      intervalSeconds: 60,
      routeVersion: 1,
      route: { mode: 'both', ownerId: 'o', folder: '/test', recordType: 'Event/test' }
    }
  };
  return s;
}
it('records intent and allocation durably before file transfer; checkpoint waits for both sinks', async () => {
  let s = fixture();
  /** @type {string[]} */
  const calls = [];
  const client = {
    catalog: async () => [
      { id: 'Event/test', fulcra_userid: 'o', recordable: true, queryable: true, api_version: 'v1' }
    ],
    schema: async () => ({ type: 'object', properties: { payload: { type: 'object' } } }),
    findFileByHash: async () => null,
    allocateFile: async () => {
      calls.push('allocate');
      return { file: { id: 'file' }, url: 'https://upload.test' };
    },
    transferFile: async () => {
      calls.push('transfer');
    },
    readRecord: async () => null,
    writeRecords: async () => {
      calls.push('record');
      return { upload_id: 'upload' };
    },
    readFileBytes: async () => new TextEncoder().encode('{}')
  };
  const deps = {
    crypto,
    client,
    provider: async () => ({}),
    adapters: {
      test: {
        readPage: async () => ({
          changes: [{ id: 'one', timestamp: '2026-10-23T00:00:00Z', version: '1', payload: {} }],
          candidateCheckpoint: { next: 'cursor' }
        })
      }
    }
  };
  s = await advanceWorker(s, deps);
  expect(calls).toEqual([]);
  s = await advanceWorker(s, deps);
  expect(calls).toEqual([]);
  s = await advanceWorker(s, deps);
  expect(calls).toEqual([]);
  expect(unstage(s, 'pending:c', s.checkpoints.c.pending, crypto).items[0].receipt.status).toBe(
    'intent'
  );
  const deadline = unseal(s.checkpoints.c.pending, 'd:o:native:pending:c', crypto).expiresAt;
  await new Promise((resolve) => setTimeout(resolve, 5));
  s = await advanceWorker(s, deps);
  expect(calls).toEqual(['allocate']);
  expect(unseal(s.checkpoints.c.pending, 'd:o:native:pending:c', crypto).expiresAt).toBe(deadline);
  expect(unstage(s, 'pending:c', s.checkpoints.c.pending, crypto).items[0].receipt.inputId).toBe(
    'file'
  );
  s = await advanceWorker(s, deps);
  expect(calls).toEqual(['allocate', 'transfer']);
  expect(s.checkpoints.c.value).toBeUndefined();
  s = await advanceWorker(s, deps);
  expect(calls).toContain('record');
  expect(s.checkpoints.c.value).toBeUndefined();
});
it('stale paused generation cannot issue a remote operation', async () => {
  const s = fixture();
  s.active = { connectionId: 'c', generation: 1, phase: 'deliver' };
  s.connections.c.generation = 2;
  s.connections.c.status = 'paused';
  const next = await advanceWorker(s, {
    crypto,
    client: {
      writeRecords: () => {
        throw Error('must not write');
      }
    }
  });
  expect(next.active).toBeNull();
});
it('missing background grant performs no provider collection', async () => {
  const s = fixture();
  delete s.grants.fulcra;
  await advanceWorker(s, {
    crypto,
    provider: () => {
      throw Error('must not read');
    }
  });
  expect(s.active).toBeNull();
});
it('commits cursor only after file and record content readback both verify', async () => {
  let s = fixture();
  /** @type {any} */ let record;
  const client = {
    catalog: async () => [
      { id: 'Event/test', fulcra_userid: 'o', recordable: true, queryable: true, api_version: 'v1' }
    ],
    schema: async () => ({ type: 'object', properties: { payload: { type: 'object' } } }),
    findFileByHash: async () => null,
    allocateFile: async () => ({ file: { id: 'file' }, url: 'https://upload.test' }),
    transferFile: async () => {},
    readRecord: async () => record,
    writeRecords: async (/** @type {string} */ type, /** @type {any[]} */ records) => {
      record = records[0];
      return { upload_id: 'upload' };
    },
    readFileBytes: async () => new TextEncoder().encode('{}')
  };
  const deps = {
    crypto,
    client,
    provider: async () => ({}),
    adapters: {
      test: {
        readPage: async () => ({
          changes: [{ id: 'one', timestamp: '2026-10-23T00:00:00Z', version: '1', payload: {} }],
          candidateCheckpoint: { next: 'cursor' }
        })
      }
    }
  };
  for (let n = 0; n < 14 && !s.connections.c.lastVerified; n++) s = await advanceWorker(s, deps);
  expect(s.connections.c.lastVerified).toBeTruthy();
  expect(unstage(s, 'value:c', s.checkpoints.c.value, crypto)).toEqual({ next: 'cursor' });
  expect(s.checkpoints.c.pending).toBeUndefined();
  expect(s.deliveries.c.every((/** @type {any} */ r) => r.status === 'verified')).toBe(true);
});
it('discards expired transfer capabilities after reconciliation and reallocates', async () => {
  let s = fixture();
  s.connections.c.config.route.mode = 'file';
  s.active = { connectionId: 'c', generation: 1, phase: 'deliver' };
  s.checkpoints.c = {
    pending: stage(
      s,
      'pending:c',
      {
        outputs: [{ files: [{ content: '{}', contentType: 'application/json' }] }],
        items: [
          {
            outputIndex: 0,
            fileIndex: 0,
            receipt: {
              sink: 'file',
              path: '/test/one',
              hash: 'hash',
              inputId: 'old',
              status: 'allocated',
              transfer: { url: 'https://expired.test' }
            }
          }
        ]
      },
      crypto
    )
  };
  let allocations = 0;
  const client = {
    findFileByHash: async () => null,
    transferFile: async () => {
      throw Error('File transfer returned 403');
    },
    allocateFile: async () => {
      allocations++;
      return { file: { id: 'new' }, url: 'https://new.test' };
    }
  };
  const deps = { crypto, client };
  s = await advanceWorker(s, deps);
  let pending = unstage(s, 'pending:c', s.checkpoints.c.pending, crypto);
  expect(pending.items[0].receipt.transfer).toBeUndefined();
  s.connections.c.nextDue = 0;
  for (let n = 0; n < 4; n++) s = await advanceWorker(s, deps);
  expect(allocations).toBe(1);
});
it('surfaces hash failures and pauses instead of retrying immutable bad objects forever', async () => {
  const s = fixture();
  s.active = { connectionId: 'c', generation: 1, phase: 'verify', verifyIndex: 0 };
  s.checkpoints.c = {
    pending: stage(
      s,
      'pending:c',
      {
        items: [{ receipt: { sink: 'file', inputId: 'bad', hash: 'incorrect', status: 'pending' } }]
      },
      crypto
    )
  };
  await advanceWorker(s, {
    crypto,
    client: { readFileBytes: async () => new TextEncoder().encode('wrong') }
  });
  expect(s.connections.c.failedItems).toBe(1);
  expect(s.connections.c.status).toBe('paused');
  expect(s.connections.c.lastError).toContain('verification_failed');
  expect(s.checkpoints.c.value).toBeUndefined();
});

// Integration uses the real Attio worker and encrypted native manifest, not a dispatch mock.
const attioIds = {
  connection: '11111111-1111-4111-8111-111111111111',
  workspace: '22222222-2222-4222-8222-222222222222',
  object: '33333333-3333-4333-8333-333333333333',
  record: '44444444-4444-4444-8444-444444444444',
  field: '55555555-5555-4555-8555-555555555555'
};
function attioFixture() {
  const s = fixture(),
    c = s.connections.c;
  delete s.connections.c;
  c.id = attioIds.connection;
  c.connector = 'attio';
  c.account_id = attioIds.workspace;
  c.config = {
    resources: [`${attioIds.object}:${attioIds.record}`],
    intervalSeconds: 60,
    route: { mode: 'file', folder: '/attio' },
    attio: {
      twoWay: true,
      includeNotes: false,
      writableAttributes: { [attioIds.object]: [attioIds.field] }
    }
  };
  s.connections[c.id] = c;
  return s;
}

it('registers the actual Attio adapter for validation, discovery and one-way collection', async () => {
  const { adapters } = await import('../connectors/index.js');
  const { attio } = await import('../connectors/attio.js');
  expect(adapters).toHaveProperty('attio', attio);
  expect(Object.keys(adapters).sort()).toEqual([
    'asana',
    'attio',
    'garmin',
    'github',
    'granola',
    'notion',
    'slack'
  ]);
});

it('dispatches enabled Attio two-way work through its real persisted worker with the injected API', async () => {
  const s = attioFixture(),
    c = s.connections[attioIds.connection];
  const credential = { token: 'synthetic-attio-credential' };
  let providerReads = 0,
    attioReads = 0,
    genericReads = 0;
  const deps = {
    crypto,
    client: {},
    provider: async (/** @type {any} */ connection) => {
      expect(connection).toBe(c);
      providerReads++;
      return credential;
    },
    attio: {
      readRecord: async (
        /** @type {string} */ id,
        /** @type {any} */ suppliedCredential,
        /** @type {string} */ workspaceId,
        /** @type {number} */ deadline
      ) => {
        attioReads++;
        expect(id).toBe(c.config.resources[0]);
        expect(suppliedCredential).toBe(credential);
        expect(workspaceId).toBe(attioIds.workspace);
        expect(deadline).toBeGreaterThan(Date.now());
        return {
          binding: { workspaceId, objectId: attioIds.object, recordId: attioIds.record },
          title: 'Synthetic Attio record',
          url: '',
          attributes: [
            {
              id: attioIds.field,
              slug: 'description',
              title: 'Description',
              type: 'text',
              multiple: false,
              writable: true,
              required: false
            }
          ],
          rawValues: { [attioIds.field]: [{ value: 'Retained typed text' }] }
        };
      }
    },
    adapters: {
      attio: {
        readPage: async () => {
          genericReads++;
          return { changes: [], candidateCheckpoint: null };
        }
      }
    }
  };
  for (let n = 0; n < 4; n++) await advanceWorker(s, deps);
  expect(attioReads).toBe(1);
  expect(providerReads).toBe(1);
  expect(genericReads).toBe(0);
  expect(s.active.phase).toBe('attio-two-way');
  expect(s.grants['attio-sync:' + c.id]).toBeTruthy();
  expect(JSON.stringify(s.grants)).not.toContain('Retained typed text');
  expect(s.checkpoints[c.id].pending).toBeUndefined();
});

it.each(['missing-grant', 'refresh-required', 'paused', 'stale-generation'])(
  'does not dispatch Attio remote work before the existing %s guard is satisfied',
  async (guard) => {
    const s = attioFixture(),
      c = s.connections[attioIds.connection];
    s.active = { connectionId: c.id, generation: c.generation, phase: 'read' };
    if (guard === 'missing-grant') delete s.grants.fulcra;
    if (guard === 'refresh-required') s.grants.fulcra.expiresAt = new Date().toISOString();
    if (guard === 'paused') c.status = 'paused';
    if (guard === 'stale-generation') c.generation++;
    let providerReads = 0,
      attioReads = 0;
    await advanceWorker(s, {
      crypto,
      client: {},
      provider: async () => {
        providerReads++;
        return {};
      },
      attio: {
        readRecord: async () => {
          attioReads++;
        }
      }
    });
    expect(providerReads).toBe(0);
    expect(attioReads).toBe(0);
    expect(s.grants['attio-sync:' + c.id]).toBeUndefined();
    if (guard === 'refresh-required') expect(s.grants.fulcra.status).toBe('refreshing');
  }
);

it.each([undefined, false])(
  'keeps Attio config.attio.twoWay=%s on the generic one-way adapter path',
  async (twoWay) => {
    const s = attioFixture(),
      c = s.connections[attioIds.connection];
    if (twoWay === undefined) delete c.config.attio;
    else c.config.attio.twoWay = false;
    let genericReads = 0,
      attioReads = 0;
    const deps = {
      crypto,
      client: {},
      provider: async () => ({}),
      attio: {
        readRecord: async () => {
          attioReads++;
        }
      },
      adapters: {
        attio: {
          readPage: async () => {
            genericReads++;
            return { changes: [], candidateCheckpoint: { synthetic: 'one-way' } };
          }
        }
      }
    };
    await advanceWorker(s, deps);
    await advanceWorker(s, deps);
    expect(genericReads).toBe(1);
    expect(attioReads).toBe(0);
    expect(s.grants['attio-sync:' + c.id]).toBeUndefined();
    expect(
      unstage(s, 'pending:' + c.id, s.checkpoints[c.id].pending, crypto).candidateCheckpoint
    ).toEqual({ synthetic: 'one-way' });
  }
);

it('never calls the injected Attio API when provider credential retrieval fails', async () => {
  const s = attioFixture(),
    c = s.connections[attioIds.connection];
  let providerReads = 0,
    attioReads = 0;
  const deps = {
    crypto,
    client: {},
    provider: async () => {
      providerReads++;
      throw Error('reauthorize');
    },
    attio: {
      readRecord: async () => {
        attioReads++;
      }
    }
  };
  for (let n = 0; n < 4; n++) await advanceWorker(s, deps);
  expect(providerReads).toBe(1);
  expect(attioReads).toBe(0);
  expect(s.active).toBeNull();
  expect(c.nextDue).toBeGreaterThan(Date.now());
  expect(s.grants['attio-sync:' + c.id]).toBeTruthy();
});

it('retains the existing injected Notion two-way dispatch independently of Attio', async () => {
  const s = attioFixture(),
    c = s.connections[attioIds.connection];
  c.connector = 'notion';
  c.config.resources = [attioIds.record];
  c.config.twoWay = { enabled: true, parentId: attioIds.record };
  delete c.config.attio;
  let notionReads = 0,
    attioReads = 0,
    genericReads = 0;
  const deps = {
    crypto,
    client: { latestFile: async () => null, listFiles: async () => [] },
    provider: async () => ({}),
    attio: {
      readRecord: async () => {
        attioReads++;
      }
    },
    notion: {
      children: async () => ({ pages: [], cursor: null }),
      read: async (/** @type {string} */ id) => {
        notionReads++;
        return {
          id,
          parentId: null,
          supported: true,
          titleProperty: 'title',
          document: {
            title: 'Synthetic Notion page',
            markdown: 'Retained Notion text',
            archived: false
          }
        };
      }
    },
    adapters: {
      notion: {
        readPage: async () => {
          genericReads++;
          return { changes: [], candidateCheckpoint: null };
        }
      }
    }
  };
  // Notion yields between its discovery phases; each due tick selects it again.
  for (let n = 0; n < 6; n++) {
    c.nextDue = 0;
    await advanceWorker(s, deps);
  }
  expect(notionReads).toBe(1);
  expect(attioReads).toBe(0);
  expect(genericReads).toBe(0);
  expect(s.grants['notion-sync:' + c.id]).toBeTruthy();
  expect(s.grants['attio-sync:' + c.id]).toBeUndefined();
});
it('continues ingestion while optional discovery publication awaits visibility', async () => {
  const s = freshState(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  );
  const id = '33333333-3333-4333-8333-333333333333';
  s.grants.fulcra = {
    status: 'ready',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    encrypted: {}
  };
  s.connections[id] = {
    id,
    connector: 'github',
    account_id: '123',
    status: 'ready',
    generation: 1,
    nextDue: 0,
    config: {
      resources: ['example/repo'],
      intervalSeconds: 60,
      route: { mode: 'file', folder: '/imports', ownerId: s.ownerId }
    }
  };
  let reads = 0,
    allocations = 0,
    transfers = 0;
  const deps = {
    crypto,
    client: {
      fileState: async () => ({ file: null, versions: [] }),
      allocateFile: async () => {
        allocations++;
        return { file: { id: 'manifest-input' }, url: 'https://upload.invalid/one' };
      },
      transferFile: async () => {
        transfers++;
      }
    },
    provider: async () => ({}),
    adapters: {
      github: {
        readPage: async () => {
          reads++;
          return { changes: [], candidateCheckpoint: { cursor: 'progress' } };
        }
      }
    }
  };
  for (let n = 0; n < 30; n++) await advanceWorker(s, deps);
  expect(reads).toBeGreaterThan(0);
  expect(allocations).toBe(1);
  expect(transfers).toBe(1);
  expect(s.knowledgeSources.pending.intent.receipt.inputId).toBe('manifest-input');
  expect(s.knowledgeSources.pending.intent.phase).toBe('verify');
});
