import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { deliver, validateRoute, verify } from './sinks.js';
const route = {
  mode: 'both',
  ownerId: 'owner',
  recordType: 'Event/type',
  folder: '/clients/a',
  version: 1
};
const catalog = [
  { id: 'Event/type', api_version: 'v1', recordable: true, queryable: true, fulcra_userid: 'owner' }
];
const schema = {
  type: 'object',
  properties: { id: { type: 'string' }, payload: { type: 'object' } },
  required: ['id', 'payload']
};
it('rejects traversal, a foreign owner, an unrecordable type and incompatible schema', () => {
  expect(() => validateRoute({ ...route, folder: '/safe/../elsewhere' }, catalog, schema)).toThrow(
    /folder/
  );
  expect(() => validateRoute(route, [{ ...catalog[0], fulcra_userid: 'other' }], schema)).toThrow(
    /owner/
  );
  expect(() => validateRoute(route, [{ ...catalog[0], recordable: false }], schema)).toThrow(
    /recordable/
  );
  expect(() =>
    validateRoute(route, catalog, {
      type: 'object',
      properties: { note: { type: 'string' } },
      required: ['note']
    })
  ).toThrow(/payload/);
});
it('record readback must match the expected source content, not just its ID', async () => {
  const wrong = { id: 'x', payload: { title: 'Changed' } };
  const receipt = {
    sink: 'record',
    id: 'x',
    dataType: 'Event/type',
    fields: ['id', 'payload'],
    hash: createHash('sha256').update('{"id":"x","payload":{"title":"One"}}').digest('hex')
  };
  expect(
    await verify(receipt, { readRecords: async () => [wrong], readRecord: async () => wrong })
  ).toBe('failed');
});
it('does not write invalid records and preserves partial sink success for retry', async () => {
  /** @type {string[]} */
  const successful = [];
  const client = {
    writeRecords: async () => {
      throw new Error('provider delay');
    },
    uploadFile: async () => {
      successful.push('file');
      return { id: 'file-id' };
    }
  };
  await expect(deliver({ record: { id: 'x' }, files: [] }, route, client, schema)).rejects.toThrow(
    /schema/
  );
  expect(successful).toEqual([]);
  const result = await deliver(
    {
      record: { id: 'x', payload: {} },
      files: [{ path: 'object/revision.json', content: '{}', contentType: 'application/json' }]
    },
    route,
    client,
    schema
  );
  expect(result.find((x) => x.sink === 'file').status).toBe('pending');
  expect(result.find((x) => x.sink === 'record').status).toBe('uncertain');
  expect(successful).toEqual(['file']);
});
it('a retry keeps the successful file receipt and retries only the failed record', async () => {
  const file = {
    sink: 'file',
    path: '/clients/a/object/revision.json',
    inputId: 'uploaded',
    hash: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    status: 'pending'
  };
  const result = await deliver(
    { record: { id: 'x', payload: {} }, files: [{ path: 'object/revision.json', content: '{}' }] },
    route,
    {
      uploadFile: async () => {
        throw new Error('must not reupload successful file');
      },
      writeRecords: async () => ({ upload_id: 'retry-receipt' })
    },
    schema,
    [file, { sink: 'record', id: 'x', status: 'failed' }]
  );
  expect(result[0]).toBe(file);
  expect(result.find((x) => x.sink === 'record').status).toBe('pending');
  expect(result.find((x) => x.sink === 'record').uploadId).toBe('retry-receipt');
});
it('rejects destinations that cannot be queried for mandatory readback', () => {
  expect(() => validateRoute(route, [{ ...catalog[0], queryable: false }], schema)).toThrow(
    /queryable/
  );
});
it('persists intent before submission and reconciles a remotely accepted file after receipt persistence dies', async () => {
  const output = {
    record: { id: 'revision', payload: {} },
    files: [{ path: 'revision/doc.json', content: '{}', contentType: 'application/json' }]
  };
  /** @type {any[]} */ let durable = [];
  let uploads = 0;
  let accepted = false;
  const client = {
    uploadFile: async () => {
      uploads++;
      accepted = true;
      return { id: 'remote-file' };
    },
    findFileByHash: async () => (accepted ? { id: 'remote-file' } : null),
    readFileBytes: async () => new TextEncoder().encode('{}')
  };
  await expect(
    deliver(output, { ...route, mode: 'file' }, client, schema, [], async (receipt) => {
      if (accepted) throw new Error('process died saving receipt');
      durable = [structuredClone(receipt)];
    })
  ).rejects.toThrow(/process died/);
  expect(durable).toHaveLength(1);
  const result = await deliver(
    output,
    { ...route, mode: 'file' },
    client,
    schema,
    durable,
    async (receipt) => {
      durable = [structuredClone(receipt)];
    }
  );
  expect(uploads).toBe(1);
  expect(result[0].inputId).toBe('remote-file');
});
it('reconciles an accepted record with no final receipt before any resubmission', async () => {
  const output = { record: { id: 'record-revision', payload: {} }, files: [] };
  let accepted = false,
    writes = 0;
  /** @type {any[]} */
  let durable = [];
  const client = {
    readRecord: async () => (accepted ? output.record : undefined),
    writeRecords: async () => {
      writes++;
      accepted = true;
      return { upload_id: 'accepted' };
    }
  };
  await expect(
    deliver(output, { ...route, mode: 'record' }, client, schema, [], async (receipt) => {
      if (accepted) throw new Error('receipt crash');
      durable = [structuredClone(receipt)];
    })
  ).rejects.toThrow();
  const result = await deliver(output, { ...route, mode: 'record' }, client, schema, durable);
  expect(writes).toBe(1);
  expect(result[0].status).toBe('verified');
});
it('resumes the same allocated file input after dying before byte transfer', async () => {
  const output = {
    record: { id: 'allocated-revision', payload: {} },
    files: [{ path: 'allocated/doc.json', content: '{}', contentType: 'application/json' }]
  };
  /** @type {any[]} */
  let durable = [];
  let allocations = 0,
    transfers = 0;
  const client = {
    findFileByHash: async () => null,
    allocateFile: async () => {
      allocations++;
      return { file: { id: 'allocated-id' }, url: 'https://storage.example/upload' };
    },
    transferFile: async (/** @type {any} */ allocation) => {
      expect(allocation.url).toContain('/upload');
      transfers++;
    }
  };
  await expect(
    deliver(output, { ...route, mode: 'file' }, client, schema, [], async (receipt) => {
      durable = [structuredClone(receipt)];
      if (receipt.transfer) throw new Error('worker died before transfer');
    })
  ).rejects.toThrow();
  await deliver(output, { ...route, mode: 'file' }, client, schema, durable);
  expect(allocations).toBe(1);
  expect(transfers).toBe(1);
});
it('rejects changed bytes for a retained artifact before reusing or sending its receipt', async () => {
  const fileRoute = { ...route, mode: 'file' };
  for (const status of ['verified', 'pending', 'uncertain']) {
    const retained = {
      sink: 'file',
      path: '/clients/a/revision/issue.md',
      inputId: 'old-input',
      status,
      hash: 'cba06b5736faf67e54b07b561eae94395e774c517a7d910a54369e1263ccfbd4',
      ...(status === 'uncertain'
        ? { transfer: { url: 'https://storage.example/old-allocation' } }
        : {})
    };
    const original = structuredClone(retained);
    /** @type {string[]} */
    const writes = [];
    const client = {
      findFileByHash: async () => {
        writes.push('lookup');
        return null;
      },
      allocateFile: async () => {
        writes.push('allocate');
        return { file: { id: 'new-input' }, url: 'https://storage.example/new' };
      },
      transferFile: async () => {
        writes.push('transfer');
      }
    };
    await expect(
      deliver(
        {
          record: {},
          files: [{ path: 'revision/issue.md', content: 'new', contentType: 'text/markdown' }]
        },
        fileRoute,
        client,
        {},
        [retained],
        async () => {
          writes.push('persist');
        }
      )
    ).rejects.toThrow(/artifact.*content.*changed/i);
    expect(writes).toEqual([]);
    expect(retained).toEqual(original);
  }
});
it('preflights every artifact before any earlier artifact can upload', async () => {
  /** @type {string[]} */ const effects = [];
  const output = {
    record: {},
    files: [
      { path: 'revision/a.md', content: 'new first', contentType: 'text/markdown' },
      { path: 'revision/b.md', content: 'new second', contentType: 'text/markdown' }
    ]
  };
  const retained = {
    sink: 'file',
    path: '/clients/a/revision/b.md',
    inputId: 'old-second',
    status: 'verified',
    hash: 'cba06b5736faf67e54b07b561eae94395e774c517a7d910a54369e1263ccfbd4'
  };
  await expect(
    deliver(
      output,
      { ...route, mode: 'file' },
      {
        uploadFile: async () => {
          effects.push('upload');
          return { id: 'new-first' };
        }
      },
      {},
      [retained],
      async () => {
        effects.push('persist');
      }
    )
  ).rejects.toThrow(/artifact.*content.*changed/i);
  expect(effects).toEqual([]);
});
