import { it, expect } from 'vitest';
import { freshState, nativeStore } from '../native/state.js';
import { loadManifest, saveManifest, loadBucket, localId, bucketId, folder } from './state.js';
import { memoryFiles } from './fixtures.js';
import { decodeDocument, encodeDocument } from '../../attio-documents.js';
import { advanceAttioSync } from './worker.js';

const crypto = { key: Buffer.alloc(32, 7).toString('base64'), keyId: 'v1' };
const ids = Array.from(
  { length: 8 },
  (_, n) =>
    `${n + 1}`.repeat(8) +
    '-' +
    `${n + 1}`.repeat(4) +
    '-4' +
    `${n + 1}`.repeat(3) +
    '-8' +
    `${n + 1}`.repeat(3) +
    '-' +
    `${n + 1}`.repeat(12)
);
const [workspaceId, objectId, recordId, connectionId, field, secondField, noteId, createdNoteId] =
  ids;
function fixture({ notes = false } = {}) {
  const c = /** @type {any} */ ({
    id: connectionId,
    connector: 'attio',
    account_id: workspaceId,
    generation: 1,
    status: 'ready',
    config: {
      resources: [`${objectId}:${recordId}`],
      route: { mode: 'file', folder: '/attio' },
      intervalSeconds: 60,
      backfillSince: '2026-01-01T00:00:00Z',
      attio: {
        twoWay: true,
        includeNotes: notes,
        writableAttributes: { [objectId]: [field, secondField] }
      }
    }
  });
  const state = freshState('test-deployment', 'test-owner');
  state.connections[c.id] = c;
  const files = memoryFiles(),
    writes = /** @type {any[]} */ ([]),
    notesById = new Map();
  let values = { [field]: [{ value: 'A' }], [secondField]: [{ value: 'X' }] };
  const binding = { workspaceId, objectId, recordId };
  const api = /** @type {any} */ ({
    readRecord: async (/** @type {string} */ resource = c.config.resources[0]) => ({
      binding: { ...binding, recordId: resource.split(':')[1] },
      title: 'Synthetic record',
      url: '',
      attributes: [field, secondField].map((id) => ({
        id,
        slug: id,
        title: id,
        type: 'text',
        multiple: false,
        writable: true,
        required: false
      })),
      rawValues: structuredClone(values)
    }),
    writeRecord: async (/** @type {string} */ _id, /** @type {any} */ changed) => {
      writes.push(structuredClone(changed));
      values = { ...values, ...structuredClone(changed) };
    },
    listNotes: async () => ({
      notes: [...notesById.values()].map((n) => structuredClone(n)),
      nextCursor: null
    }),
    readNote: async (/** @type {string} */ id) => {
      if (!notesById.has(id)) throw Object.assign(Error('unavailable'), { status: 404 });
      return structuredClone(notesById.get(id));
    },
    createNote: async (/** @type {string} */ _id, /** @type {any} */ data) => {
      writes.push(data);
      const note = {
        binding: { ...binding, noteId: createdNoteId },
        title: data.title,
        text: data.markdown,
        url: '',
        createdAt: '2026-11-01T00:00:00Z'
      };
      notesById.set(createdNoteId, note);
      return structuredClone(note);
    }
  });
  if (notes)
    notesById.set(noteId, {
      binding: { ...binding, noteId },
      title: 'Source note',
      text: 'Original projection',
      url: '',
      createdAt: '2026-11-01T00:00:00Z'
    });
  const step = async () => {
    await advanceAttioSync(state, c, {
      crypto,
      client: files.client,
      provider: async () => ({ token: 'synthetic' }),
      api
    });
  };
  const manifest = () => loadManifest(nativeStore(state), c, crypto);
  const entry = async (kind = 'record') => {
    const m = await manifest(),
      id = localId(c, kind, kind === 'record' ? c.config.resources[0] : noteId),
      b = await loadBucket(m, bucketId(id), files.client, nativeStore(state), c, crypto);
    return b.entries[id];
  };
  const until = async (/** @type {()=>any} */ predicate, limit = 200) => {
    for (let n = 0; n < limit; n++) {
      if (await predicate()) return;
      await step();
    }
    throw Error(
      'Worker did not reach expected fixture condition: ' + JSON.stringify(await manifest())
    );
  };
  const edit = async (/** @type {(document:any)=>void} */ mutate, kind = 'record') => {
    const e = await entry(kind),
      path = `${folder(c)}/${kind === 'note' ? 'notes' : 'records'}/${bucketId(e.id)}/${e.id}.json`,
      file = await files.client.latestFile(path),
      document = decodeDocument(file.content);
    mutate(document);
    return files.put(path, encodeDocument(document));
  };
  return {
    c,
    state,
    ...files,
    api,
    writes,
    notesById,
    step,
    manifest,
    entry,
    until,
    edit,
    setValues: (/** @type {any} */ v) => {
      values = { ...values, ...v };
    }
  };
}

