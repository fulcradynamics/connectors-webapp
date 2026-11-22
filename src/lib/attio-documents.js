// Browser-safe typed working documents. Provider metadata is never forwarded to write APIs.
export const MAX_DOCUMENT_BYTES = 48 * 1024;
export const MAX_NOTE_BYTES = 24 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TYPES = new Set([
  'text',
  'checkbox',
  'number',
  'date',
  'timestamp',
  'select',
  'status',
  'record-reference',
  'email-address',
  'domain'
]);
const MULTIPLE = new Set(['select', 'record-reference', 'email-address', 'domain']);
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const bytes = new TextEncoder();
/** @param {unknown} type */
export const supportedType = (type) => typeof type === 'string' && TYPES.has(type);
/** @param {any} value @returns {string} */
function string(value) {
  if (
    typeof value !== 'string' ||
    /\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  )
    throw Error('Invalid document text');
  return value;
}
/** @param {any} value */
function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw Error('Invalid stable ID');
  return value;
}
/** @param {any} value */
function object(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw Error('Invalid document object');
}
/** @param {any} value @param {string[]} required @param {string[]} optional */
function keys(value, required, optional = []) {
  object(value);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw Error('Invalid document fields');
}
/** Validate a bounded JSON tree before reading it (including direct, non-JSON edits).
 * @param {any} value @param {number} depth @param {Set<any>} seen */
