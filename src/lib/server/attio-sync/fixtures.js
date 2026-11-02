// Synthetic file transport for Attio recovery tests. Never used by production.
export function memoryFiles() {
  const files = /** @type {Map<string,any[]>} */ (new Map()),
    allocations = /** @type {Map<string,any>} */ (new Map()),
    calls = /** @type {string[]} */ ([]);
  let sequence = 0;
  const put = (
    /** @type {string} */ path,
    /** @type {string} */ content,
    id = `file-${++sequence}`
  ) => {
    const previous = files.get(path) ?? [];
    for (const f of previous) if (f.state === 'uploaded') f.state = 'archived';
    const item = {
      id,
      path,
      content,
      state: 'uploaded',
      uploaded_at: new Date(1700000000000 + sequence).toISOString()
    };
    files.set(path, [item, ...previous]);
    return item;
  };
  const client = {
    fileState: async (/** @type {string} */ path) => {
      const versions = files.get(path) ?? [],
        heads = versions.filter((f) => f.state === 'uploaded');
      if (heads.length > 1) throw Error('Ambiguous current working-file versions');
      return {
        file: heads[0] ? { ...heads[0], versions } : null,
        versions: versions.map((v) => {
          const metadata = { ...v };
          delete metadata.content;
          return metadata;
        })
      };
    },
    latestFile: async (/** @type {string} */ path) => (await client.fileState(path)).file,
    readFileBytes: async (/** @type {string} */ id, maxBytes = 2 * 1024 * 1024) => {
      const f = [...files.values()].flat().find((f) => f.id === id && f.state !== 'deleted');
      if (!f) throw Error('Retained file unavailable');
      const bytes = new TextEncoder().encode(f.content);
      if (bytes.length > maxBytes) throw Error('Working-file content exceeds bound');
      return bytes;
    },
    allocateFile: async (/** @type {string} */ path, /** @type {string} */ content) => {
      calls.push('allocate');
      const id = `file-${++sequence}`;
      allocations.set(id, { path, content });
      return { file: { id }, url: `https://upload.example/${id}` };
    },
    transferFile: async (/** @type {any} */ receipt, /** @type {string} */ content) => {
      calls.push('transfer');
      const id = receipt.url.split('/').at(-1),
        p = allocations.get(id);
      if (!p) throw Error('Unknown allocation');
      put(p.path, content, id);
    },
    uploadFile: async (/** @type {string} */ path, /** @type {string} */ content) => {
      calls.push('upload');
      return put(path, content);
    }
  };
  return { client, files, allocations, calls, put };
}
