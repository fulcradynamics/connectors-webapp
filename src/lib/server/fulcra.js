import { contentHash } from './sync/identity.js';
/** Server-side client. Never return credentials or signed upload URLs to the browser. */
export class FulcraClient {
  /** @param {{ endpoint: string, accessToken: string, fetchImpl?: typeof fetch, deadline?:number }} options */
  constructor({ endpoint, accessToken, fetchImpl = fetch, deadline = Infinity }) {
    this.endpoint = endpoint;
    this.accessToken = accessToken;
    this.fetch = fetchImpl;
    this.deadline = deadline;
  }
  /** @param {string} path @param {RequestInit} options */
  async response(path, options = {}) {
    const response = await this.fetch(new URL(path, this.endpoint), {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${this.accessToken}` },
      signal: AbortSignal.timeout(Math.max(1, Math.min(10000, this.deadline - Date.now() - 500)))
    });
    if (!response.ok) throw new Error(`Fulcra returned ${response.status}`);
    return response;
  }
  /** @param {string} path */
  async json(path) {
    return (await this.response(path)).json();
  }
  async catalog() {
    return this.json('data/v1/catalog');
  }
  /** @param {string} dataType */
  async schema(dataType) {
    return this.json(`data/v1/catalog/${encodeURIComponent(dataType)}/v1/schema`);
  }
  /** @param {string} dataType @param {string} id */
  async readRecord(dataType, id) {
    const q = `{__name__=${JSON.stringify(dataType)},id=${JSON.stringify(id)}}`;
    const response = await this.response(`data/v1/records?q=${encodeURIComponent(q)}`);
    const text = await response.text();
    const records = response.headers.get('content-type')?.includes('jsonl')
      ? text
          .split('\n')
          .filter((x) => x.trim())
          .map((x) => JSON.parse(x))
      : JSON.parse(text);
    return records.find(/** @param {any} record */ (record) => record.id === id);
  }
  /** @param {string} dataType @param {any[]} records */
  async writeRecords(dataType, records) {
    return (
      await this.response(`ingest/v1/record/${encodeURIComponent(dataType)}?api_version=v1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-jsonl' },
        body: records.map((x) => JSON.stringify(x)).join('\n') + '\n'
      })
    ).json();
  }
  /** @param {string} path @param {string|Uint8Array} content @param {string} contentType */
  async allocateFile(path, content, contentType) {
    const split = path.lastIndexOf('/'),
      bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    return (
      await this.response('input/v1/file_upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: path.slice(split + 1),
          path: path.slice(0, split) || '/',
          content_type: contentType,
          content_length: bytes.byteLength
        })
      })
    ).json();
  }
  /** @param {{url:string}} upload @param {string|Uint8Array} content @param {string} contentType */
  async transferFile(upload, content, contentType) {
    const bytes =
        typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content),
      target = new URL(upload.url);
    if (target.protocol !== 'https:') throw new Error('Insecure upload destination');
    const response = await this.fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'Content-Length': String(bytes.byteLength) },
      body: bytes,
      signal: AbortSignal.timeout(Math.max(1, Math.min(10000, this.deadline - Date.now() - 500)))
    });
    if (!response.ok) throw new Error(`File transfer returned ${response.status}`);
  }
  /** @param {string} path @param {string|Uint8Array} content @param {string} contentType */
  async uploadFile(path, content, contentType) {
    const upload = await this.allocateFile(path, content, contentType);
    await this.transferFile(upload, content, contentType);
    return upload.file;
  }
  /** Reconcile deterministic path AND bytes; a same-name object is not proof.
   * @param {string} path @param {string} hash */
  async findFileByHash(path, hash) {
    const slash = path.lastIndexOf('/'),
      parent = path.slice(0, slash) || '/',
      name = path.slice(slash + 1);
    const listing = await this.json(
      `input/v1/file_upload?path=${encodeURIComponent(parent)}&name=${encodeURIComponent(name)}`
    );
    const files = (listing.files ?? []).filter(
      (/** @type {any} */ f) => f.path === parent && f.name === name && f.state === 'uploaded'
    );
    files.sort(
      (/** @type {any} */ a, /** @type {any} */ b) =>
        Date.parse(b.created_at) - Date.parse(a.created_at)
    );
    for (const file of files.slice(0, 20))
      if (contentHash(await this.readFileBytes(file.id)) === hash) return file;
    return null;
  }
  /** @param {string} id */
  async readFileBytes(id) {
    return new Uint8Array(
      await (
        await this.response(`input/v1/file_upload/${encodeURIComponent(id)}/download`)
      ).arrayBuffer()
    );
  }
  /** @param {string} dataType @param {string} range */
  async readRecords(dataType, range = '7d') {
    const q = `{__name__=${JSON.stringify(dataType)}}[${range}]`;
    const response = await this.response(`data/v1/records?q=${encodeURIComponent(q)}`);
    const text = await response.text();
    if (response.headers.get('content-type')?.includes('jsonl'))
      return text
        .split('\n')
        .filter((x) => x.trim())
        .map((x) => JSON.parse(x));
    const result = JSON.parse(text);
    return Array.isArray(result) ? result : result.records;
  }
  /** Bounded exact-folder listing for editable working copies. @param {string} folder */
  async listFiles(folder) {
    const listing = await this.json(`input/v1/file_upload?path=${encodeURIComponent(folder)}`);
    if (!Array.isArray(listing.files) || listing.files.length > 500)
      throw Error('Working-file listing capacity exceeded');
    return listing.files.filter(
      (/** @type {any} */ f) => f.path === folder && f.state === 'uploaded'
    );
  }
  /** Latest bytes and retained version IDs; historical byte matches are not current readback.
   * @param {string} path */
  async latestFile(path) {
    const slash = path.lastIndexOf('/'),
      parent = path.slice(0, slash) || '/',
      name = path.slice(slash + 1);
    const listing = await this.json(
      `input/v1/file_upload?path=${encodeURIComponent(parent)}&name=${encodeURIComponent(name)}`
    );
    if (!Array.isArray(listing.files) || listing.files.length > 500)
      throw Error('Working-file version capacity exceeded');
    const versions = listing.files
      .filter(
        (/** @type {any} */ f) => f.path === parent && f.name === name && f.state === 'uploaded'
      )
      .sort(
        (/** @type {any} */ a, /** @type {any} */ b) =>
          Date.parse(b.created_at) - Date.parse(a.created_at) ||
          String(b.id).localeCompare(String(a.id))
      );
    if (!versions.length) return null;
    if (Number(versions[0].size) > 64 * 1024) throw Error('Working-file content exceeds bound');
    const bytes = await this.readFileBytes(versions[0].id);
    if (bytes.byteLength > 64 * 1024) throw Error('Working-file content exceeds bound');
    return {
      id: versions[0].id,
      createdAt: versions[0].created_at,
      content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      versions
    };
  }
  /** @param {string} path */
  async readFile(path) {
    const slash = path.lastIndexOf('/');
    const parent = '/' + path.slice(0, slash).replace(/^\/+/, '');
    const name = path.slice(slash + 1);
    const listing = await this.json(
      `input/v1/file_upload?path=${encodeURIComponent(parent)}&name=${encodeURIComponent(name)}`
    );
    const files = (listing.files ?? []).filter(
      /** @param {any} file */ (file) => file.name === name && file.state === 'uploaded'
    );
    if (!files.length) return '';
    files.sort(
      /** @param {any} a @param {any} b */ (a, b) =>
        Date.parse(b.created_at ?? b.created ?? 0) - Date.parse(a.created_at ?? a.created ?? 0)
    );
    return (
      await this.response(`input/v1/file_upload/${encodeURIComponent(files[0].id)}/download`)
    ).text();
  }
}
