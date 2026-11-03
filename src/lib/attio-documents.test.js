import { describe, expect, it } from 'vitest';
import * as codec from './attio-documents.js';

const uuid = (/** @type {number} */ n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const binding = { workspaceId: uuid(1), objectId: uuid(2), recordId: uuid(3) };
const ids = Object.fromEntries(
  [
    'text',
    'checkbox',
    'number',
    'date',
    'timestamp',
    'select',
    'status',
    'record-reference',
    'email-address',
    'domain',
    'personal-name'
  ].map((t, i) => [t, uuid(10 + i)])
);
const option = uuid(30),
  otherOption = uuid(31),
  targetObject = uuid(40),
  targetRecord = uuid(41);
const approved = [`${targetObject}:${targetRecord}`];
/** @returns {any} */
function projection() {
  return {
    binding,
    title: 'Synthetic company',
    url: 'https://app.attio.com/example/companies/record',
    attributes: Object.entries(ids).map(([type, id]) => ({
      id,
      slug: type,
      title: type,
      type,
      multiple: ['select', 'domain', 'email-address', 'record-reference'].includes(type),
      writable: true,
      required: false,
      ...(['select', 'status'].includes(type)
        ? {
            options: [
              { id: option, title: 'One' },
              { id: otherOption, title: 'Two' }
            ]
          }
        : {}),
      ...(type === 'record-reference' ? { targetObjectIds: [targetObject] } : {})
    })),
    rawValues: {
      [ids.text]: [{ value: 'Hello ☀', attribute_type: 'text', active_until: null }],
      [ids.checkbox]: [{ value: true }],
      [ids.number]: [{ value: 5 }],
      [ids.date]: [{ value: '2024-02-29' }],
      [ids.timestamp]: [{ value: '2024-02-29T12:30:00.123456789Z' }],
      [ids.select]: [
        { option: { id: { option_id: option } } },
        { option: { id: { option_id: otherOption } } }
      ],
      [ids.status]: [{ status: { id: { status_id: option } } }],
      [ids['record-reference']]: [{ target_object: targetObject, target_record_id: targetRecord }],
      [ids['email-address']]: [{ email_address: 'person@example.com' }],
      [ids.domain]: [{ domain: 'example.com' }],
      [ids['personal-name']]: [{ first_name: 'Synthetic', full_name: 'Synthetic Person' }]
    }
  };
}
const doc = () => codec.projectRecord(projection(), Object.values(ids), approved);

it('projects all supported typed fields without spreading provider metadata; protects compound data', () => {
  const value = doc();
  expect(value.values[ids.text]).toEqual(['Hello ☀']);
  expect(value.values[ids.timestamp]).toEqual(['2024-02-29T12:30:00.123456789Z']);
  expect(value.values[ids['record-reference']]).toEqual([
    { objectId: targetObject, recordId: targetRecord }
  ]);
  expect(value.protected[ids['personal-name']]).toEqual(
    projection().rawValues[ids['personal-name']]
  );
  expect(
    value.attributes.find((/** @type {any} */ a) => a.type === 'personal-name')?.writable
  ).toBe(false);
  expect(codec.supportedType('currency')).toBe(false);
  expect(codec.decodeDocument(codec.encodeDocument(value))).toEqual(value);
});

it('encodes only changed approved IDs with documented Attio write shapes, including false zero and clears', () => {
  const before = doc(),
    candidate = structuredClone(before);
  candidate.values[ids.text] = [];
  candidate.values[ids.checkbox] = [false];
  candidate.values[ids.number] = [0];
  candidate.values[ids.select] = [otherOption];
  const result = codec.validateEdit(before, candidate, approved);
  expect(result.document).toEqual(candidate);
  expect(new Set(result.changedIds)).toEqual(
    new Set([ids.text, ids.checkbox, ids.number, ids.select])
  );
  expect(codec.encodeValues(result.document, result.changedIds)).toEqual({
    [ids.text]: [],
    [ids.checkbox]: [{ value: false }],
    [ids.number]: [{ value: 0 }],
    [ids.select]: [{ option: otherOption }]
  });
  expect(
    codec.encodeValues(before, [
      ids.status,
      ids['record-reference'],
      ids.date,
      ids.timestamp,
      ids.domain,
      ids['email-address']
    ])
  ).toEqual({
    [ids.status]: [{ status: option }],
    [ids['record-reference']]: [{ target_object: targetObject, target_record_id: targetRecord }],
    [ids.date]: [{ value: '2024-02-29' }],
    [ids.timestamp]: [{ value: '2024-02-29T12:30:00.123456789Z' }],
    [ids.domain]: [{ domain: 'example.com' }],
    [ids['email-address']]: [{ email_address: 'person@example.com' }]
  });
});

describe('rejects unsafe edits before an API value can be encoded', () => {
  const edits = /** @type {[string,(value:any)=>void][]} */ ([
    [
      'forged binding',
      (/** @type {any} */ x) => {
        x.binding.recordId = uuid(90);
      }
    ],
    [
      'forged capability',
      (/** @type {any} */ x) => {
        x.attributes[0].writable = false;
      }
    ],
    [
      'forged metadata',
      (/** @type {any} */ x) => {
        x.url = 'https://example.com/elsewhere';
      }
    ],
    [
      'unknown root key',
      (/** @type {any} */ x) => {
        x.extra = true;
      }
    ],
    [
      'unknown field',
      (/** @type {any} */ x) => {
        x.values[uuid(99)] = ['injected'];
      }
    ],
    [
      'removed field',
      (/** @type {any} */ x) => {
        delete x.values[ids.text];
      }
    ],
    [
      'protected value',
      (/** @type {any} */ x) => {
        x.protected[ids['personal-name']][0].full_name = 'Changed';
      }
    ],
    [
      'wrong primitive',
      (/** @type {any} */ x) => {
        x.values[ids.checkbox] = ['false'];
      }
    ],
    [
      'nonfinite number',
      (/** @type {any} */ x) => {
        x.values[ids.number] = [Infinity];
      }
    ],
    [
      'excess precision',
      (/** @type {any} */ x) => {
        x.values[ids.number] = [0.12345];
      }
    ],
    [
      'impossible date',
      (/** @type {any} */ x) => {
        x.values[ids.date] = ['2023-02-29'];
      }
    ],
    [
      'timestamp without zone',
      (/** @type {any} */ x) => {
        x.values[ids.timestamp] = ['2024-02-29T12:30:00'];
      }
    ],
    [
      'cardinality',
      (/** @type {any} */ x) => {
        x.values[ids.text] = ['one', 'two'];
      }
    ],
    [
      'unknown option',
      (/** @type {any} */ x) => {
        x.values[ids.select] = [uuid(99)];
      }
    ],
    [
      'reference outside selection',
      (/** @type {any} */ x) => {
        x.values[ids['record-reference']] = [{ objectId: targetObject, recordId: uuid(99) }];
      }
    ],
    [
      'reference creation payload',
      (/** @type {any} */ x) => {
        x.values[ids['record-reference']] = [
          { objectId: targetObject, recordId: targetRecord, create: {} }
        ];
      }
    ],
    [
      'checkbox clear',
      (/** @type {any} */ x) => {
        x.values[ids.checkbox] = [];
      }
    ],
    [
      'invalid UTF-16',
      (/** @type {any} */ x) => {
        x.values[ids.text] = ['\ud800'];
      }
    ],
    [
      'oversize',
      (/** @type {any} */ x) => {
        x.values[ids.text] = ['x'.repeat(48 * 1024)];
      }
    ]
  ]);
  it.each(edits)('%s', (_name, mutate) => {
    const before = doc(),
      candidate = structuredClone(before);
    mutate(candidate);
    expect(() => codec.validateEdit(before, candidate, approved)).toThrow();
  });
});

it('protects unselected and enriched fields and refuses to write their IDs', () => {
  const p = projection();
  p.attributes.find((/** @type {any} */ a) => a.type === 'number').writable = false;
  const before = codec.projectRecord(p, [ids.number], approved);
  expect(before.attributes.every((/** @type {any} */ a) => !a.writable)).toBe(true);
  const candidate = structuredClone(before);
  candidate.values[ids.text] = ['Changed'];
  expect(() => codec.validateEdit(before, candidate, approved)).toThrow();
  expect(() => codec.encodeValues(before, [ids.number])).toThrow();
});

it('requires nonempty required values and preserves explicitly empty text', () => {
  const p = projection();
  p.attributes[0].required = true;
  const before = codec.projectRecord(p, Object.values(ids), approved),
    candidate = structuredClone(before);
  candidate.values[ids.text] = [];
  expect(() => codec.validateEdit(before, candidate, approved)).toThrow();
  candidate.values[ids.text] = [''];
  expect(codec.validateEdit(before, candidate, approved).document.values[ids.text]).toEqual(['']);
});

it('rejects malformed encoded documents, prototype keys, duplicates, wrong types and oversized UTF-8', () => {
  for (const text of [
    '{}',
    '{"__proto__":{}}',
    '{"a":1,"a":2}',
    '{"constructor":{}}',
    '\ud800',
    'x'.repeat(48 * 1024 + 1)
  ])
    expect(() => codec.decodeDocument(text)).toThrow();
  const before = doc(),
    candidate = structuredClone(before);
  Object.setPrototypeOf(candidate.values, { pollution: true });
  expect(() => codec.validateEdit(before, candidate, approved)).toThrow();
  expect(() => codec.decodeDocument(/** @type {any} */ (new Uint8Array([0xff])))).toThrow();
});

it('normalizes timestamp offsets without losing nanoseconds and sanitizes source URLs', () => {
  const p = projection();
  p.rawValues[ids.timestamp][0].value = '2024-02-29T14:30:00.123456789+02:00';
  p.url = 'javascript:alert(1)';
  const value = codec.projectRecord(p, Object.values(ids), approved);
  expect(value.values[ids.timestamp]).toEqual(['2024-02-29T12:30:00.123456789Z']);
  expect(value.url).toBe('');
  for (const url of [
    'https://user:secret@app.attio.com/a',
    'http://app.attio.com/a',
    'https://127.0.0.1/a',
    'https://localhost/a'
  ]) {
    p.url = url;
    expect(codec.projectRecord(p, [], approved).url).toBe('');
  }
});

it('projects note lineage and allows only bounded title/text draft edits', () => {
  const original = uuid(70),
    head = uuid(71);
  const before = codec.projectNote(
    {
      binding: { ...binding, noteId: head },
      title: 'Note',
      text: 'Projected text',
      url: 'https://app.attio.com/example/note',
      createdAt: '2024-01-01T00:00:00Z'
    },
    { originalNoteId: original, headNoteId: head }
  );
  expect(before.binding.noteId).toBe(original);
  expect(before.headNoteId).toBe(head);
  expect(before.representation).toBe('api-text-projection');
  const candidate = { ...before, title: 'Draft', text: 'Unicode 😀\n' };
  expect(codec.validateEdit(before, candidate).changedIds).toEqual(['title', 'text']);
  expect(codec.decodeDocument(codec.encodeDocument(candidate))).toEqual(candidate);
  expect(() => codec.validateEdit(before, { ...candidate, headNoteId: original })).toThrow();
  expect(() => codec.validateEdit(before, { ...candidate, text: '😀'.repeat(6145) })).toThrow();
});

it('counts the entire encoded file including its trailing newline against 48 KiB', () => {
  const before = doc();
  const empty = structuredClone(before);
  empty.values[ids.text] = [''];
  const overhead = new TextEncoder().encode(codec.encodeDocument(empty)).length;
  const exact = structuredClone(empty);
  exact.values[ids.text] = ['x'.repeat(48 * 1024 - overhead)];
  expect(new TextEncoder().encode(codec.encodeDocument(exact)).length).toBe(48 * 1024);
  expect(codec.decodeDocument(codec.encodeDocument(exact))).toEqual(exact);
  const tooBig = structuredClone(exact);
  tooBig.values[ids.text][0] += 'x';
  expect(() => codec.encodeDocument(tooBig)).toThrow();
});

it('rejects duplicate known JSON fields and rejects getter/symbol/nonenumerable data', () => {
  const before = doc(),
    encoded = codec.encodeDocument(before);
  expect(() =>
    codec.decodeDocument(encoded.replace('"version":1', '"version":1,"version":1'))
  ).toThrow();
  for (const mutate of [
    (/** @type {any} */ x) =>
      Object.defineProperty(x.values, ids.text, { get: () => ['Injected'], enumerable: true }),
    (/** @type {any} */ x) => Object.defineProperty(x, 'hidden', { value: true }),
    (/** @type {any} */ x) => {
      x[Symbol('hidden')] = true;
    }
  ]) {
    const candidate = structuredClone(before);
    mutate(candidate);
    expect(() => codec.validateEdit(before, candidate, approved)).toThrow();
  }
});

it('never re-encodes an unapproved existing reference and keeps empty note drafts lossless', () => {
  const readonly = codec.projectRecord(projection(), Object.values(ids), []);
  expect(
    readonly.attributes.find((/** @type {any} */ a) => a.type === 'record-reference').writable
  ).toBe(false);
  expect(() => codec.encodeValues(readonly, [ids['record-reference']])).toThrow();
  const note = codec.projectNote({
    binding: { ...binding, noteId: uuid(70) },
    title: 'Title',
    text: '',
    url: ''
  });
  expect(codec.decodeDocument(codec.encodeDocument(note)).text).toBe('');
});

it('uses JSON whitespace rules and rejects localhost URLs with a trailing dot', () => {
  const encoded = codec.encodeDocument(doc());
  for (const whitespace of ['\u00a0', '\u000b', '\ufeff'])
    expect(() => codec.decodeDocument(encoded + whitespace)).toThrow();
  const p = projection();
  p.url = 'https://localhost./private';
  expect(codec.projectRecord(p, [], approved).url).toBe('');
});

it('preserves archived select/status current IDs as read-only while healthy fields remain editable', () => {
  const source = projection();
  for (const type of ['select', 'status']) {
    source.attributes.find((/** @type {any} */ a) => a.id === ids[type]).options[0].archived = true;
  }
  const before = codec.projectRecord(source, Object.values(ids), approved);
  expect(before.values[ids.select]).toEqual([option, otherOption]);
  expect(before.values[ids.status]).toEqual([option]);
  for (const type of ['select', 'status']) {
    const a = before.attributes.find((/** @type {any} */ value) => value.id === ids[type]);
    expect(a.writable).toBe(false);
    expect(a.options.find((/** @type {any} */ value) => value.id === option).archived).toBe(true);
    expect(() => codec.encodeValues(before, [ids[type]])).toThrow(/read-only|archived/i);
    const changed = structuredClone(before);
    changed.values[ids[type]] = [otherOption];
    expect(() => codec.validateEdit(before, changed, approved)).toThrow(/read-only/i);
  }
  expect(codec.decodeDocument(codec.encodeDocument(before))).toEqual(before);
  const healthy = structuredClone(before);
  healthy.values[ids.text] = ['Still editable'];
  expect(codec.validateEdit(before, healthy, approved).changedIds).toEqual([ids.text]);
});

it('rejects introducing archived options, forged archived capability and direct encoding of archived IDs', () => {
  const source = projection();
  source.rawValues[ids.select] = [{ option: { id: { option_id: otherOption } } }];
  source.attributes.find((/** @type {any} */ a) => a.id === ids.select).options[0].archived = true;
  const before = codec.projectRecord(source, Object.values(ids), approved);
  expect(before.attributes.find((/** @type {any} */ a) => a.id === ids.select).writable).toBe(true);
  const introduce = structuredClone(before);
  introduce.values[ids.select] = [option];
  expect(() => codec.validateEdit(before, introduce, approved)).toThrow(/archived/i);
  expect(() => codec.encodeValues(introduce, [ids.select])).toThrow(/archived/i);
  const forged = structuredClone(before);
  delete forged.attributes.find((/** @type {any} */ a) => a.id === ids.select).options[0].archived;
  forged.values[ids.select] = [option];
  expect(() => codec.validateEdit(before, forged, approved)).toThrow(/metadata/i);
  const currentArchived = structuredClone(source);
  currentArchived.rawValues[ids.select] = [{ option: { id: { option_id: option } } }];
  const readonly = codec.projectRecord(currentArchived, Object.values(ids), approved);
  readonly.attributes.find((/** @type {any} */ a) => a.id === ids.select).writable = true;
  expect(() => codec.encodeValues(readonly, [ids.select])).toThrow(/archived/i);
});