it('imports a verified typed working file through restartable encrypted bucket publication', async () => {
  const f = fixture();
  await f.until(async () => (await f.entry())?.status === 'synced');
  const e = await f.entry(),
    m = await f.manifest();
  expect(e.baseline.fields[field]).toMatch(/^[a-f0-9]{64}$/);
  expect(e.fileId).toBeTruthy();
  expect(f.writes).toEqual([]);
  expect(m.activeBucket === null || m.activeBucket.prefix === bucketId(e.id)).toBe(true);
  expect(JSON.stringify(f.state.grants)).not.toContain('Synthetic record');
});

it('pushes only changed fields and merges a disjoint remote change', async () => {
  const f = fixture();
  await f.until(async () => (await f.entry())?.status === 'synced');
  await f.edit((d) => {
    d.values[field] = ['B'];
  });
  f.setValues({ [secondField]: [{ value: 'Y' }] });
  await f.until(async () => f.writes.length === 1 && (await f.entry())?.status === 'synced');
  expect(f.writes).toEqual([{ [field]: [{ value: 'B' }] }]);
  const e = await f.entry(),
    current = await f.client.latestFile(`${folder(f.c)}/records/${bucketId(e.id)}/${e.id}.json`);
  expect(decodeDocument(current.content).values).toEqual({ [field]: ['B'], [secondField]: ['Y'] });
});

it('retains same-field conflict evidence and never writes an unreviewed winner', async () => {
  const f = fixture();
  await f.until(async () => (await f.entry())?.status === 'synced');
  await f.edit((d) => {
    d.values[field] = ['Own'];
  });
  f.setValues({ [field]: [{ value: 'Remote' }] });
  await f.until(async () => (await f.entry())?.status === 'conflict');
  const e = await f.entry();
  expect(e.conflict.paths.map((/** @type {any} */ p) => p.view).sort()).toEqual([
    'fulcra',
    'provider'
  ]);
  expect(f.writes).toEqual([]);
  expect(e.recovery.document.values[field]).toEqual(['Own']);
});

it('recognizes a lost PUT response by readback without repeating the mutation', async () => {
  const f = fixture();
  await f.until(async () => (await f.entry())?.status === 'synced');
  const write = f.api.writeRecord;
  f.api.writeRecord = async (/** @type {any[]} */ ...args) => {
    await write(...args);
    throw Error('reply lost');
  };
  await f.edit((d) => {
    d.values[field] = ['Applied'];
  });
  await f.until(async () => f.writes.length === 1 && (await f.entry())?.status === 'synced');
  expect(f.writes).toHaveLength(1);
});

it('keeps an accepted editor body when the working file disappears and source access fails', async () => {
  const f = fixture();
  await f.until(async () => (await f.entry())?.status === 'synced');
  const e = await f.entry(),
    path = `${folder(f.c)}/records/${bucketId(e.id)}/${e.id}.json`,
    file = await f.client.latestFile(path),
    document = decodeDocument(file.content);
  document.values[field] = ['Accepted body'];
  const m = await f.manifest();
  m.queue.push({ id: e.id, document, expectedRevision: file.id, operationId: createdNoteId });
  await saveManifest(nativeStore(f.state), f.c, m, crypto);
  for (const v of f.files.get(path) ?? []) v.state = 'deleted';
  f.api.readRecord = async () => {
    throw Object.assign(Error('source inaccessible'), { status: 404 });
  };
  await f.until(
    async () => (await f.entry())?.recovery?.document?.values[field]?.[0] === 'Accepted body'
  );
  expect(f.writes).toEqual([]);
});

it('preserves the original note and creates one linked revision without echoing it as a source', async () => {
  const f = fixture({ notes: true });
  await f.until(async () => (await f.entry('note'))?.status === 'synced');
  const original = structuredClone(f.notesById.get(noteId));
  await f.edit((d) => {
    d.text = 'Accepted note revision';
  }, 'note');
  await f.until(
    async () =>
      (await f.entry('note'))?.headNoteId === createdNoteId &&
      (await f.entry('note'))?.status === 'synced',
    300
  );
  expect(f.notesById.get(noteId)).toEqual(original);
  expect(f.writes).toHaveLength(1);
  const m = await f.manifest(),
    e = await f.entry('note');
  expect(m.ownedNotes[createdNoteId]).toBe(e.id);
  expect(e.sourceSnapshot.fileId).toBeTruthy();
  for (let n = 0; n < 80; n++) await f.step();
  expect((await f.manifest()).counts.notes).toBe(1);
  expect(f.writes).toHaveLength(1);
});