function tree(value, depth = 0, seen = new Set()) {
  if (depth > 24) throw Error('Document nesting exceeds bound');
  if (typeof value === 'string') {
    string(value);
    return;
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw Error('Invalid document number');
    return;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) throw Error('Invalid document value');
  if (!Array.isArray(value)) object(value);
  if (Object.getOwnPropertySymbols(value).length) throw Error('Invalid document fields');
  seen.add(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (FORBIDDEN.has(key) || (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)))
      throw Error('Invalid document key');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
      throw Error('Invalid document property');
    tree(descriptor.value, depth + 1, seen);
  }
  if (Array.isArray(value) && Object.keys(value).length !== value.length)
    throw Error('Invalid sparse array');
  seen.delete(value);
}
/** @param {any} value @returns {string} */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
/** @param {any} a @param {any} b */
const equal = (a, b) => stable(a) === stable(b);
/** @param {any} value */
function safeURL(value) {
  // Reject URL control bytes and whitespace before parsing.
  // eslint-disable-next-line no-control-regex
  if (typeof value !== 'string' || /[\x00-\x20\x7f]/.test(value)) return '';
  try {
    const url = new URL(value),
      host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !host.includes('.') ||
      !/^[a-z0-9.-]+$/.test(host) ||
      /^[\d.]+$/.test(host) ||
      /(?:^|\.)(localhost|local|internal|test|invalid|example)$/.test(host)
    )
      return '';
    return url.href;
  } catch {
    return '';
  }
}
/** @param {any} value @param {boolean} note */
function bindingFor(value, note = false) {
  keys(value, ['workspaceId', 'objectId', 'recordId', ...(note ? ['noteId'] : [])]);
  return Object.fromEntries(Object.entries(value).map(([key, id]) => [key, uuid(id)]));
}
/** @param {any} value */
function attribute(value) {
  keys(
    value,
    ['id', 'slug', 'title', 'type', 'multiple', 'writable', 'required'],
    ['options', 'targetObjectIds']
  );
  if (['multiple', 'writable', 'required'].some((key) => typeof value[key] !== 'boolean'))
    throw Error('Invalid attribute capability');
  const result = /** @type {any} */ ({
    id: uuid(value.id),
    slug: string(value.slug),
    title: string(value.title),
    type: string(value.type),
    multiple: value.multiple,
    writable: value.writable,
    required: value.required
  });
  if (value.options !== undefined) {
    if (!Array.isArray(value.options)) throw Error('Invalid options');
    result.options = value.options.map((/** @type {any} */ option) => {
      keys(option, ['id', 'title'], ['archived']);
      if (option.archived !== undefined && typeof option.archived !== 'boolean')
        throw Error('Invalid archived option capability');
      return {
        id: uuid(option.id),
        title: string(option.title),
        ...(option.archived ? { archived: true } : {})
      };
    });
    if (
      new Set(result.options.map((/** @type {any} */ option) => option.id)).size !==
      result.options.length
    )
      throw Error('Duplicate option');
    result.options.sort((/** @type {any} */ a, /** @type {any} */ b) => a.id.localeCompare(b.id));
  }
  if (value.targetObjectIds !== undefined) {
    if (!Array.isArray(value.targetObjectIds)) throw Error('Invalid reference targets');
    result.targetObjectIds = value.targetObjectIds.map(uuid).sort();
    if (new Set(result.targetObjectIds).size !== result.targetObjectIds.length)
      throw Error('Duplicate target object');
  }
  if (
    result.writable &&
    (!supportedType(result.type) || (result.multiple && !MULTIPLE.has(result.type)))
  )
    throw Error('Unsupported writable attribute');
  return result;
}
/** Strict calendar date, without local timezone coercion. @param {any} value */
function date(value) {
  string(value);
  if (
    !/^\d{4}-\d\d-\d\d$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw Error('Invalid calendar date');
  return value;
}
/** UTC normalization preserves the fractional nanoseconds Date would discard. @param {any} value */
function timestamp(value) {
  string(value);
  const match = /^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(
    value
  );
  if (
    !match ||
    +match[2] > 23 ||
    +match[3] > 59 ||
    +match[4] > 59 ||
    (match[6] !== 'Z' && (+match[6].slice(1, 3) > 23 || +match[6].slice(4) > 59))
  )
    throw Error('Invalid zoned timestamp');
  date(match[1]);
  const seconds = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}${match[6]}`);
  if (Number.isNaN(seconds.getTime())) throw Error('Invalid timestamp');
  return `${seconds.toISOString().slice(0, 19)}.${(match[5] || '').padEnd(9, '0')}Z`;
}
/** @param {any} a @param {any[]} values @param {Set<string>|null} approved @param {boolean} editing */
function valuesFor(a, values, approved = null, editing = false) {
  if (!Array.isArray(values) || values.length > 1000 || (!a.multiple && values.length > 1))
    throw Error('Invalid attribute cardinality');
  if (editing && !values.length && (a.required || a.type === 'checkbox'))
    throw Error('Attribute cannot be cleared');
  const result = values.map((value) => {
    switch (a.type) {
      case 'text':
        return string(value);
      case 'checkbox':
        if (typeof value !== 'boolean') throw Error('Invalid checkbox');
        return value;
      case 'number': {
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          Math.abs(value * 10000 - Math.round(value * 10000)) >
            Math.max(1, Math.abs(value * 10000)) * Number.EPSILON * 2
        )
          throw Error('Number requires at most four decimals');
        return Object.is(value, -0) ? 0 : value;
      }
      case 'date':
        return date(value);
      case 'timestamp':
        return timestamp(value);
      case 'select':
      case 'status':
        uuid(value);
        {
          const option = a.options?.find((/** @type {any} */ option) => option.id === value);
          if (!option) throw Error('Unknown option ID');
          if (option.archived && (editing || a.writable))
            throw Error('Archived option is read-only');
        }
        return value;
      case 'record-reference': {
        keys(value, ['objectId', 'recordId']);
        const ref = { objectId: uuid(value.objectId), recordId: uuid(value.recordId) };
        if (
          !a.targetObjectIds?.includes(ref.objectId) ||
          (approved && !approved.has(`${ref.objectId}:${ref.recordId}`))
        )
          throw Error('Reference is outside approved selected resources');
        return ref;
      }
      case 'email-address':
        string(value);
        if (
          value.length > 320 ||
          !/^[^\s@<>]+@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(value)
        )
          throw Error('Invalid email address');
        return value;
      case 'domain':
        string(value);
        if (
          value.length > 253 ||
          !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(value)
        )
          throw Error('Invalid domain');
        return value.toLowerCase();
      default:
        throw Error('Unsupported typed attribute');
    }
  });
  if (new Set(result.map(stable)).size !== result.length) throw Error('Duplicate attribute values');
  if (a.multiple) result.sort((left, right) => stable(left).localeCompare(stable(right)));
  return result;
}
/** @param {any[]} resources */
function approvedSet(resources) {
  if (!Array.isArray(resources)) throw Error('Invalid approved resource selection');
  return new Set(
    resources.map((resource) => {
      const id = typeof resource === 'string' ? resource : resource?.id;
      if (typeof id !== 'string' || id.split(':').length !== 2)
        throw Error('Invalid approved resource ID');
      const [objectId, recordId] = id.split(':');
      return `${uuid(objectId)}:${uuid(recordId)}`;
    })
  );
}
/** @param {any} doc @returns {any} */
function boundedDocument(doc) {
  if (bytes.encode(stable(doc)).length + 1 > MAX_DOCUMENT_BYTES)
    throw Error('Document exceeds 48 KiB bound');
  return doc;
}
/** @param {any} doc @returns {any} */
function normalize(doc) {
  tree(doc);
  boundedDocument(doc);
  if (doc?.version !== 1 || !['record', 'note'].includes(doc.kind))
    throw Error('Invalid Attio document version or kind');
  if (doc.kind === 'note') {
    keys(doc, [
      'version',
      'kind',
      'binding',
      'headNoteId',
      'title',
      'text',
      'url',
      'representation'
    ]);
    if (doc.representation !== 'api-text-projection') throw Error('Invalid note representation');
    const title = string(doc.title),
      text = string(doc.text);
    if (!title.trim() || title.length > 200 || bytes.encode(text).length > MAX_NOTE_BYTES)
      throw Error('Invalid or oversized note draft');
    if (doc.url !== safeURL(doc.url)) throw Error('Invalid source URL');
    return boundedDocument({
      version: 1,
      kind: 'note',
      binding: bindingFor(doc.binding, true),
      headNoteId: uuid(doc.headNoteId),
      title,
      text,
      url: doc.url,
      representation: 'api-text-projection'
    });
  }
  keys(doc, ['version', 'kind', 'binding', 'title', 'url', 'attributes', 'values', 'protected']);
  if (!Array.isArray(doc.attributes) || doc.attributes.length > 512)
    throw Error('Invalid attribute schema');
  object(doc.values);
  object(doc.protected);
  const attributes = doc.attributes
    .map(attribute)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => a.id.localeCompare(b.id));
  if (
    new Set(attributes.map((/** @type {any} */ a) => a.id)).size !== attributes.length ||
    attributes.filter((/** @type {any} */ a) => a.writable).length > 32
  )
    throw Error('Attribute selection exceeds bound or duplicates IDs');
  const values = /** @type {Record<string, any[]>} */ ({}),
    protectedValues = /** @type {Record<string, any[]>} */ ({});
  for (const a of attributes) {
    const typed = supportedType(a.type);
    if (typed) {
      if (!Object.hasOwn(doc.values, a.id) || Object.hasOwn(doc.protected, a.id))
        throw Error('Missing or duplicate typed values');
      values[a.id] = valuesFor(a, doc.values[a.id]);
    } else {
      if (!Array.isArray(doc.protected[a.id]) || Object.hasOwn(doc.values, a.id))
        throw Error('Missing protected values');
      protectedValues[a.id] = JSON.parse(stable(doc.protected[a.id]));
    }
  }
  if (
    Object.keys(doc.values).length !== Object.keys(values).length ||
    Object.keys(doc.protected).length !== Object.keys(protectedValues).length
  )
    throw Error('Unknown document attribute');
  if (doc.url !== safeURL(doc.url)) throw Error('Invalid source URL');
  return boundedDocument({
    version: 1,
    kind: 'record',
    binding: bindingFor(doc.binding),
    title: string(doc.title),
    url: doc.url,
    attributes,
    values,
    protected: protectedValues
  });
}
/** @param {any} projection @param {string[]} writableIds @param {any[]} approvedResources */
export function projectRecord(projection, writableIds, approvedResources = []) {
  if (!Array.isArray(writableIds) || new Set(writableIds).size !== writableIds.length)
    throw Error('Invalid writable attribute selection');
  writableIds.forEach(uuid);
  const approved = approvedSet(approvedResources);
  const values = /** @type {Record<string, any[]>} */ ({}),
    protectedValues = /** @type {Record<string, any[]>} */ ({});
  if (!Array.isArray(projection.attributes)) throw Error('Missing record schema');
  object(projection.rawValues);
  tree(projection.rawValues);
  const attributes = projection.attributes.map((/** @type {any} */ input) => {
    const a = attribute({
      id: input.id,
      slug: input.slug,
      title: input.title,
      type: input.type,
      multiple: input.multiple,
      writable: false,
      required: input.required,
      ...(input.options !== undefined ? { options: input.options } : {}),
      ...(input.targetObjectIds !== undefined ? { targetObjectIds: input.targetObjectIds } : {})
    });
    const raw = projection.rawValues[a.id];
    if (!Array.isArray(raw)) throw Error('Incomplete attribute values');
    if (raw.some((/** @type {any} */ value) => value?.active_until != null))
      throw Error('Historic attribute values are not a current projection');
    if (!supportedType(a.type)) {
      protectedValues[a.id] = raw;
      return a;
    }
    const canonical = raw.map((/** @type {any} */ value) => {
      object(value);
      if (['text', 'checkbox', 'number', 'date', 'timestamp'].includes(a.type)) return value.value;
      if (a.type === 'select') return value.option?.id?.option_id;
      if (a.type === 'status') return value.status?.id?.status_id;
      if (a.type === 'email-address') return value.email_address;
      if (a.type === 'domain') return value.domain;
      return {
        objectId: value.target_object_id || value.target_object,
        recordId: value.target_record_id
      };
    });
    values[a.id] = valuesFor(a, canonical);
    a.writable =
      input.writable === true &&
      writableIds.includes(a.id) &&
      (!a.multiple || MULTIPLE.has(a.type));
    if (
      ['select', 'status'].includes(a.type) &&
      values[a.id].some((value) =>
        a.options?.some((/** @type {any} */ option) => option.id === value && option.archived)
      )
    )
      a.writable = false;
    if (
      a.type === 'record-reference' &&
      values[a.id].some((ref) => !approved.has(`${ref.objectId}:${ref.recordId}`))
    )
      a.writable = false;
    return a;
  });
  if (
    Object.keys(projection.rawValues).some(
      (id) => !attributes.some((/** @type {any} */ a) => a.id === id)
    )
  )
    throw Error('Unknown source attribute');
  return normalize({
    version: 1,
    kind: 'record',
    binding: bindingFor(projection.binding),
    title: string(projection.title),
    url: safeURL(projection.url),
    attributes,
    values,
    protected: protectedValues
  });
}
/** @param {any} projection @param {{originalNoteId?: string, headNoteId?: string}} options */
export function projectNote(projection, { originalNoteId, headNoteId } = {}) {
  const source = bindingFor(projection.binding, true);
  return normalize({
    version: 1,
    kind: 'note',
    binding: { ...source, noteId: originalNoteId || source.noteId },
    headNoteId: headNoteId || source.noteId,
    title: string(projection.title),
    text: string(projection.text),
    url: safeURL(projection.url),
    representation: 'api-text-projection'
  });
}
/** @param {any} before @param {any} candidate @param {any[]} approvedResources */
export function validateEdit(before, candidate, approvedResources = []) {
  const original = normalize(before),
    document = normalize(candidate);
  const immutable = (/** @type {any} */ doc) =>
    doc.kind === 'note' ? { ...doc, title: '', text: '' } : { ...doc, values: {} };
  if (!equal(immutable(original), immutable(document)))
    throw Error('Protected document metadata changed');
  const changedIds = /** @type {string[]} */ ([]);
  if (document.kind === 'note') {
    for (const id of ['title', 'text']) if (original[id] !== document[id]) changedIds.push(id);
  } else {
    const approved = approvedSet(approvedResources);
    for (const a of document.attributes) {
      if (equal(original.values[a.id], document.values[a.id])) continue;
      if (!a.writable) throw Error('Attribute is read-only');
      document.values[a.id] = valuesFor(a, document.values[a.id], approved, true);
      changedIds.push(a.id);
    }
  }
  return { document, changedIds };
}
/** @param {any} doc */
export function encodeDocument(doc) {
  return `${stable(normalize(doc))}\n`;
}
/** Strict JSON parser rejects duplicate fields before JSON.parse can erase the evidence.
 * @param {string} text */
export function decodeDocument(text) {
  string(text);
  if (bytes.encode(text).length > MAX_DOCUMENT_BYTES) throw Error('Document exceeds 48 KiB bound');
  const tokens =
    text.match(
      // JSON string tokens must reject literal control bytes.
      // eslint-disable-next-line no-control-regex
      /"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\]:,]|[ \t\r\n]+|./g
    ) || [];
  let index = 0;
  const next = () => {
    while (/^[ \t\r\n]+$/.test(tokens[index] || '')) index++;
    return tokens[index++];
  };
  /** @param {number} depth @returns {any} */
  function parse(depth) {
    if (depth > 24) throw Error('Document nesting exceeds bound');
    const token = next();
    if (token === '{') {
      const result = /** @type {Record<string,any>} */ ({});
      let key = next();
      if (key === '}') return result;
      while (true) {
        if (!key?.startsWith('"')) throw Error('Invalid JSON document');
        const name = JSON.parse(key);
        if (FORBIDDEN.has(name) || Object.hasOwn(result, name) || next() !== ':')
          throw Error('Invalid or duplicate JSON field');
        result[name] = parse(depth + 1);
        const delimiter = next();
        if (delimiter === '}') return result;
        if (delimiter !== ',') throw Error('Invalid JSON document');
        key = next();
      }
    }
    if (token === '[') {
      const result = /** @type {any[]} */ ([]);
      const saved = index,
        first = next();
      if (first === ']') return result;
      index = saved;
      while (true) {
        result.push(parse(depth + 1));
        const delimiter = next();
        if (delimiter === ']') return result;
        if (delimiter !== ',') throw Error('Invalid JSON document');
      }
    }
    if (!token || !/^(?:"|-?\d|true$|false$|null$)/.test(token))
      throw Error('Invalid JSON document');
    return JSON.parse(token);
  }
  const result = parse(0);
  if (next() !== undefined) throw Error('Invalid trailing document content');
  return normalize(result);
}
/** Document must be validated against its server-owned original before encoding writes.
 * Attio official write formats: https://docs.attio.com/rest-api/attribute-types/attribute-types
 * @param {any} doc @param {string[]} changedIds */
export function encodeValues(doc, changedIds) {
  const document = normalize(doc);
  if (
    document.kind !== 'record' ||
    !Array.isArray(changedIds) ||
    new Set(changedIds).size !== changedIds.length ||
    changedIds.length > 32
  )
    throw Error('Invalid changed attribute selection');
  const output = /** @type {Record<string,any[]>} */ ({});
  for (const id of changedIds) {
    uuid(id);
    const a = document.attributes.find((/** @type {any} */ attribute) => attribute.id === id);
    if (!a?.writable) throw Error('Attribute is read-only');
    const values = valuesFor(a, document.values[id], null, true);
    output[id] = values.map((value) => {
      if (a.type === 'select') return { option: value };
      if (a.type === 'status') return { status: value };
      if (a.type === 'record-reference')
        return { target_object: value.objectId, target_record_id: value.recordId };
      if (a.type === 'email-address') return { email_address: value };
      if (a.type === 'domain') return { domain: value };
      return { value };
    });
  }
  return output;
}
