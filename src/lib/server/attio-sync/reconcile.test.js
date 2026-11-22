import { expect, it } from 'vitest';
import { baselineFor, reconcile } from './reconcile.js';
import { projectRecord, projectNote } from '../../attio-documents.js';
const uuid = (/** @type {number} */ n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const a = uuid(10),
  b = uuid(11),
  c = uuid(12);
function record() {
  return projectRecord(
    {
      binding: { workspaceId: uuid(1), objectId: uuid(2), recordId: uuid(3) },
      title: 'Company',
      url: 'https://app.attio.com/example/company',
      attributes: [a, b, c].map((id) => ({
        id,
        slug: id,
        title: id,
        type: 'text',
        multiple: false,
        writable: true,
        required: false
      })),
      rawValues: { [a]: [{ value: 'A' }], [b]: [{ value: 'B' }], [c]: [{ value: 'C' }] }
    },
    [a, b]
  );
}

it('returns stable compact baselines keyed by editable field ID and excludes presentation rename churn', () => {
  const doc = record(),
    renamed = structuredClone(doc);
  renamed.attributes[0].slug = 'renamed';
  renamed.attributes[0].title = 'Renamed';
  expect(Object.keys(baselineFor(doc).fields).sort()).toEqual([a, b]);
  expect(baselineFor(renamed)).toEqual(baselineFor(doc));
  expect(baselineFor(doc)).toEqual(baselineFor(structuredClone(doc)));
});

it('pulls provider-only changes and pushes local-only changes with changed IDs', () => {
  const base = record(),
    baseline = baselineFor(base);
  const remote = structuredClone(base);
  remote.values[a] = ['Remote'];
  expect(reconcile({ baseline, local: base, remote })).toMatchObject({
    kind: 'pull',
    document: remote,
    changedIds: [],
    conflicts: []
  });
  const local = structuredClone(base);
  local.values[b] = ['Local'];
  expect(reconcile({ baseline, local, remote: base })).toMatchObject({
    kind: 'push',
    document: local,
    changedIds: [b],
    conflicts: []
  });
});

it('merges disjoint concurrent fields and writes only fields differing from current provider', () => {
  const base = record(),
    local = structuredClone(base),
    remote = structuredClone(base);
  local.values[a] = ['Local'];
  remote.values[b] = ['Remote'];
  remote.title = 'Provider title';
  const result = reconcile({ baseline: baselineFor(base), local, remote });
  expect(result.kind).toBe('push');
  expect(result.changedIds).toEqual([a]);
  expect(result.document.values).toEqual({ [a]: ['Local'], [b]: ['Remote'], [c]: ['C'] });
  expect(result.document.title).toBe('Provider title');
});

it('retains the accepted local candidate and reports same-field conflicts including removals', () => {
  const base = record(),
    local = structuredClone(base),
    remote = structuredClone(base);
  local.values[a] = [];
  remote.values[a] = ['Remote'];
  const result = reconcile({ baseline: baselineFor(base), local, remote });
  expect(result).toMatchObject({
    kind: 'conflict',
    document: local,
    changedIds: [],
    conflicts: [a]
  });
  expect(local.values[a]).toEqual([]);
  expect(remote.values[a]).toEqual(['Remote']);
});

it('converges equal concurrent changes and does not echo observed timestamp metadata', () => {
  const base = record(),
    local = structuredClone(base);
  local.values[a] = ['Same'];
  expect(
    reconcile({ baseline: baselineFor(base), local, remote: structuredClone(local) }).kind
  ).toBe('noop');
  expect(
    reconcile({ baseline: baselineFor(local), local, remote: structuredClone(local) }).kind
  ).toBe('noop');
});

it('never pushes divergent initial copies and distinguishes absent working copies from source loss', () => {
  const remote = record(),
    local = structuredClone(remote);
  local.values[a] = ['Local'];
  expect(reconcile({ baseline: null, local, remote }).kind).toBe('conflict');
  expect(reconcile({ baseline: null, local: null, remote })).toMatchObject({
    kind: 'pull',
    document: remote
  });
  expect(reconcile({ baseline: baselineFor(remote), local: null, remote }).kind).toBe('missing');
  expect(reconcile({ baseline: null, local, remote: null })).toMatchObject({
    kind: 'missing',
    document: local
  });
  expect(reconcile({ baseline: null, local: remote, remote }).kind).toBe('noop');
});

it('blocks schema/type/cardinality/options/writability changes while retaining accepted data', () => {
  const base = record(),
    local = structuredClone(base);
  local.values[a] = ['Accepted'];
  for (const mutate of [
    (/** @type {any} */ doc) => {
      doc.attributes[0].type = 'number';
      doc.values[a] = [1];
    },
    (/** @type {any} */ doc) => {
      doc.attributes[0].writable = false;
    },
    (/** @type {any} */ doc) => {
      doc.attributes[0].required = true;
    },
    (/** @type {any} */ doc) => {
      doc.binding.recordId = uuid(99);
    }
  ]) {
    const remote = structuredClone(base);
    mutate(remote);
    expect(reconcile({ baseline: baselineFor(base), local, remote })).toMatchObject({
      kind: 'schema_conflict',
      document: local,
      changedIds: []
    });
  }
});

it('pulls changed protected provider fields while never accepting forged local protected changes', () => {
  const base = record(),
    remote = structuredClone(base);
  remote.values[c] = ['Provider readonly'];
  expect(reconcile({ baseline: baselineFor(base), local: base, remote })).toMatchObject({
    kind: 'pull',
    document: remote
  });
  const local = structuredClone(base);
  local.values[c] = ['Forged'];
  expect(reconcile({ baseline: baselineFor(base), local, remote: base })).toMatchObject({
    kind: 'schema_conflict',
    document: local
  });
});

it('reconciles note title/text independently and protects lineage/head changes', () => {
  const base = projectNote({
    binding: { workspaceId: uuid(1), objectId: uuid(2), recordId: uuid(3), noteId: uuid(4) },
    title: 'Source',
    text: 'Text',
    url: ''
  });
  const local = { ...base, title: 'Draft' },
    remote = { ...base, text: 'Remote text' };
  expect(reconcile({ baseline: baselineFor(base), local, remote })).toMatchObject({
    kind: 'push',
    document: { title: 'Draft', text: 'Remote text' },
    changedIds: ['title']
  });
  expect(
    reconcile({ baseline: baselineFor(base), local, remote: { ...remote, headNoteId: uuid(5) } })
  ).toMatchObject({ kind: 'schema_conflict', document: local });
});

it('fences an archived option schema change even when the current value uses another active option', () => {
  const base = record();
  base.attributes[0].type = 'select';
  base.attributes[0].options = [
    { id: uuid(90), title: 'Current' },
    { id: uuid(91), title: 'Other' }
  ];
  base.values[a] = [uuid(90)];
  const remote = structuredClone(base);
  remote.attributes[0].options[1].archived = true;
  expect(baselineFor(remote).schemaHash).not.toBe(baselineFor(base).schemaHash);
  expect(reconcile({ baseline: baselineFor(base), local: base, remote }).kind).toBe(
    'schema_conflict'
  );
});