it('does not replay an uncertain note POST when parent enumeration has zero matches', async () => {
  const f = fixture({ notes: true });
  await f.until(async () => (await f.entry('note'))?.status === 'synced');
  f.api.createNote = async () => {
    f.writes.push('uncertain');
    throw Error('lost response');
  };
  await f.edit((d) => {
    d.text = 'Uncertain note revision';
  }, 'note');
  await f.until(async () => (await f.entry('note'))?.status === 'creation_uncertain', 250);
  for (let n = 0; n < 80; n++) await f.step();
  expect(f.writes).toEqual(['uncertain']);
  expect((await f.entry('note')).recovery.document.text).toBe('Uncertain note revision');
});

it.each([false, true])(
  'verifies a paragraph-normalized note and retains original bytes without echo (restart: %s)',
  async (restart) => {
    const f = fixture({ notes: true });
    await f.until(async () => (await f.entry('note'))?.status === 'synced');
    const original = structuredClone(f.notesById.get(noteId)),
      create = f.api.createNote;
    f.api.createNote = async (/** @type {any[]} */ ...args) => {
      const note = await create(...args);
      note.text = note.text.replace(/\n\n/g, '\n');
      f.notesById.set(createdNoteId, structuredClone(note));
      return note;
    };
    await f.edit((d) => {
      d.text = '**First paragraph.**\n\nSecond paragraph.';
    }, 'note');
    if (restart) {
      await f.until(async () => {
        const p = (await f.manifest()).pending;
        return p?.phase === 'note-guard-file' && p.file.phase === 'transfer';
      });
      const saved = structuredClone(f.state.grants);
      await f.step();
      f.state.grants = saved;
    }
    await f.until(
      async () =>
        (await f.entry('note'))?.headNoteId === createdNoteId &&
        (await f.entry('note'))?.status === 'synced',
      300
    );
    const e = await f.entry('note'),
      path = `${folder(f.c)}/notes/${bucketId(e.id)}/${e.id}.json`,
      file = await f.client.latestFile(path);
    expect(decodeDocument(file.content).text).toBe('**First paragraph.**\nSecond paragraph.');
    expect(e.headRevision.serialization).toBe('attio-paragraph-projection-v1');
    const retained = JSON.parse(
      new TextDecoder().decode(await f.client.readFileBytes(e.headRevision.acceptedSnapshot.fileId))
    );
    expect(retained.accepted.text).toBe('**First paragraph.**\n\nSecond paragraph.');
    expect(f.notesById.get(noteId)).toEqual(original);
    for (let n = 0; n < 120; n++) await f.step();
    expect(f.writes).toHaveLength(1);
    expect((await f.entry('note')).status).toBe('synced');
    expect((await f.entry('note')).fileId).toBe(file.id);
  }
);

it.each(['title', 'text'])(
  'keeps submitted evidence separate from a disjoint merged note publication (%s)',
  async (remoteField) => {
    const f = fixture({ notes: true });
    await f.until(async () => (await f.entry('note'))?.status === 'synced');
    const create = f.api.createNote;
    f.api.createNote = async (/** @type {any[]} */ ...args) => {
      const note = await create(...args);
      note.text = note.text.replace(/\n\n/g, '\n');
      f.notesById.set(createdNoteId, structuredClone(note));
      return note;
    };
    await f.edit((d) => {
      if (remoteField === 'title') d.text = '**Local paragraph.**\n\nSecond paragraph.';
      else d.title = 'Accepted local title';
    }, 'note');
    f.notesById.get(noteId)[remoteField] =
      remoteField === 'title'
        ? 'Independently changed remote title'
        : '**Remote paragraph.**\n\nSecond paragraph.';
    await f.until(
      async () =>
        (await f.entry('note'))?.headNoteId === createdNoteId &&
        (await f.entry('note'))?.status === 'synced',
      300
    );
    const e = await f.entry('note');
    expect(e.headRevision.submittedPayloadHash).not.toBe(e.headRevision.originalPayloadHash);
    expect(f.writes).toHaveLength(1);
    for (let n = 0; n < 80; n++) await f.step();
    expect(f.writes).toHaveLength(1);
    expect((await f.entry('note')).status).toBe('synced');
  }
);

it('pulls a source-only field change and preserves a stable no-op working revision', async () => {
  const f = fixture();
  await f.until(async () => (await f.entry())?.status === 'synced');
  const initial = (await f.entry()).fileId;
  f.setValues({ [field]: [{ value: 'Provider change' }] });
  await f.until(
    async () => (await f.entry())?.status === 'synced' && (await f.entry()).fileId !== initial
  );
  const next = (await f.entry()).fileId;
  for (let n = 0; n < 65; n++) await f.step();
  expect((await f.entry()).fileId).toBe(next);
  expect(f.writes).toEqual([]);
});

