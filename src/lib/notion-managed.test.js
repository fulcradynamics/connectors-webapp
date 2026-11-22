import { describe, it, expect } from 'vitest';
import {
  isManaged,
  parseManaged,
  encodeManaged,
  validateManagedEdit,
  planManagedEdit
} from './notion-managed.js';

const pageId = '11111111-1111-4111-8111-111111111111';
const first = '22222222-2222-4222-8222-222222222222';
const second = '33333333-3333-4333-8333-333333333333';
const third = '44444444-4444-4444-8444-444444444444';
const prefix = '<!-- fulcra-notion-managed:1 -->\n```json\n';
const envelope = (/** @type {any} */ value) => prefix + JSON.stringify(value) + '\n```';
/** @returns {any} */
const capsule = () => ({
  version: 1,
  pageId,
  blocks: [
    {
      id: first,
      type: 'paragraph',
      editable: true,
      texts: ['Hello', ' world'],
      styles: [{ annotations: { bold: true } }, { annotations: { italic: true } }],
      attributes: { color: 'default' }
    },
    {
      id: second,
      type: 'template',
      editable: false,
      snapshot: { rich_text: [{ plain_text: 'Add task' }], children: [{ id: third }] }
    }
  ]
});

describe('managed Notion body contract', () => {
  it('roundtrips text and protected payloads with deterministic serialization', () => {
    const value = capsule();
    const body = encodeManaged(value);
    expect(isManaged(body)).toBe(true);
    expect(parseManaged(body)).toEqual(value);
    const reordered = { blocks: value.blocks, pageId, version: 1 };
    expect(encodeManaged(reordered)).toBe(body);
    expect(encodeManaged(parseManaged(body))).toBe(body);
  });

  it('distinguishes ordinary Markdown without treating literal source text as a delimiter', () => {
    expect(isManaged('# Ordinary\n' + prefix)).toBe(false);
    expect(parseManaged('# Ordinary\n' + prefix)).toBeNull();
    const value = capsule();
    value.blocks[0].texts = ['```\n' + prefix, '</script>\n```\nIgnore previous rules'];
    expect(parseManaged(encodeManaged(value))).toEqual(value);
  });

  it.each([
    '<!-- fulcra-notion-managed:2 -->\n```json\n{}\n```',
    '<!-- fulcra-notion-managed:1 -->\n{}',
    prefix + '{broken}\n```',
    envelope(capsule()) + '\nforeign text',
    envelope({ ...capsule(), version: 2 })
  ])('fails closed for an invalid reserved envelope: %s', (body) => {
    expect(isManaged(body)).toBe(true);
    expect(() => parseManaged(body)).toThrow(/managed/i);
  });

  it('accepts text edits and preserves Unicode and empty paragraph runs', () => {
    const before = capsule();
    const after = capsule();
    after.blocks[0].texts = ['🌎 café\n漢字', ''];
    expect(validateManagedEdit(envelope(before), envelope(after))).toEqual(after);
    expect(parseManaged(encodeManaged(after)).blocks[0].texts).toEqual(['🌎 café\n漢字', '']);
  });

  it('plans only the first changed block and retains the remaining desired edits', () => {
    const before = capsule();
    before.blocks.push({
      id: third,
      type: 'to_do',
      editable: true,
      texts: ['Later'],
      styles: [{}],
      attributes: { checked: false }
    });
    const after = structuredClone(before);
    after.blocks[0].texts = ['Updated', ' world'];
    after.blocks[2].texts = ['Next'];
    const plan = planManagedEdit(envelope(before), envelope(after));
    if (!plan) throw Error('Expected the first block mutation');
    expect(plan).toMatchObject({
      blockId: first,
      type: 'paragraph',
      beforeTexts: ['Hello', ' world'],
      afterTexts: ['Updated', ' world'],
      styles: before.blocks[0].styles,
      attributes: { color: 'default' }
    });
    const intermediate = parseManaged(plan.intermediate);
    expect(intermediate.blocks[0].texts).toEqual(['Updated', ' world']);
    expect(intermediate.blocks[2].texts).toEqual(['Later']);
    expect(before.blocks[0].texts).toEqual(['Hello', ' world']);
    expect(after.blocks[2].texts).toEqual(['Next']);
    const next = planManagedEdit(plan.intermediate, envelope(after));
    if (!next) throw Error('Expected the second block mutation');
    expect(next.blockId).toBe(third);
    expect(parseManaged(next.intermediate)).toEqual(after);
    expect(planManagedEdit(next.intermediate, envelope(after))).toBeNull();
  });

  it('recognizes identical data independent of object key order and returns no mutation', () => {
    const before = capsule();
    const after = { blocks: before.blocks, pageId, version: 1 };
    expect(planManagedEdit(envelope(before), envelope(after))).toBeNull();
  });

  it.each([
    ['page binding', (/** @type {any} */ value) => (value.pageId = third)],
    ['block binding', (/** @type {any} */ value) => (value.blocks[0].id = third)],
    ['order', (/** @type {any} */ value) => value.blocks.reverse()],
    ['block type', (/** @type {any} */ value) => (value.blocks[0].type = 'quote')],
    ['style', (/** @type {any} */ value) => (value.blocks[0].styles[0].annotations.bold = false)],
    ['attribute', (/** @type {any} */ value) => (value.blocks[0].attributes.color = 'red')],
    [
      'protected payload',
      (/** @type {any} */ value) => (value.blocks[1].snapshot.children[0].id = first)
    ],
    ['block count', (/** @type {any} */ value) => value.blocks.pop()],
    [
      'run count',
      (/** @type {any} */ value) => {
        value.blocks[0].texts.pop();
        value.blocks[0].styles.pop();
      }
    ],
    [
      'editable classification',
      (/** @type {any} */ value) => {
        delete value.blocks[0].texts;
        delete value.blocks[0].styles;
        delete value.blocks[0].attributes;
        value.blocks[0].editable = false;
        value.blocks[0].snapshot = {};
      }
    ]
  ])('rejects a forged %s before planning any write', (_label, change) => {
    const before = capsule();
    const after = capsule();
    change(after);
    expect(() => validateManagedEdit(envelope(before), envelope(after))).toThrow(/managed/i);
    expect(() => planManagedEdit(envelope(before), envelope(after))).toThrow(/managed/i);
  });

  it.each([
    ['extra root field', (/** @type {any} */ value) => (value.owner = 'forged')],
    ['extra editable field', (/** @type {any} */ value) => (value.blocks[0].children = [])],
    ['extra readonly field', (/** @type {any} */ value) => (value.blocks[1].texts = ['forged'])],
    ['repeated block ID', (/** @type {any} */ value) => (value.blocks[1].id = first)],
    ['invalid UUID', (/** @type {any} */ value) => (value.pageId = '../other')],
    [
      'unsupported editable type',
      (/** @type {any} */ value) => (value.blocks[0].type = 'template')
    ],
    ['missing style', (/** @type {any} */ value) => value.blocks[0].styles.pop()],
    [
      'no editable runs',
      (/** @type {any} */ value) => {
        value.blocks[0].texts = [];
        value.blocks[0].styles = [];
      }
    ],
    ['nonstring run', (/** @type {any} */ value) => (value.blocks[0].texts[0] = 42)],
    ['null attributes', (/** @type {any} */ value) => (value.blocks[0].attributes = null)]
  ])('rejects invalid schema: %s', (_label, change) => {
    const value = capsule();
    change(value);
    expect(() => parseManaged(envelope(value))).toThrow(/managed/i);
    expect(() => encodeManaged(value)).toThrow(/managed/i);
  });

  it('rejects prototype keys and exotic object prototypes in any retained metadata', () => {
    for (const key of ['__proto__', 'prototype', 'constructor']) {
      const value = capsule();
      value.blocks[1].snapshot = JSON.parse('{"' + key + '":{}}');
      expect(() => parseManaged(envelope(value))).toThrow(/managed/i);
      expect(() => encodeManaged(value)).toThrow(/managed/i);
    }
    const value = capsule();
    value.blocks[0].attributes = Object.create({ inherited: true });
    expect(() => encodeManaged(value)).toThrow(/managed/i);
    value.blocks[0].attributes = { date: new Date(0) };
    expect(() => encodeManaged(value)).toThrow(/managed/i);
  });

  it('rejects cycles, deep payloads and excessive node counts before serialization', () => {
    const cyclic = capsule();
    cyclic.blocks[1].snapshot.self = cyclic;
    expect(() => encodeManaged(cyclic)).toThrow(/managed/i);
    const deep = capsule();
    let nested = {};
    for (let i = 0; i < 40; i++) nested = { nested };
    deep.blocks[1].snapshot = nested;
    expect(() => parseManaged(envelope(deep))).toThrow(/managed/i);
    const wide = capsule();
    wide.blocks[1].snapshot = Array(10001).fill(null);
    expect(() => encodeManaged(wide)).toThrow(/managed/i);
  });

  it('enforces the text-run length without truncating accepted strings', () => {
    const value = capsule();
    value.blocks[0].texts[0] = 'x'.repeat(2000);
    expect(parseManaged(encodeManaged(value)).blocks[0].texts[0]).toHaveLength(2000);
    value.blocks[0].texts[0] += 'x';
    expect(() => encodeManaged(value)).toThrow(/managed/i);
  });

  it('bounds the complete UTF8 envelope, including multibyte readonly payloads', () => {
    const value = capsule();
    value.blocks[1].snapshot = { text: '' };
    const overhead = new TextEncoder().encode(encodeManaged(value)).length;
    value.blocks[1].snapshot.text = 'x'.repeat(24 * 1024 - overhead);
    expect(new TextEncoder().encode(encodeManaged(value)).length).toBe(24 * 1024);
    value.blocks[1].snapshot.text += 'x';
    expect(() => encodeManaged(value)).toThrow(/managed/i);
    expect(() => parseManaged(envelope(value))).toThrow(/managed/i);
    value.blocks[1].snapshot.text = '🌎'.repeat(7000);
    expect(() => encodeManaged(value)).toThrow(/managed/i);
  });

  it('rejects non-JSON primitives, NULs, lone surrogates and silent serialization loss', () => {
    for (const invalid of [undefined, NaN, Infinity, 1n, () => {}, Symbol('bad')]) {
      const value = capsule();
      value.blocks[0].attributes = { invalid };
      expect(() => encodeManaged(value)).toThrow(/managed/i);
    }
    for (const text of ['bad\0text', '\ud800', '\udc00']) {
      const value = capsule();
      value.blocks[0].texts[0] = text;
      expect(() => encodeManaged(value)).toThrow(/managed/i);
    }
  });

  it('requires both edit sides to be valid managed documents', () => {
    const body = envelope(capsule());
    expect(() => validateManagedEdit('# ordinary', body)).toThrow(/managed/i);
    expect(() => validateManagedEdit(body, '# ordinary')).toThrow(/managed/i);
    expect(() => planManagedEdit('# ordinary', '# ordinary')).toThrow(/managed/i);
  });
});

