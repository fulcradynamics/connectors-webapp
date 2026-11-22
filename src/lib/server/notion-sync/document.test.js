import { it, expect } from 'vitest';
import {
  encodeDocument,
  decodeDocument,
  documentHash,
  decideSync,
  normalizeDocument
} from './document.js';
const doc = (markdown = 'Hello\n', title = 'Demo', archived = false) => ({
  title,
  markdown,
  archived
});
it('round-trips strict working files without trusting editable page or parent IDs', () => {
  const input = doc('## Heading\n\n- [ ] Task\n\n```js\n1 + 1\n```\n', 'Quotes " and newline\n');
  const encoded = encodeDocument(input);
  expect(decodeDocument(encoded)).toEqual(normalizeDocument(input));
  expect(() =>
    decodeDocument(encoded.replace('archived: false', 'notion_page_id: "foreign"\narchived: false'))
  ).toThrow(/metadata/i);
  expect(() =>
    decodeDocument(encoded.replace('archived: false', 'archived: false\narchived: true'))
  ).toThrow(/metadata/i);
  expect(() => decodeDocument(encoded.replace('archived: false', 'archived: "false"'))).toThrow(
    /archive/i
  );
  expect(() => decodeDocument('body without metadata')).toThrow(/metadata/i);
});
it('normalizes line endings/trailing newlines while enforcing real byte and title bounds', () => {
  expect(documentHash(doc('A\r\n\r\n'))).toBe(documentHash(doc('A\n')));
  expect(() => encodeDocument(doc('🙂'.repeat(6145)))).toThrow(/24 KiB/);
  expect(() => encodeDocument(doc('abc\0def'))).toThrow(/content/i);
  expect(() => encodeDocument(doc('a', 'x'.repeat(201)))).toThrow(/title/i);
  expect(() => encodeDocument({ ...doc(), unknown: 'value' })).toThrow(/fields/i);
});
it('decides single-sided changes, equal edits, simultaneous conflict and archive/restore', () => {
  const original = doc();
  const base = { notion: documentHash(original), fulcra: documentHash(original) };
  expect(decideSync(base, { notion: original, fulcra: original })).toBe('noop');
  expect(decideSync(base, { notion: doc('remote'), fulcra: original })).toBe('pull');
  expect(decideSync(base, { notion: original, fulcra: doc('local') })).toBe('push');
  expect(decideSync(base, { notion: doc('equal'), fulcra: doc('equal') })).toBe('converge');
  expect(decideSync(base, { notion: doc('remote'), fulcra: doc('local') })).toBe('conflict');
  expect(decideSync(base, { notion: doc('Hello', 'Demo', true), fulcra: original })).toBe('pull');
  expect(decideSync(null, { notion: original, fulcra: null })).toBe('pull');
  expect(decideSync(base, { notion: original, fulcra: null })).toBe('missing');
  expect(decideSync(base, { notion: null, fulcra: original })).toBe('inaccessible');
});