it('never pushes divergent content without a baseline', async () => {
  const f = fixture();
  await f.until(async () => (await f.manifest()).pending?.phase === 'local');
  const m = await f.manifest(),
    p = m.pending,
    document = structuredClone(p.remote);
  document.values[field] = ['Unbased local'];
  f.put(`${folder(f.c)}/records/${p.prefix}/${p.entryId}.json`, encodeDocument(document));
  await f.until(async () => (await f.entry())?.status === 'conflict');
  expect(f.writes).toEqual([]);
  expect((await f.entry()).recovery.document.values[field]).toEqual(['Unbased local']);
});

it('retains a third provider value after a lost PUT instead of replaying the accepted edit', async () => {
  const f = fixture();
  await f.until(async () => (await f.entry())?.status === 'synced');
  const write = f.api.writeRecord;
  f.api.writeRecord = async (/** @type {any[]} */ ...args) => {
    await write(...args);
    f.setValues({ [field]: [{ value: 'Third value' }] });
    throw Error('lost response');
  };
  await f.edit((d) => {
    d.values[field] = ['Own'];
  });
  await f.until(async () => (await f.entry())?.status === 'conflict');
  expect(f.writes).toHaveLength(1);
  expect((await f.entry()).recovery.document.values[field]).toEqual(['Own']);
});

it('retains accepted text and all intervening IDs when an archived version races transfer', async () => {
  const f = fixture();
  await f.until(async () => (await f.entry())?.status === 'synced');
  const e = await f.entry(),
    path = `${folder(f.c)}/records/${bucketId(e.id)}/${e.id}.json`,
    old = await f.client.latestFile(path),
    document = decodeDocument(old.content);
  document.values[field] = ['Accepted'];
  const m = await f.manifest();
  m.queue.push({ id: e.id, expectedRevision: old.id, operationId: createdNoteId, document });
  await saveManifest(nativeStore(f.state), f.c, m, crypto);
  await f.until(async () => {
    const p = (await f.manifest()).pending;
    return p?.phase === 'working-file' && p.file.phase === 'transfer';
  });
  const transfer = f.client.transferFile;
  let third = '';
  f.client.transferFile = async (receipt, content) => {
    if (content.includes('Accepted'))
      third = f.put(
        path,
        encodeDocument({ ...document, values: { ...document.values, [field]: ['Intervening'] } })
      ).id;
    await transfer(receipt, content);
  };
  await f.until(
    async () => (await f.entry())?.recovery?.interveningFileIds?.includes(third) && !!third
  );
  expect((await f.entry()).recovery.document.values[field]).toEqual(['Accepted']);
  expect(f.writes).toEqual([]);
});

it('quarantines protected metadata changes without writing them to Attio', async () => {
  const f = fixture();
  await f.until(async () => (await f.entry())?.status === 'synced');
  await f.edit((d) => {
    d.title = 'Forged protected record title';
    d.values[field] = ['Own'];
  });
  await f.until(async () => (await f.entry())?.status === 'conflict');
  expect(f.writes).toEqual([]);
  expect((await f.entry()).recovery.document.title).toBe('Forged protected record title');
});

it('recovers exactly one linked note after a successful POST loses its response', async () => {
  const f = fixture({ notes: true });
  await f.until(async () => (await f.entry('note'))?.status === 'synced');
  const create = f.api.createNote;
  f.api.createNote = async (/** @type {any[]} */ ...args) => {
    await create(...args);
    throw Error('reply lost');
  };
  await f.edit((d) => {
    d.text = 'Recovered revision';
  }, 'note');
  await f.until(
    async () =>
      (await f.entry('note'))?.headNoteId === createdNoteId &&
      (await f.entry('note'))?.status === 'synced'
  );
  expect(f.writes).toHaveLength(1);
  expect((await f.manifest()).ownedNotes[createdNoteId]).toBe((await f.entry('note')).id);
});

it('treats two matching note markers as uncertain rather than choosing one', async () => {
  const f = fixture({ notes: true });
  await f.until(async () => (await f.entry('note'))?.status === 'synced');
  const create = f.api.createNote;
  f.api.createNote = async (/** @type {any[]} */ ...args) => {
    const created = await create(...args);
    f.notesById.set(secondField, {
      ...created,
      binding: { ...created.binding, noteId: secondField }
    });
    throw Error('ambiguous response');
  };
  await f.edit((d) => {
    d.text = 'Duplicated marker';
  }, 'note');
  await f.until(async () => (await f.entry('note'))?.status === 'creation_uncertain');
  expect(f.writes).toHaveLength(1);
  expect((await f.entry('note')).headNoteId).not.toBe(createdNoteId);
  for (let n = 0; n < 90; n++) await f.step();
  expect((await f.manifest()).counts.notes).toBe(1);
});

