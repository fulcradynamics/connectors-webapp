import { createHash } from 'node:crypto';
import { ProviderError } from '../connectors/http.js';

// Primary contract: https://api.attio.com/openapi/api (2026-11-02), /v2/self,
// objects, attributes/options/statuses, records/query, record PUT and notes.
const BASE = 'https://api.attio.com/v2/';
const MAX_BYTES = 2 * 1024 * 1024;
const PAGE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** @param {any} value */
function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new Error('Attio UUID identity required');
  return value.toLowerCase();
}
/** @param {string} objectId @param {string} recordId */
export function resourceId(objectId, recordId) {
  return `${uuid(objectId)}:${uuid(recordId)}`;
}
/** @param {string} id */
export function parseResource(id) {
  if (typeof id !== 'string' || id.length !== 73)
    throw new Error('Invalid Attio resource identity');
  const [objectId, recordId, extra] = id.split(':');
  if (extra !== undefined) throw new Error('Invalid Attio resource identity');
  return { objectId: uuid(objectId), recordId: uuid(recordId) };
}
/** @param {any} value @param {number} max */
function array(value, max) {
  if (!Array.isArray(value) || value.length > max)
    throw new Error('Attio page bound or shape invalid');
  return value;
}
/** @param {any} actual @param {Record<string,string>} expected */
function identity(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (uuid(actual?.[key]) !== value)
      throw new Error('Attio workspace/entity identity binding mismatch');
  }
}
/** @param {any} value */
function safeUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:' &&
      url.hostname === 'app.attio.com' &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {
    /* optional source link */
  }
  return undefined;
}
/** @param {any} item */
function title(item) {
  const name = item.values?.name?.[0];
  return String(
    name?.full_name ?? name?.value ?? item.values?.domains?.[0]?.domain ?? item.id?.record_id ?? ''
  ).slice(0, 500);
}
/** @param {any[]} values */
function fingerprint(values) {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
/** @param {any} cursor */
function encodeCursor(cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}
/** @param {any} cursor @param {string} kind */
function decodeCursor(cursor, kind) {
  if (typeof cursor !== 'string' || cursor.length > 600 || !/^[A-Za-z0-9_-]+$/.test(cursor))
    throw new Error('Invalid Attio cursor');
  try {
    const c = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      !c ||
      c.v !== 1 ||
      c.k !== kind ||
      Object.keys(c).some((key) => !['v', 'k', 'w', 'o', 'r', 'n', 'h'].includes(key)) ||
      !Number.isSafeInteger(c.n) ||
      c.n < 0 ||
      c.n > 1_000_000 ||
      c.n % PAGE !== 0 ||
      (c.h !== undefined && !/^[a-f0-9]{64}$/.test(c.h))
    )
      throw new Error();
    uuid(c.w);
    uuid(c.o);
    if (kind === 'notes') uuid(c.r);
    return c;
  } catch {
    throw new Error('Invalid Attio cursor');
  }
}
/** @param {string|null} header */
function retryAt(header) {
  const now = Date.now();
  const delay =
    header !== null && /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) * 1000 : NaN;
  const date = header && !Number.isFinite(delay) ? Date.parse(header) : NaN;
  const time = Number.isFinite(date)
    ? Math.max(now + 1000, date)
    : now + (Number.isFinite(delay) ? Math.max(1000, delay) : 60_000);
  return new Date(Math.min(time, 8.64e15)).toISOString();
}
/** @param {{fetchImpl?:typeof fetch}} options */
export function createAttioAPI({ fetchImpl = fetch } = {}) {
  // Serial, at most 8 requests/second for this deployment; other apps still share workspace limits.
  let nextRequest = 0;
  let queue = Promise.resolve();
  /** @param {any} credential @param {string} path @param {RequestInit} init @param {number} deadline */
  async function request(credential, path, init = {}, deadline = Date.now() + 10_000) {
    if (
      !credential ||
      typeof credential.token !== 'string' ||
      !credential.token ||
      /[\r\n]/.test(credential.token)
    )
      throw new Error('Attio credential required');
    if (!Number.isFinite(deadline) || deadline <= Date.now())
      throw new Error('Attio deadline exceeded');
    const url = new URL(path, BASE);
    if (url.origin !== 'https://api.attio.com' || !url.pathname.startsWith('/v2/'))
      throw new Error('Attio API origin invalid');
    const previous = queue;
    /** @type {()=>void} */ let release = () => {};
    queue = new Promise((resolve) => {
      release = resolve;
    });
    const controller = new AbortController();
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
    /** @type {ReadableStreamDefaultReader<Uint8Array>|undefined} */ let reader;
    try {
      const operation = (async () => {
        await previous;
        const wait = Math.max(0, nextRequest - Date.now());
        if (Date.now() + wait >= deadline) throw new Error('Attio deadline exceeded');
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        if (controller.signal.aborted) throw new Error('Attio deadline exceeded');
        nextRequest = Date.now() + 125;
        let response;
        try {
          response = await fetchImpl(url, {
            ...init,
            redirect: 'error',
            headers: {
              Authorization: `Bearer ${credential.token}`,
              'Content-Type': 'application/json',
              Accept: 'application/json'
            },
            signal: controller.signal
          });
        } catch {
          throw new Error(
            controller.signal.aborted ? 'Attio deadline exceeded' : 'Attio network request failed'
          );
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new ProviderError(
            response.status,
            response.status === 429 || response.status >= 500
              ? retryAt(response.headers.get('retry-after'))
              : null
          );
        }
        if (Number(response.headers.get('content-length')) > MAX_BYTES) {
          await response.body?.cancel();
          throw new Error('Attio response exceeds 2MiB bound');
        }
        if (!response.body) throw new Error('Attio response body missing');
        reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: true });
        const boundError = new Error('Attio response exceeds 2MiB bound');
        let bytes = 0,
          body = '';
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > MAX_BYTES) throw boundError;
            body += decoder.decode(part.value, { stream: true });
          }
          body += decoder.decode();
        } catch (error) {
          await reader.cancel().catch(() => {});
          if (error === boundError) throw boundError;
          // Stream errors may include private response bytes; retain only the safe category.
          // eslint-disable-next-line preserve-caught-error
          throw new Error('Attio response invalid UTF-8 encoding or unavailable');
        }
        try {
          return JSON.parse(body);
        } catch {
          throw new Error('Attio response invalid JSON');
        }
      })();
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => {
            controller.abort();
            void reader?.cancel().catch(() => {});
            reject(new Error('Attio deadline exceeded'));
          },
          Math.max(1, Math.min(8000, deadline - Date.now()))
        );
      });
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
      release();
    }
  }
  /** @param {any} credential @param {number} [deadline] */
  async function validate(credential, deadline) {
    const self = await request(credential, 'self', {}, deadline);
    if (self?.active !== true) throw new ProviderError(401);
    const workspaceId = uuid(self.workspace_id);
    if (typeof self.scope !== 'string') throw new Error('Attio scopes required');
    const scopes = self.scope.split(/\s+/).filter(Boolean);
    for (const required of ['object_configuration', 'record_permission']) {
      if (!scopes.includes(`${required}:read`) && !scopes.includes(`${required}:read-write`))
        throw new Error('Attio required read scopes missing');
    }
    return { accountId: workspaceId, workspaceId, scopes };
  }
  /** @param {string} objectId @param {any} credential @param {string} workspaceId @param {number} [deadline] */
  async function objectMetadata(objectId, credential, workspaceId, deadline) {
    uuid(objectId);
    uuid(workspaceId);
    const object = (await request(credential, `objects/${objectId}`, {}, deadline)).data;
    identity(object?.id, { workspace_id: workspaceId, object_id: objectId });
    if (!['people', 'companies'].includes(object.api_slug))
      throw new Error('Attio only People and Companies supported');
    return object;
  }
  /** @param {any} credential @param {string} workspaceId @param {number} [deadline] */
  async function objects(credential, workspaceId, deadline) {
    const items = array((await request(credential, 'objects', {}, deadline)).data, 500);
    const ids = new Set();
    for (const item of items) {
      identity(item?.id, { workspace_id: workspaceId });
      const id = uuid(item.id.object_id);
      if (ids.has(id)) throw new Error('Attio duplicate object identity');
      ids.add(id);
    }
    return items;
  }
  /** @param {{credential:any,cursor?:string|null,deadline?:number}} input */
  async function listResources({ credential, cursor = null, deadline = Date.now() + 10_000 }) {
    const c = cursor === null ? null : decodeCursor(cursor, 'records');
    const { workspaceId } = await validate(credential, deadline);
    if (c && c.w !== workspaceId) throw new Error('Attio cursor workspace mismatch');
    const allowed = (await objects(credential, workspaceId, deadline))
      .filter((object) => ['people', 'companies'].includes(object.api_slug))
      .sort((a, b) => a.id.object_id.localeCompare(b.id.object_id));
    const index = c ? allowed.findIndex((object) => object.id.object_id === c.o) : 0;
    if (index < 0) throw new Error('Attio cursor object mismatch');
    if (!allowed.length) return { resources: [], nextCursor: null };
    const objectId = uuid(allowed[index].id.object_id),
      offset = c?.n ?? 0;
    const records = array(
      (
        await request(
          credential,
          `objects/${objectId}/records/query`,
          { method: 'POST', body: JSON.stringify({ limit: PAGE, offset }) },
          deadline
        )
      ).data,
      PAGE
    );
    const seen = new Set();
    const resources = records.map((record) => {
      identity(record?.id, { workspace_id: workspaceId, object_id: objectId });
      const recordId = uuid(record.id.record_id),
        id = resourceId(objectId, recordId);
      if (seen.has(id)) throw new Error('Attio repeated record page');
      seen.add(id);
      return {
        id,
        name: title(record),
        kind: 'record',
        objectId,
        recordId,
        workspaceId,
        ...(safeUrl(record.web_url) ? { url: safeUrl(record.web_url) } : {})
      };
    });
    const hash = fingerprint(resources.map((item) => item.id));
    if (c?.h === hash && offset > 0 && resources.length)
      throw new Error('Attio repeated cursor page');
    const next =
      records.length === PAGE
        ? { v: 1, k: 'records', w: workspaceId, o: objectId, n: offset + PAGE, h: hash }
        : allowed[index + 1]
          ? { v: 1, k: 'records', w: workspaceId, o: allowed[index + 1].id.object_id, n: 0 }
          : null;
    if (next?.n > 1_000_000) throw new Error('Attio discovery cursor bound exceeded');
    return { resources, nextCursor: next ? encodeCursor(next) : null };
  }
  /** @param {string} id @param {any} credential @param {string} workspaceId @param {number} [deadline] */
  async function schema(id, credential, workspaceId, deadline = Date.now() + 10_000) {
    const { objectId } = parseResource(id);
    await objectMetadata(objectId, credential, workspaceId, deadline);
    /** @type {any[]} */ const result = [];
    const ids = new Set(),
      slugs = new Set();
    /** @type {any[]|null} */ let referenceObjects = null;
    for (let offset = 0; offset < 500; offset += 100) {
      const page = array(
        (
          await request(
            credential,
            `objects/${objectId}/attributes?limit=100&offset=${offset}&show_archived=true`,
            {},
            deadline
          )
        ).data,
        100
      );
      for (const attr of page) {
        identity(attr?.id, { workspace_id: workspaceId, object_id: objectId });
        const attributeId = uuid(attr.id.attribute_id);
        if (
          ids.has(attributeId) ||
          typeof attr.api_slug !== 'string' ||
          !/^[a-zA-Z0-9_]+$/.test(attr.api_slug) ||
          slugs.has(attr.api_slug) ||
          typeof attr.type !== 'string' ||
          typeof attr.title !== 'string' ||
          ['is_writable', 'is_required', 'is_multiselect', 'is_archived'].some(
            (key) => typeof attr[key] !== 'boolean'
          )
        )
          throw new Error('Attio schema invalid or repeated page');
        ids.add(attributeId);
        slugs.add(attr.api_slug);
        /** @type {any} */ const normalized = {
          id: attributeId,
          slug: attr.api_slug,
          title: attr.title,
          type: attr.type,
          multiple: attr.is_multiselect,
          // Reciprocal references can mutate or displace values on unselected records.
          // Only an explicit null relationship proves this field has no inverse.
          writable:
            attr.is_writable &&
            !attr.is_archived &&
            (attr.type !== 'record-reference' || attr.relationship === null),
          required: attr.is_required
        };
        if (['select', 'status'].includes(attr.type)) {
          const endpoint = attr.type === 'select' ? 'options' : 'statuses';
          const options = array(
            (
              await request(
                credential,
                `objects/${objectId}/attributes/${attributeId}/${endpoint}?show_archived=true`,
                {},
                deadline
              )
            ).data,
            5000
          );
          const optionIds = new Set();
          normalized.options = options
            .filter((option) => {
              identity(option?.id, {
                workspace_id: workspaceId,
                object_id: objectId,
                attribute_id: attributeId
              });
              const optionId = uuid(option.id[attr.type === 'select' ? 'option_id' : 'status_id']);
              if (
                optionIds.has(optionId) ||
                typeof option.title !== 'string' ||
                typeof option.is_archived !== 'boolean'
              )
                throw new Error('Attio schema option invalid');
              optionIds.add(optionId);
              return true;
            })
            .map((option) => ({
              id: uuid(option.id[attr.type === 'select' ? 'option_id' : 'status_id']),
              title: option.title,
              ...(option.is_archived ? { archived: true } : {})
            }));
        }
        if (attr.type === 'record-reference') {
          referenceObjects ??= await objects(credential, workspaceId, deadline);
          const allowedTargets = attr.config?.record_reference?.allowed_object_ids;
          const targets =
            allowedTargets === null || (Array.isArray(allowedTargets) && !allowedTargets.length)
              ? referenceObjects.map((item) => item.id.object_id)
              : array(allowedTargets, 500);
          normalized.targetObjectIds = targets.map((target) => {
            const found = referenceObjects?.find(
              (item) => item.id.object_id === target || item.api_slug === target
            );
            if (!found) throw new Error('Attio schema reference target unavailable');
            return uuid(found.id.object_id);
          });
        }
        result.push(normalized);
      }
      if (page.length < 100) return result;
    }
    throw new Error('Attio complete schema exceeds bound');
  }
  /** @param {string} id @param {any} credential @param {string} workspaceId @param {number} [deadline] */
  async function readRecord(id, credential, workspaceId, deadline = Date.now() + 10_000) {
    const { objectId, recordId } = parseResource(id);
    const attributes = await schema(id, credential, workspaceId, deadline);
    const record = (
      await request(credential, `objects/${objectId}/records/${recordId}`, {}, deadline)
    ).data;
    identity(record?.id, { workspace_id: workspaceId, object_id: objectId, record_id: recordId });
    if (typeof record.created_at !== 'string' || !Number.isFinite(Date.parse(record.created_at)))
      throw new Error('Attio record source timestamp missing');
    if (!record.values || typeof record.values !== 'object' || Array.isArray(record.values))
      throw new Error('Attio current values missing');
    /** @type {Record<string,any[]>} */ const rawValues = {};
    const known = new Map(
      attributes.flatMap((attr) => [
        [attr.id, attr],
        [attr.slug, attr]
      ])
    );
    const resolved = new Set();
    /** @type {any[]|null} */ let referenceObjects = null;
    for (const [key, values] of Object.entries(record.values)) {
      const attr = known.get(key);
      if (!attr || resolved.has(attr.id))
        throw new Error('Attio values do not match complete schema');
      resolved.add(attr.id);
      rawValues[attr.id] = array(values, 5000).map((value) => {
        if (
          !value ||
          typeof value !== 'object' ||
          value.active_until !== null ||
          typeof value.active_from !== 'string' ||
          !Number.isFinite(Date.parse(value.active_from)) ||
          value.attribute_type !== attr.type
        )
          throw new Error('Attio current active values invalid');
        return structuredClone(value);
      });
      if (attr.type === 'record-reference' && rawValues[attr.id].length) {
        referenceObjects ??= await objects(credential, workspaceId, deadline);
        for (const value of rawValues[attr.id]) {
          const target = referenceObjects.find(
            (item) =>
              item.id.object_id === value.target_object || item.api_slug === value.target_object
          );
          if (!target) throw new Error('Attio reference identity unresolved');
          value.target_object_id = uuid(target.id.object_id);
          uuid(value.target_record_id);
        }
      }
    }
    for (const attr of attributes) rawValues[attr.id] ??= [];
    return {
      binding: { workspaceId, objectId, recordId },
      title: title(record),
      url: safeUrl(record.web_url),
      createdAt: record.created_at,
      attributes,
      rawValues
    };
  }
  /** @param {string} id @param {Record<string,any[]>} valuesByAttributeId @param {any} credential @param {string} workspaceId @param {number} [deadline] */
  async function writeRecord(
    id,
    valuesByAttributeId,
    credential,
    workspaceId,
    deadline = Date.now() + 10_000
  ) {
    const { objectId, recordId } = parseResource(id);
    if (
      !valuesByAttributeId ||
      typeof valuesByAttributeId !== 'object' ||
      Array.isArray(valuesByAttributeId) ||
      !Object.keys(valuesByAttributeId).length ||
      Object.keys(valuesByAttributeId).length > 32
    )
      throw new Error('Attio encoded attributes required');
    for (const [key, values] of Object.entries(valuesByAttributeId)) {
      uuid(key);
      array(values, 5000);
    }
    const body = JSON.stringify({ data: { values: valuesByAttributeId } });
    if (Buffer.byteLength(body) > 48 * 1024) throw new Error('Attio write exceeds bound');
    await objectMetadata(objectId, credential, workspaceId, deadline);
    const record = (
      await request(
        credential,
        `objects/${objectId}/records/${recordId}`,
        { method: 'PUT', body },
        deadline
      )
    ).data;
    identity(record?.id, { workspace_id: workspaceId, object_id: objectId, record_id: recordId });
  }
  /** @param {any} note @param {any} object @param {{objectId:string,recordId:string}} parent @param {string} workspaceId @param {string} [expectedNoteId] */
  function projectNote(note, object, parent, workspaceId, expectedNoteId) {
    identity(note?.id, {
      workspace_id: workspaceId,
      ...(expectedNoteId ? { note_id: expectedNoteId } : {})
    });
    const noteId = uuid(note.id.note_id);
    if (
      ![parent.objectId, object.api_slug].includes(note.parent_object) ||
      uuid(note.parent_record_id) !== parent.recordId
    )
      throw new Error('Attio note parent binding mismatch');
    if (
      typeof note.title !== 'string' ||
      typeof note.content_markdown !== 'string' ||
      typeof note.created_at !== 'string' ||
      !Number.isFinite(Date.parse(note.created_at))
    )
      throw new Error('Attio note projection incomplete');
    return {
      binding: { workspaceId, ...parent, noteId },
      title: note.title,
      text: note.content_markdown,
      createdAt: note.created_at,
      representation: 'api-text-projection',
      partial: true
    };
  }
  /** @param {string} id @param {any} credential @param {string} workspaceId @param {string|null} [cursor] @param {number} [deadline] */
  async function listNotes(
    id,
    credential,
    workspaceId,
    cursor = null,
    deadline = Date.now() + 10_000
  ) {
    const parent = parseResource(id),
      c = cursor === null ? null : decodeCursor(cursor, 'notes');
    if (c && (c.w !== workspaceId || c.o !== parent.objectId || c.r !== parent.recordId))
      throw new Error('Attio note cursor parent binding mismatch');
    const object = await objectMetadata(parent.objectId, credential, workspaceId, deadline);
    const offset = c?.n ?? 0;
    const query = new URLSearchParams({
      parent_object: parent.objectId,
      parent_record_id: parent.recordId,
      limit: String(PAGE),
      offset: String(offset)
    });
    const notes = array((await request(credential, `notes?${query}`, {}, deadline)).data, PAGE).map(
      (note) => projectNote(note, object, parent, workspaceId)
    );
    const ids = notes.map((note) => note.binding.noteId),
      hash = fingerprint(ids);
    if (new Set(ids).size !== ids.length || (offset > 0 && notes.length && c?.h === hash))
      throw new Error('Attio repeated notes page');
    if (notes.length === PAGE && offset + PAGE > 1_000_000)
      throw new Error('Attio note cursor bound exceeded');
    return {
      notes,
      nextCursor:
        notes.length === PAGE
          ? encodeCursor({
              v: 1,
              k: 'notes',
              w: workspaceId,
              o: parent.objectId,
              r: parent.recordId,
              n: offset + PAGE,
              h: hash
            })
          : null
    };
  }
  /** @param {string} noteId @param {string} parentResourceId @param {any} credential @param {string} workspaceId @param {number} [deadline] */
  async function readNote(
    noteId,
    parentResourceId,
    credential,
    workspaceId,
    deadline = Date.now() + 10_000
  ) {
    uuid(noteId);
    const parent = parseResource(parentResourceId);
    const object = await objectMetadata(parent.objectId, credential, workspaceId, deadline);
    const note = (await request(credential, `notes/${noteId}`, {}, deadline)).data;
    return projectNote(note, object, parent, workspaceId, noteId);
  }
  /** @param {string} parentResourceId @param {{title:string,markdown:string}} draft @param {any} credential @param {string} workspaceId @param {number} [deadline] */
  async function createNote(
    parentResourceId,
    { title, markdown },
    credential,
    workspaceId,
    deadline = Date.now() + 10_000
  ) {
    const parent = parseResource(parentResourceId);
    if (
      typeof title !== 'string' ||
      !title.trim() ||
      Buffer.byteLength(title) > 1000 ||
      typeof markdown !== 'string' ||
      // The codec limits owner draft text to24KiB; total includes bounded provenance.
      Buffer.byteLength(markdown) > 26 * 1024
    )
      throw new Error('Attio note draft exceeds bound or invalid');
    const object = await objectMetadata(parent.objectId, credential, workspaceId, deadline);
    const data = {
      parent_object: parent.objectId,
      parent_record_id: parent.recordId,
      title,
      format: 'markdown',
      content: markdown
    };
    // Exactly one POST. Persisted caller owns attempt guards, uncertainty and independent GET readback.
    const note = (
      await request(
        credential,
        'notes',
        { method: 'POST', body: JSON.stringify({ data }) },
        deadline
      )
    ).data;
    return projectNote(note, object, parent, workspaceId);
  }
  return {
    validate,
    listResources,
    schema,
    readRecord,
    writeRecord,
    listNotes,
    readNote,
    createNote
  };
}
export const attioAPI = createAttioAPI();
