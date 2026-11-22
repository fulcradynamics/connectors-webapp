import { it, expect } from 'vitest';
import { prepareRevision, matchesRevision } from './note-revisions.js';

const c = { id: 'connection', account_id: 'workspace' },
  entry = { binding: { objectId: 'object', recordId: 'record', noteId: 'original' } };
const revision = (/** @type {string} */ text) =>
  prepareRevision(c, entry, { title: 'Synthetic draft', text }, 'operation', 'nonce');
const observed = (/** @type {any} */ r) => ({
  title: r.title,
  text: r.markdown.replace(/\n\n/g, '\n')
});

it('verifies the expected Attio paragraph projection without accepting changed content or provenance', () => {
  const r = revision('**First paragraph.**\n\nSecond paragraph.');
  expect(matchesRevision({ title: r.title, text: r.markdown }, r)).toBe(true);
  expect(matchesRevision(observed(r), r)).toBe(true);
  expect(matchesRevision({ ...observed(r), title: 'Different title' }, r)).toBe(false);
  expect(
    matchesRevision({ ...observed(r), text: observed(r).text.replace('Second', 'Third') }, r)
  ).toBe(false);
  expect(
    matchesRevision(
      { ...observed(r), text: observed(r).text.replace('fulcra-attio-revision:', 'forged:') },
      r
    )
  ).toBe(false);
  expect(
    matchesRevision(observed(r), { ...r, marker: { ...r.marker, payloadHash: 'forged' } })
  ).toBe(false);
  expect(matchesRevision(observed(r), { ...r, marker: { ...r.marker, nonce: 'forged' } })).toBe(
    false
  );
});

it.each([
  '```text\nfirst\n\nsecond\n```',
  '    first\n\n    second',
  '- first\n\n- second',
  '> first\n\n> second',
  '# Heading\n\nParagraph',
  '| first | second |\n\n| third | fourth |',
  'Heading\n--\n\nParagraph',
  'a | b\n--- | ---\n\nc | d',
  'First  \n\nSecond',
  'First\\\n\nSecond',
  '-\n\nParagraph'
])('does not infer a serialized body for complex Markdown: %s', (text) => {
  const r = revision(text);
  expect(matchesRevision({ title: r.title, text: r.markdown }, r)).toBe(true);
  expect(matchesRevision(observed(r), r)).toBe(false);
});