it('does not POST again when guard transfer published but its response was lost', async () => {
  const f = fixture({ notes: true });
  await f.until(async () => (await f.entry('note'))?.status === 'synced');
  await f.edit((d) => {
    d.text = 'Guard uncertainty';
  }, 'note');
  await f.until(async () => {
    const p = (await f.manifest()).pending;
    return p?.phase === 'note-guard-file' && p.file.phase === 'transfer';
  });
  const transfer = f.client.transferFile;
  f.client.transferFile = async (receipt, content) => {
    await transfer(receipt, content);
    throw Error('guard response lost');
  };
  await f.step();
  f.client.transferFile = transfer;
  await f.until(async () => (await f.entry('note'))?.status === 'creation_uncertain');
  expect(f.writes).toEqual([]);
  expect((await f.entry('note')).recovery.document.text).toBe('Guard uncertainty');
});

it('requires review when the original note changes after a linked revision exists', async () => {
  const f = fixture({ notes: true });
  await f.until(async () => (await f.entry('note'))?.status === 'synced');
  await f.edit((d) => {
    d.text = 'Revision one';
  }, 'note');
  await f.until(
    async () =>
      (await f.entry('note'))?.headNoteId === createdNoteId &&
      (await f.entry('note'))?.status === 'synced'
  );
  f.notesById.get(noteId).text = 'Original branch changed';
  await f.until(async () => (await f.entry('note'))?.status === 'conflict');
  expect(f.writes).toHaveLength(1);
});

it('honors a far-future HTTP-date retry time instead of clamping it to the step budget', async () => {
  const f = fixture();
  const retryAt = new Date(Date.now() + 86400000).toISOString();
  f.api.readRecord = async () => {
    throw Object.assign(Error('limited'), { status: 429, retryAt });
  };
  await f.until(async () => f.c.lastError === 'attio_rate_limited');
  expect(f.c.nextDue).toBeGreaterThanOrEqual(Date.parse(retryAt));
  expect((await f.manifest()).retryAt).toBeGreaterThanOrEqual(Date.parse(retryAt));
});

it('detects archived history inserted after file verification and before the provider guard', async () => {
  const f = fixture();
  await f.until(async () => (await f.entry())?.status === 'synced');
  await f.edit((d) => {
    d.values[field] = ['Own'];
  });
  await f.until(async () => (await f.manifest()).pending?.phase === 'provider-guard');
  const e = await f.entry(),
    path = `${folder(f.c)}/records/${bucketId(e.id)}/${e.id}.json`,
    latest = await f.client.latestFile(path);
  f.files.get(path)?.push({
    id: 'intervening-archived',
    path,
    content: 'retained B',
    state: 'archived',
    uploaded_at: latest.uploaded_at
  });
  await f.step();
  await f.until(async () => !!(await f.entry())?.recovery);
  expect(f.writes).toEqual([]);
  expect((await f.entry()).recovery.interveningFileIds).toContain('intervening-archived');
});

it('does not create a note from a draft replaced while its attempt guard is being published', async () => {
  const f = fixture({ notes: true });
  await f.until(async () => (await f.entry('note'))?.status === 'synced');
  await f.edit((d) => {
    d.text = 'Accepted draft';
  }, 'note');
  await f.until(async () => {
    const p = (await f.manifest()).pending;
    return p?.phase === 'note-guard-file' && p.file.phase === 'transfer';
  });
  const e = await f.entry('note'),
    path = `${folder(f.c)}/notes/${bucketId(e.id)}/${e.id}.json`,
    transfer = f.client.transferFile;
  f.client.transferFile = async (receipt, content) => {
    await transfer(receipt, content);
    const doc = decodeDocument((await f.client.latestFile(path)).content);
    doc.text = 'New intervening draft';
    f.put(path, encodeDocument(doc));
  };
  await f.step();
  f.client.transferFile = transfer;
  await f.until(async () => (await f.entry('note'))?.recovery?.document?.text === 'Accepted draft');
  expect(f.writes).toEqual([]);
});

it('restarts after an applied PUT and recognizes the effect from the prior persisted intent', async () => {
  const f = fixture();
  await f.until(async () => (await f.entry())?.status === 'synced');
  await f.edit((d) => {
    d.values[field] = ['Applied before restart'];
  });
  await f.until(async () => (await f.manifest()).pending?.phase === 'provider-attempt');
  const saved = structuredClone(f.state.grants);
  await f.step();
  f.state.grants = saved;
  await f.until(async () => (await f.entry())?.status === 'synced' && f.writes.length === 1);
  expect(f.writes).toHaveLength(1);
});