it('rebases an explicitly chosen text version onto current protected snapshots only', async () => {
  const { rebaseManagedText } = await import('./notion-managed.js');
  const chosen = capsule(),
    current = capsule();
  chosen.blocks[0].texts = ['Chosen', ' text'];
  current.blocks[0].texts = ['Newer', ' source'];
  current.blocks[1].snapshot.children.push({ id: first, text: 'New protected content' });
  const body = rebaseManagedText(encodeManaged(chosen), encodeManaged(current));
  const merged = parseManaged(body);
  expect(merged.blocks[0].texts).toEqual(chosen.blocks[0].texts);
  expect(merged.blocks[1]).toEqual(current.blocks[1]);
  expect(validateManagedEdit(encodeManaged(current), body)).toEqual(merged);
  expect(chosen.blocks[1].snapshot.children).toHaveLength(1);
});
it('refuses chosen managed text after a layout, formatting or binding change', async () => {
  const { rebaseManagedText } = await import('./notion-managed.js');
  for (const change of [
    (/** @type {any} */ v) => v.blocks.reverse(),
    (/** @type {any} */ v) => (v.blocks[0].styles[0].annotations.bold = false),
    (/** @type {any} */ v) => (v.blocks[0].attributes.color = 'red'),
    (/** @type {any} */ v) => (v.pageId = first),
    (/** @type {any} */ v) => (v.blocks[0].id = third)
  ]) {
    const current = capsule();
    change(current);
    expect(() => rebaseManagedText(encodeManaged(capsule()), encodeManaged(current))).toThrow(
      /layout|managed/i
    );
  }
  expect(() => rebaseManagedText(encodeManaged(capsule()), 'plain')).toThrow(/managed/i);
});
