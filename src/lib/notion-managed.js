// The provider owns every binding and all metadata. Only declared text runs are editable.
const RESERVED = '<!-- fulcra-notion-managed:';
const PREFIX = '<!-- fulcra-notion-managed:1 -->\n```json\n';
const SUFFIX = '\n```';
const MAX_BYTES = 24 * 1024;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const EDITABLE_TYPES = new Set([
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'heading_4',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'quote',
  'callout',
  'code'
]);
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const encoder = new TextEncoder();

/** @param {string} reason @returns {never} */
function invalid(reason) {
  throw Error('Invalid managed Notion document: ' + reason);
}

/** @param {any} value */
function plainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

/** Reject data that JSON.stringify would silently alter or execute.
 * @param {any} value */
function validateJSON(value) {
  let nodes = 0;
  const ancestors = new WeakSet();
  /** @param {any} item @param {number} depth */
  function visit(item, depth) {
    if (++nodes > 10000 || depth > 32) invalid('metadata capacity exceeded');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) invalid('metadata must contain finite numbers');
      return;
    }
    if (typeof item === 'string') {
      if (
        /\0/.test(item) ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(item)
      )
        invalid('invalid text encoding');
      return;
    }
    if (typeof item !== 'object') invalid('metadata must be JSON data');
    const array = Array.isArray(item);
    if (array ? Object.getPrototypeOf(item) !== Array.prototype : !plainObject(item))
      invalid('metadata must contain plain objects');
    if (ancestors.has(item)) invalid('cyclic metadata');
    ancestors.add(item);
    const keys = Reflect.ownKeys(item);
    if (array && keys.length !== item.length + 1) invalid('invalid metadata array');
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || UNSAFE_KEYS.has(key)) invalid('unsafe metadata key');
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length))
        invalid('invalid metadata array');
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
        invalid('metadata must contain enumerable data properties');
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
  }
  visit(value, 0);
}

/** @param {any} value @param {string[]} expected */
function exactFields(value, expected) {
  if (
    !plainObject(value) ||
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    invalid('unexpected or missing fields');
}

/** @param {any} value */
function validateCapsule(value) {
  validateJSON(value);
  exactFields(value, ['version', 'pageId', 'blocks']);
  if (value.version !== 1 || typeof value.pageId !== 'string' || !UUID.test(value.pageId))
    invalid('invalid version or page binding');
  if (!Array.isArray(value.blocks) || value.blocks.length > 1000)
    invalid('invalid block collection');
  const ids = new Set();
  for (const block of value.blocks) {
    if (!plainObject(block) || typeof block.editable !== 'boolean')
      invalid('invalid block classification');
    exactFields(
      block,
      block.editable
        ? ['id', 'type', 'editable', 'texts', 'styles', 'attributes']
        : ['id', 'type', 'editable', 'snapshot']
    );
    if (typeof block.id !== 'string' || !UUID.test(block.id) || ids.has(block.id))
      invalid('invalid or repeated block binding');
    ids.add(block.id);
    if (typeof block.type !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(block.type))
      invalid('invalid block type');
    if (block.editable) {
      if (
        !EDITABLE_TYPES.has(block.type) ||
        !Array.isArray(block.texts) ||
        !block.texts.length ||
        !Array.isArray(block.styles) ||
        block.texts.length !== block.styles.length ||
        !plainObject(block.attributes) ||
        block.texts.some(
          (/** @type {any} */ text) => typeof text !== 'string' || text.length > 2000
        )
      )
        invalid('invalid editable text runs');
    }
  }
  return value;
}

/** Stable JSON independent of property insertion order. @param {any} value @returns {string} */
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}

/** Detect the reserved namespace even if its version or envelope is invalid.
 * @param {any} body */
export function isManaged(body) {
  return typeof body === 'string' && body.startsWith(RESERVED);
}

/** Ordinary Markdown returns null; a malformed reserved document fails closed.
 * @param {any} body @returns {any} */
export function parseManaged(body) {
  if (!isManaged(body)) return null;
  if (encoder.encode(body).length > MAX_BYTES || !body.startsWith(PREFIX) || !body.endsWith(SUFFIX))
    invalid('invalid envelope or body exceeds 24 KiB');
  let value;
  try {
    value = JSON.parse(body.slice(PREFIX.length, -SUFFIX.length));
  } catch {
    invalid('invalid JSON');
  }
  return validateCapsule(value);
}

/** @param {any} value */
export function encodeManaged(value) {
  const body = PREFIX + canonical(validateCapsule(value)) + SUFFIX;
  if (encoder.encode(body).length > MAX_BYTES) invalid('body exceeds 24 KiB');
  return body;
}

/** Validate against a trusted provider/baseline body, never user-supplied bindings.
 * @param {string} before @param {string} after @returns {any} */
export function validateManagedEdit(before, after) {
  const baseline = parseManaged(before),
    desired = parseManaged(after);
  if (!baseline || !desired) invalid('both edit sides must be managed');
  /** @param {any} value */
  const immutable = (value) => ({
    ...value,
    blocks: value.blocks.map((/** @type {any} */ block) => {
      if (!block.editable) return block;
      const { texts, ...rest } = block;
      return { ...rest, runCount: texts.length };
    })
  });
  if (canonical(immutable(baseline)) !== canonical(immutable(desired)))
    invalid('only existing editable text runs may change');
  return desired;
}

/** A deterministic one-block step permits recovery after a lost PATCH response.
 * @param {string} before @param {string} after */
export function planManagedEdit(before, after) {
  const desired = validateManagedEdit(before, after),
    intermediate = parseManaged(before);
  for (let i = 0; i < intermediate.blocks.length; i++) {
    const block = intermediate.blocks[i],
      next = desired.blocks[i];
    if (!block.editable || canonical(block.texts) === canonical(next.texts)) continue;
    const beforeTexts = [...block.texts];
    block.texts = [...next.texts];
    return {
      blockId: block.id,
      type: block.type,
      beforeTexts,
      afterTexts: [...next.texts],
      styles: block.styles,
      attributes: block.attributes,
      intermediate: encodeManaged(intermediate)
    };
  }
  return null;
}

/** Explicit conflict resolution may choose older text, while retaining current protected content.
 * Refuse layout/format/binding changes rather than guessing how runs correspond.
 * @param {string} chosenBody @param {string} currentBody */
export function rebaseManagedText(chosenBody, currentBody) {
  const chosen = parseManaged(chosenBody),
    current = parseManaged(currentBody);
  if (!chosen || !current) invalid('both resolution sides must be managed');
  const candidate = structuredClone(current);
  if (chosen.pageId !== current.pageId || chosen.blocks.length !== current.blocks.length)
    invalid('layout changed; use Notion and reapply text after syncing');
  for (let i = 0; i < current.blocks.length; i++) {
    const previous = chosen.blocks[i],
      next = candidate.blocks[i];
    if (
      previous.id !== next.id ||
      previous.type !== next.type ||
      previous.editable !== next.editable
    )
      invalid('layout changed; use Notion and reapply text after syncing');
    if (!next.editable) continue;
    const { texts: previousTexts, ...previousMetadata } = previous;
    const { texts: nextTexts, ...nextMetadata } = next;
    if (
      previousTexts.length !== nextTexts.length ||
      canonical(previousMetadata) !== canonical(nextMetadata)
    )
      invalid('layout or formatting changed; use Notion and reapply text after syncing');
    next.texts = [...previousTexts];
  }
  const body = encodeManaged(candidate);
  validateManagedEdit(currentBody, body);
  return body;
}