it('restarts after note POST without a saved response and recovers the same note', async () => {
  const f = fixture({ notes: true });
  await f.until(async () => (await f.entry('note'))?.status === 'synced');
  await f.edit((d) => {
    d.text = 'Created before restart';
  }, 'note');
  await f.until(async () => {
    const p = (await f.manifest()).pending;
    return p?.phase === 'note-guard-file' && p.file.phase === 'transfer';
  });
  const saved = structuredClone(f.state.grants);
  await f.step();
  f.state.grants = saved;
  await f.until(
    async () =>
      (await f.entry('note'))?.status === 'synced' &&
      (await f.entry('note')).headNoteId === createdNoteId
  );
  expect(f.writes).toHaveLength(1);
});

it('rebases a reviewed conflict choice onto fresh protected provider metadata', async () => {
  const f = fixture();
  await f.until(async () => (await f.entry())?.status === 'synced');
  await f.edit((d) => {
    d.values[field] = ['Chosen local'];
  });
  f.setValues({ [field]: [{ value: 'Provider conflict' }] });
  await f.until(async () => (await f.entry())?.status === 'conflict');
  await f.until(async () => !(await f.manifest()).pending);
  const e = await f.entry(),
    m = await f.manifest(),
    current = await f.client.latestFile(`${folder(f.c)}/records/${bucketId(e.id)}/${e.id}.json`);
  m.queue.push({
    id: e.id,
    document: e.recovery.document,
    expectedRevision: current.id,
    operationId: createdNoteId,
    resolution: {
      conflictId: e.conflict.id,
      expectedProvider: e.conflict.expectedProvider,
      choice: 'fulcra'
    }
  });
  await saveManifest(nativeStore(f.state), f.c, m, crypto);
  await f.until(async () => (await f.entry())?.status === 'synced' && f.writes.length === 1);
  expect(f.writes).toEqual([{ [field]: [{ value: 'Chosen local' }] }]);
});

it('rejects a stale reviewed provider fence while preserving the selected candidate', async () => {
  const f = fixture();
  await f.until(async () => (await f.entry())?.status === 'synced');
  await f.edit((d) => {
    d.values[field] = ['Retained local'];
  });
  f.setValues({ [field]: [{ value: 'Provider conflict' }] });
  await f.until(async () => (await f.entry())?.status === 'conflict');
  await f.until(async () => !(await f.manifest()).pending);
  const e = await f.entry(),
    m = await f.manifest(),
    current = await f.client.latestFile(`${folder(f.c)}/records/${bucketId(e.id)}/${e.id}.json`),
    oldConflict = e.conflict.id;
  m.queue.push({
    id: e.id,
    document: e.recovery.document,
    expectedRevision: current.id,
    operationId: createdNoteId,
    resolution: {
      conflictId: oldConflict,
      expectedProvider: e.conflict.expectedProvider,
      choice: 'fulcra'
    }
  });
  await saveManifest(nativeStore(f.state), f.c, m, crypto);
  f.setValues({ [field]: [{ value: 'New third value' }] });
  await f.until(
    async () =>
      (await f.entry())?.status === 'conflict' && (await f.entry()).conflict.id !== oldConflict
  );
  expect(f.writes).toEqual([]);
  expect((await f.entry()).recovery.document.values[field]).toEqual(['Retained local']);
});

it('keeps the same conflict evidence and index revisions on an unchanged unresolved cycle', async () => {
  const f = fixture();
  await f.until(async () => (await f.entry())?.status === 'synced');
  await f.edit((d) => {
    d.values[field] = ['Own'];
  });
  f.setValues({ [field]: [{ value: 'Remote' }] });
  await f.until(async () => (await f.entry())?.status === 'conflict');
  await f.until(async () => !(await f.manifest()).pending);
  const id = (await f.entry()).conflict.id;
  for (let n = 0; n < 90; n++) await f.step();
  expect((await f.entry()).conflict.id).toBe(id);
});

it('allows a healthy selected record to import after another source becomes inaccessible', async () => {
  const f = fixture(),
    extra = `${objectId}:${createdNoteId}`;
  f.c.config.resources.push(extra);
  const read = f.api.readRecord;
  f.api.readRecord = async (/** @type {string} */ id) => {
    if (id === f.c.config.resources[0]) throw Object.assign(Error('missing'), { status: 404 });
    return read(id);
  };
  const local = localId(f.c, 'record', extra);
  await f.until(async () => {
    const m = await f.manifest(),
      b = await loadBucket(m, bucketId(local), f.client, nativeStore(f.state), f.c, crypto);
    return b.entries[local]?.status === 'synced';
  });
  expect((await f.manifest()).counts.records).toBe(2);
  expect(f.writes).toEqual([]);
});

it('verifies optional v1 delivery before committing the working baseline', async () => {
  const f = fixture(),
    records = new Map(),
    submitted = /** @type {any[]} */ ([]);
  f.c.config.route.mode = 'both';
  f.c.config.route.recordType = createdNoteId;
  Object.assign(f.client, {
    schema: async () => ({
      type: 'object',
      properties: { payload: { type: 'object' } },
      required: ['payload']
    }),
    catalog: async () => [
      {
        id: createdNoteId,
        fulcra_userid: f.state.ownerId,
        queryable: true,
        recordable: true,
        api_version: 'v1'
      }
    ],
    readRecord: async (/** @type {string} */ _type, /** @type {string} */ id) =>
      records.get(id) ?? null,
    writeRecords: async (/** @type {string} */ _type, /** @type {any[]} */ items) => {
      submitted.push(...items);
      for (const record of items) records.set(record.id, record);
      return { upload_id: 'synthetic-upload' };
    }
  });
  await f.until(async () => (await f.manifest()).pending?.phase === 'record-verify');
  expect((await f.entry()).baseline).toBeNull();
  expect(submitted).toHaveLength(1);
  await f.until(async () => (await f.entry())?.status === 'synced');
  expect((await f.entry()).recordReceipt.status).toBe('verified');
  for (let n = 0; n < 50; n++) await f.step();
  expect(submitted).toHaveLength(1);
});

it('uses the note-created window without filtering stateful record snapshots', async () => {
  const f = fixture({ notes: true });
  f.c.config.backfillSince = '2026-11-02T00:00:00Z';
  await f.until(async () => (await f.manifest()).lastCycle);
  expect((await f.entry()).status).toBe('synced');
  expect(await f.entry('note')).toBeUndefined();
  expect((await f.manifest()).counts).toEqual({ records: 1, notes: 0 });
});

it('round-trips a near-24KiB note draft with bounded provenance and an intact original', async () => {
  const f = fixture({ notes: true });
  await f.until(async () => (await f.entry('note'))?.status === 'synced');
  const text = 'é'.repeat(12 * 1024 - 1),
    original = structuredClone(f.notesById.get(noteId));
  await f.edit((d) => {
    d.text = text;
  }, 'note');
  await f.until(
    async () =>
      (await f.entry('note'))?.status === 'synced' &&
      (await f.entry('note')).headNoteId === createdNoteId
  );
  expect(f.writes).toHaveLength(1);
  expect(Buffer.byteLength(f.writes[0].markdown)).toBeGreaterThan(24 * 1024);
  expect(Buffer.byteLength(f.writes[0].markdown)).toBeLessThanOrEqual(26 * 1024);
  expect(f.notesById.get(noteId)).toEqual(original);
  for (let n = 0; n < 50; n++) await f.step();
  expect(f.writes).toHaveLength(1);
});

it('yields a failed parent note listing so another selected record can import', async () => {
  const f = fixture({ notes: true }),
    extra = `${objectId}:${createdNoteId}`;
  f.c.config.resources.push(extra);
  f.api.listNotes = async () => {
    throw Object.assign(Error('parent denied'), { status: 403 });
  };
  const id = localId(f.c, 'record', extra);
  await f.until(async () => {
    const m = await f.manifest(),
      b = await loadBucket(m, bucketId(id), f.client, nativeStore(f.state), f.c, crypto);
    return b.entries[id]?.status === 'synced';
  });
  expect((await f.manifest()).noteRetries[f.c.config.resources[0]].cursor).toBeNull();
});

it('recovers a delayed-visible note after its uncertain attempt was sealed into a bucket', async () => {
  const f = fixture({ notes: true });
  await f.until(async () => (await f.entry('note'))?.status === 'synced');
  const create = f.api.createNote;
  let hidden = /** @type {any} */ (null);
  f.api.createNote = async (/** @type {any[]} */ ...args) => {
    hidden = await create(...args);
    f.notesById.delete(createdNoteId);
    throw Error('unknown response with delayed visibility');
  };
  await f.edit((d) => {
    d.text = 'Delayed accepted revision';
  }, 'note');
  await f.until(async () => (await f.entry('note'))?.status === 'creation_uncertain');
  await f.until(async () => !(await f.manifest()).pending);
  f.notesById.set(createdNoteId, hidden);
  await f.until(
    async () =>
      (await f.entry('note'))?.status === 'synced' &&
      (await f.entry('note')).headNoteId === createdNoteId
  );
  expect(f.writes).toHaveLength(1);
});

it('retains an original-source branch that changes while a created note is not yet visible', async () => {
  const f = fixture({ notes: true });
  await f.until(async () => (await f.entry('note'))?.status === 'synced');
  const create = f.api.createNote;
  let hidden = /** @type {any} */ (null);
  f.api.createNote = async (/** @type {any[]} */ ...args) => {
    hidden = await create(...args);
    f.notesById.delete(createdNoteId);
    throw Error('unknown response');
  };
  await f.edit((d) => {
    d.text = 'Accepted before branch';
  }, 'note');
  await f.until(async () => (await f.entry('note'))?.status === 'creation_uncertain');
  await f.until(async () => !(await f.manifest()).pending);
  f.notesById.get(noteId).text = 'New original branch';
  f.notesById.set(createdNoteId, hidden);
  await f.until(async () => (await f.entry('note'))?.status === 'conflict');
  expect(f.writes).toHaveLength(1);
  expect((await f.entry('note')).recovery.document.text).toBe('Accepted before branch');
});

it('yields failed optional record delivery and resumes it without repeating the provider write', async () => {
  const f = fixture(),
    extra = `${objectId}:${createdNoteId}`,
    records = new Map();
  f.c.config.resources.push(extra);
  f.c.config.route.mode = 'both';
  f.c.config.route.recordType = secondField;
  let failing = false;
  Object.assign(f.client, {
    schema: async () => ({
      type: 'object',
      properties: { payload: { type: 'object' } },
      required: ['payload']
    }),
    catalog: async () => [
      {
        id: secondField,
        fulcra_userid: f.state.ownerId,
        queryable: true,
        recordable: true,
        api_version: 'v1'
      }
    ],
    readRecord: async (/** @type {string} */ _type, /** @type {string} */ id) =>
      records.get(id) ?? null,
    writeRecords: async (/** @type {string} */ _type, /** @type {any[]} */ items) => {
      for (const item of items) {
        if (failing && item.source_id === f.c.config.resources[0])
          throw Error('destination unavailable');
        records.set(item.id, item);
      }
      return { upload_id: 'synthetic' };
    }
  });
  const extraId = localId(f.c, 'record', extra);
  await f.until(async () => {
    const m = await f.manifest(),
      b = await loadBucket(m, bucketId(extraId), f.client, nativeStore(f.state), f.c, crypto);
    return b.entries[extraId]?.status === 'synced';
  });
  await f.edit((d) => {
    d.values[field] = ['Accepted provider change'];
  });
  failing = true;
  await f.until(async () => (await f.entry())?.status === 'delivery_pending');
  const first = await f.entry();
  expect(first.recovery.document.values[field]).toEqual(['Accepted provider change']);
  expect(first.deliveryResume.file.fileId).toBeTruthy();
  await f.until(async () => (await f.manifest()).cursor.record >= 1);
  expect(f.writes).toHaveLength(1);
  failing = false;
  await f.until(
    async () => (await f.entry())?.status === 'synced' && !(await f.entry()).deliveryResume
  );
  expect(f.writes).toHaveLength(1);
});

it('adopts a provider-derived company title after the selected name field is updated', async () => {
  const f = fixture(),
    read = f.api.readRecord;
  f.api.readRecord = async (/** @type {any[]} */ ...args) => {
    const p = await read(...args);
    return { ...p, title: p.rawValues[field][0].value };
  };
  await f.until(async () => (await f.entry())?.status === 'synced');
  await f.edit((d) => {
    d.values[field] = ['Company New Name'];
  });
  await f.until(
    async () => f.writes.length === 1 && ['synced', 'conflict'].includes((await f.entry())?.status)
  );
  expect((await f.entry()).status).toBe('synced');
  expect((await f.entry()).title).toBe('Company New Name');
});

it('binds provider readback conflicts to the accepted current working revision', async () => {
  const f = fixture();
  await f.until(async () => (await f.entry())?.status === 'synced');
  await f.until(async () => !(await f.manifest()).pending);
  const e = await f.entry(),
    path = `${folder(f.c)}/records/${bucketId(e.id)}/${e.id}.json`,
    before = await f.client.latestFile(path),
    doc = decodeDocument(before.content);
  doc.values[field] = ['Accepted editor value'];
  const m = await f.manifest();
  m.queue.push({
    id: e.id,
    document: doc,
    expectedRevision: before.id,
    operationId: createdNoteId
  });
  await saveManifest(nativeStore(f.state), f.c, m, crypto);
  const write = f.api.writeRecord;
  f.api.writeRecord = async (/** @type {any[]} */ ...args) => {
    await write(...args);
    f.setValues({ [field]: [{ value: 'Third provider value' }] });
  };
  await f.until(async () => (await f.entry())?.status === 'conflict');
  const current = await f.client.latestFile(path);
  expect(current.id).not.toBe(before.id);
  expect((await f.entry()).conflict.expectedRevision).toBe(current.id);
});
