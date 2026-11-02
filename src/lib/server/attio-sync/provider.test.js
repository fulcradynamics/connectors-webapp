import { describe, expect, it, vi } from 'vitest';
import { createAttioAPI, parseResource, resourceId } from './provider.js';

const W = '10000000-0000-4000-8000-000000000001';
const O = '20000000-0000-4000-8000-000000000001';
const C = '20000000-0000-4000-8000-000000000002';
const R = '30000000-0000-4000-8000-000000000001';
const A = '40000000-0000-4000-8000-000000000001';
const N = '50000000-0000-4000-8000-000000000001';
const P = '60000000-0000-4000-8000-000000000001';
const credential = { token: 'synthetic-test-token' };
const self = {
  active: true,
  workspace_id: W,
  scope: 'object_configuration:read record_permission:read note:read',
  token_level: 'workspace'
};
const object = (id = O, slug = 'people') => ({
  id: { workspace_id: W, object_id: id },
  api_slug: slug
});
const attribute = (extra = {}) => ({
  id: { workspace_id: W, object_id: O, attribute_id: A },
  api_slug: 'description',
  title: 'Description',
  type: 'text',
  is_multiselect: false,
  is_required: false,
  is_writable: true,
  is_archived: false,
  config: {},
  ...extra
});
const record = (extra = {}) => ({
  id: { workspace_id: W, object_id: O, record_id: R },
  created_at: '2026-01-01T00:00:00Z',
  web_url: 'https://app.attio.com/example/person/' + R,
  values: {
    description: [
      {
        attribute_type: 'text',
        value: 'Original',
        active_from: '2026-01-01T00:00:00Z',
        active_until: null
      }
    ]
  },
  ...extra
});
const note = (extra = {}) => ({
  id: { workspace_id: W, note_id: N },
  parent_object: 'people',
  parent_record_id: R,
  title: 'Meeting',
  content_plaintext: 'Hello link',
  content_markdown: '**Hello** [link](https://example.com)',
  created_at: '2026-01-01T00:00:00Z',
  ...extra
});
/** @param {Record<string,any>} routes */
function fixture(routes = {}) {
  const fetchImpl = vi.fn(async (url, init) => {
    const u = new URL(url);
    const key = `${init.method ?? 'GET'} ${u.pathname}${u.search}`;
    let value =
      routes[key] ??
      {
        'GET /v2/self': self,
        [`GET /v2/objects/${O}`]: { data: object() },
        [`GET /v2/objects/${C}`]: { data: object(C, 'companies') }
      }[key];
    if (typeof value === 'function') value = value(init);
    if (value === undefined) throw new Error('Unexpected fixture route ' + key);
    return value instanceof Response ? value : Response.json(value);
  });
  return { fetchImpl, api: createAttioAPI({ fetchImpl }) };
}
describe('Attio fixed-origin provider', () => {
  it('requires active=true, workspace UUID and read scopes, never sub or client identity', async () => {
    for (const bad of [
      { active: false },
      { ...self, workspace_id: undefined },
      { ...self, workspace_id: 'workspace' },
      { ...self, scope: 'note:read' }
    ]) {
      const { api } = fixture({ 'GET /v2/self': bad });
      await expect(api.validate(credential)).rejects.toThrow();
    }
    expect(await fixture().api.validate(credential)).toEqual({
      accountId: W,
      workspaceId: W,
      scopes: self.scope.split(' ')
    });
  });
  it('uses only UUID resource identities', () => {
    expect(parseResource(resourceId(O, R))).toEqual({ objectId: O, recordId: R });
    for (const bad of ['people:' + R, O + ':' + R + ':extra', 'https://evil.test/' + R])
      expect(() => parseResource(bad)).toThrow();
  });
  it('discovers bounded People/Companies pages and binds cursors to actual workspace/object', async () => {
    const records = Array.from({ length: 25 }, (_, i) =>
      record({
        id: {
          workspace_id: W,
          object_id: O,
          record_id: `30000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
        }
      })
    );
    const { api, fetchImpl } = fixture({
      'GET /v2/objects': { data: [object(), object(C, 'companies'), object(A, 'deals')] },
      [`POST /v2/objects/${O}/records/query`]: (/** @type {any} */ init) => ({
        data: JSON.parse(init.body).offset ? [] : records
      })
    });
    const first = await api.listResources({ credential });
    expect(first.resources).toHaveLength(25);
    expect(first.resources[0]).toMatchObject({
      id: O + ':' + R,
      workspaceId: W,
      objectId: O,
      recordId: R,
      kind: 'record'
    });
    expect(first.nextCursor).toBeTruthy();
    expect(JSON.parse(/** @type {any} */ (fetchImpl.mock.calls.at(-1))[1].body)).toEqual({
      limit: 25,
      offset: 0
    });
    await api.listResources({ credential, cursor: first.nextCursor });
    expect(JSON.parse(/** @type {any} */ (fetchImpl.mock.calls.at(-1))[1].body)).toEqual({
      limit: 25,
      offset: 25
    });
    await expect(api.listResources({ credential, cursor: 'https://evil.test' })).rejects.toThrow(
      /cursor/i
    );
    const other = fixture({
      'GET /v2/self': { ...self, workspace_id: C },
      'GET /v2/objects': { data: [] }
    });
    await expect(other.api.listResources({ credential, cursor: first.nextCursor })).rejects.toThrow(
      /workspace|cursor/i
    );
  });
  it('rejects mismatched objects and record identities', async () => {
    const mismatches = [
      { id: { workspace_id: C, object_id: O, record_id: R } },
      { id: { workspace_id: W, object_id: C, record_id: R } }
    ];
    for (const extra of mismatches) {
      const { api } = fixture({
        [`GET /v2/objects/${O}/attributes?limit=100&offset=0&show_archived=true`]: {
          data: [attribute()]
        },
        [`GET /v2/objects/${O}/records/${R}`]: { data: record(extra) }
      });
      await expect(api.readRecord(O + ':' + R, credential, W)).rejects.toThrow(
        /identity|workspace|binding/i
      );
    }
    await expect(
      fixture({ [`GET /v2/objects/${O}`]: { data: object(C) } }).api.schema(
        O + ':' + R,
        credential,
        W
      )
    ).rejects.toThrow(/identity|binding/i);
  });
  it('maps current values and option metadata to stable attribute IDs, preserving unsupported raw values', async () => {
    const { api } = fixture({
      [`GET /v2/objects/${O}/attributes?limit=100&offset=0&show_archived=true`]: {
        data: [attribute({ type: 'select', is_multiselect: true })]
      },
      [`GET /v2/objects/${O}/attributes/${A}/options?show_archived=true`]: {
        data: [
          {
            id: { workspace_id: W, object_id: O, attribute_id: A, option_id: P },
            title: 'Qualified',
            is_archived: false
          }
        ]
      },
      [`GET /v2/objects/${O}/records/${R}`]: { data: record({ values: { description: [] } }) }
    });
    const result = await api.readRecord(O + ':' + R, credential, W);
    expect(result.attributes).toEqual([
      {
        id: A,
        slug: 'description',
        title: 'Description',
        type: 'select',
        multiple: true,
        writable: true,
        required: false,
        options: [{ id: P, title: 'Qualified' }]
      }
    ]);
    expect(result.rawValues).toEqual({ [A]: [] });
  });
  it('fails closed on unknown, historic or truncated schema values', async () => {
    for (const values of [
      { unknown: [] },
      { description: [{ value: 'old', active_until: '2025-01-01T00:00:00Z' }] }
    ]) {
      const { api } = fixture({
        [`GET /v2/objects/${O}/attributes?limit=100&offset=0&show_archived=true`]: {
          data: [attribute()]
        },
        [`GET /v2/objects/${O}/records/${R}`]: { data: record({ values }) }
      });
      await expect(api.readRecord(O + ':' + R, credential, W)).rejects.toThrow(
        /schema|current|active/i
      );
    }
  });
  it('PUT replaces only explicitly supplied encoded attribute values, including clear/false/zero', async () => {
    const { api, fetchImpl } = fixture({
      [`PUT /v2/objects/${O}/records/${R}`]: { data: record() }
    });
    const values = { [A]: [], [P]: [{ value: false }, { value: 0 }] };
    await api.writeRecord(O + ':' + R, values, credential, W);
    const [url, init] = /** @type {any} */ (fetchImpl.mock.calls.at(-1));
    expect(String(url)).toBe(`https://api.attio.com/v2/objects/${O}/records/${R}`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ data: { values } });
    expect(init.redirect).toBe('error');
    expect(
      fetchImpl.mock.calls.some(([, req]) => req.method === 'PATCH' || req.method === 'DELETE')
    ).toBe(false);
    await expect(
      api.writeRecord(O + ':' + R, { description: [] }, credential, W)
    ).rejects.toThrow();
  });
  it('reads parent-filtered note pages and creates only linked revisions with honest rich-content limits', async () => {
    const query = `GET /v2/notes?parent_object=${O}&parent_record_id=${R}&limit=25&offset=0`;
    const { api, fetchImpl } = fixture({
      [query]: { data: [note()] },
      [`GET /v2/notes/${N}`]: { data: note() },
      'POST /v2/notes': { data: note() }
    });
    const page = await api.listNotes(O + ':' + R, credential, W);
    expect(page.nextCursor).toBeNull();
    expect(page.notes[0]).toMatchObject({
      binding: { workspaceId: W, objectId: O, recordId: R, noteId: N },
      text: note().content_markdown,
      representation: 'api-text-projection',
      partial: true
    });
    await api.readNote(N, O + ':' + R, credential, W);
    await api.createNote(O + ':' + R, { title: 'Revision', markdown: 'draft' }, credential, W);
    expect(JSON.parse(/** @type {any} */ (fetchImpl.mock.calls.at(-1))[1].body)).toEqual({
      data: {
        parent_object: O,
        parent_record_id: R,
        title: 'Revision',
        format: 'markdown',
        content: 'draft'
      }
    });
    expect(fetchImpl.mock.calls.some(([, req]) => ['PATCH', 'DELETE'].includes(req.method))).toBe(
      false
    );
  });
  it('rejects note workspace/parent/note mismatches and forged note cursors', async () => {
    for (const extra of [
      { parent_record_id: N },
      { parent_object: 'companies' },
      { id: { workspace_id: C, note_id: N } },
      { id: { workspace_id: W, note_id: P } }
    ]) {
      const { api } = fixture({ [`GET /v2/notes/${N}`]: { data: note(extra) } });
      await expect(api.readNote(N, O + ':' + R, credential, W)).rejects.toThrow(
        /binding|identity|workspace|parent/i
      );
    }
    await expect(fixture().api.listNotes(O + ':' + R, credential, W, '{}')).rejects.toThrow(
      /cursor/i
    );
  });
  it('preserves HTTP-date Retry-After and sanitizes provider errors', async () => {
    const future = new Date(Date.now() + 3600_000).toUTCString();
    const { api } = fixture({
      'GET /v2/self': new Response('private body synthetic-test-token', {
        status: 429,
        headers: { 'retry-after': future }
      })
    });
    try {
      await api.validate(credential);
      throw new Error('expected error');
    } catch (error) {
      const e = /** @type {any} */ (error);
      expect(e.status).toBe(429);
      expect(e.retryAt).toBe(new Date(future).toISOString());
      expect(e.message).not.toContain('synthetic');
    }
  });
  it('enforces deadlines, streamed byte bounds and strict UTF-8 before parsing', async () => {
    const expired = fixture();
    await expect(expired.api.validate(credential, Date.now() - 1)).rejects.toThrow(/deadline/i);
    expect(expired.fetchImpl).not.toHaveBeenCalled();
    for (const bytes of [new Uint8Array(2 * 1024 * 1024 + 1).fill(32), new Uint8Array([0xff])]) {
      const { api } = fixture({
        'GET /v2/self': new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            }
          })
        )
      });
      await expect(api.validate(credential)).rejects.toThrow(/bound|UTF|encoding/i);
    }
  });
  it('paginates a complete schema by actual limit/offset and rejects repeated pages', async () => {
    const attrs = Array.from({ length: 100 }, (_, i) =>
      attribute({
        id: {
          workspace_id: W,
          object_id: O,
          attribute_id: `40000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
        },
        api_slug: 'field_' + i
      })
    );
    /** @type {Record<string,any>} */
    const routes = {
      [`GET /v2/objects/${O}/attributes?limit=100&offset=0&show_archived=true`]: { data: attrs },
      [`GET /v2/objects/${O}/attributes?limit=100&offset=100&show_archived=true`]: { data: [] }
    };
    const { api } = fixture(routes);
    expect(await api.schema(O + ':' + R, credential, W)).toHaveLength(100);
    routes[`GET /v2/objects/${O}/attributes?limit=100&offset=100&show_archived=true`] = {
      data: attrs
    };
    await expect(fixture(routes).api.schema(O + ':' + R, credential, W)).rejects.toThrow(
      /schema|repeated/i
    );
  });
  it('resolves reference slugs and schema targets to UUIDs without creating a reference record', async () => {
    const { api, fetchImpl } = fixture({
      'GET /v2/objects': { data: [object(), object(C, 'companies')] },
      [`GET /v2/objects/${O}/attributes?limit=100&offset=0&show_archived=true`]: {
        data: [
          attribute({
            type: 'record-reference',
            config: { record_reference: { allowed_object_ids: ['companies'] } }
          })
        ]
      },
      [`GET /v2/objects/${O}/records/${R}`]: {
        data: record({
          values: {
            description: [
              {
                attribute_type: 'record-reference',
                target_object: 'companies',
                target_record_id: N,
                active_until: null,
                active_from: '2026-01-01T00:00:00Z'
              }
            ]
          }
        })
      }
    });
    const projection = await api.readRecord(O + ':' + R, credential, W);
    expect(projection.attributes[0].targetObjectIds).toEqual([C]);
    expect(projection.rawValues[A][0]).toMatchObject({
      target_object: 'companies',
      target_object_id: C,
      target_record_id: N
    });
    expect(fetchImpl.mock.calls.every(([, init]) => !init.method || init.method === 'GET')).toBe(
      true
    );
  });
  it('rejects repeated discovery pages instead of accepting a shifted/replayed offset', async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      record({
        id: {
          workspace_id: W,
          object_id: O,
          record_id: `30000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
        }
      })
    );
    const { api } = fixture({
      'GET /v2/objects': { data: [object()] },
      [`POST /v2/objects/${O}/records/query`]: { data: rows }
    });
    const first = await api.listResources({ credential });
    await expect(api.listResources({ credential, cursor: first.nextCursor })).rejects.toThrow(
      /repeated/i
    );
  });
  it('paginates only the bound note parent and rejects repeated note pages', async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      note({
        id: {
          workspace_id: W,
          note_id: `50000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
        }
      })
    );
    const query = `GET /v2/notes?parent_object=${O}&parent_record_id=${R}&limit=25&offset=`;
    const { api } = fixture({ [query + '0']: { data: rows }, [query + '25']: { data: rows } });
    const first = await api.listNotes(O + ':' + R, credential, W);
    expect(first.notes).toHaveLength(25);
    await expect(api.listNotes(O + ':' + N, credential, W, first.nextCursor)).rejects.toThrow(
      /cursor|binding/i
    );
    await expect(api.listNotes(O + ':' + R, credential, W, first.nextCursor)).rejects.toThrow(
      /repeated/i
    );
  });
  it('keeps authorization failures separate and handles delta/past/malformed Retry-After', async () => {
    for (const status of [401, 403, 404]) {
      const { api } = fixture({ 'GET /v2/self': new Response('private payload', { status }) });
      await expect(api.validate(credential)).rejects.toMatchObject({ status, retryAt: null });
    }
    for (const header of ['120', 'Thu, 01 Jan 1970 00:00:00 GMT', 'invalid']) {
      const before = Date.now();
      const { api } = fixture({
        'GET /v2/self': new Response('private payload', {
          status: 429,
          headers: { 'retry-after': header }
        })
      });
      try {
        await api.validate(credential);
        throw new Error('expected rate error');
      } catch (error) {
        const e = /** @type {any} */ (error);
        const delay = Date.parse(e.retryAt) - before;
        expect(delay).toBeGreaterThanOrEqual(
          header === '120' ? 120000 : header === 'invalid' ? 60000 : 1000
        );
      }
    }
  });
  it('times out a stalled streamed body and sanitizes thrown fetch failures', async () => {
    const stream = new ReadableStream({ start() {} });
    const { api } = fixture({ 'GET /v2/self': new Response(stream) });
    await expect(api.validate(credential, Date.now() + 30)).rejects.toThrow(/deadline/i);
    const badFetch = /** @type {typeof fetch} */ (
      vi.fn().mockRejectedValue(new Error('Bearer synthetic-secret private-response'))
    );
    await expect(createAttioAPI({ fetchImpl: badFetch }).validate(credential)).rejects.toThrow(
      'Attio network request failed'
    );
  });
  it('supports documented unrestricted reference-target schemas (null or empty allowed_object_ids)', async () => {
    for (const allowed of [null, []]) {
      const { api } = fixture({
        'GET /v2/objects': { data: [object(), object(C, 'companies')] },
        [`GET /v2/objects/${O}/attributes?limit=100&offset=0&show_archived=true`]: {
          data: [
            attribute({
              type: 'record-reference',
              config: { record_reference: { allowed_object_ids: allowed } }
            })
          ]
        }
      });
      const result = await api.schema(O + ':' + R, credential, W);
      expect(result[0].targetObjectIds).toEqual([O, C]);
    }
  });
  it('rejects incomplete current value metadata instead of interpreting a partial value as current', async () => {
    const { api } = fixture({
      [`GET /v2/objects/${O}/attributes?limit=100&offset=0&show_archived=true`]: {
        data: [attribute()]
      },
      [`GET /v2/objects/${O}/records/${R}`]: {
        data: record({
          values: {
            description: [{ attribute_type: 'text', value: 'Partial', active_until: null }]
          }
        })
      }
    });
    await expect(api.readRecord(O + ':' + R, credential, W)).rejects.toThrow(
      /current|active|incomplete/i
    );
  });
  it('never rethrows private stream errors even when their message contains a bound keyword', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.error(new Error('private synthetic-secret bound failure'));
      }
    });
    const { api } = fixture({ 'GET /v2/self': new Response(stream) });
    await expect(api.validate(credential)).rejects.toThrow(
      'Attio response invalid UTF-8 encoding or unavailable'
    );
  });
  it('retains archived select and status option identities separately from active choices', async () => {
    for (const type of ['select', 'status']) {
      const endpoint = type === 'select' ? 'options' : 'statuses';
      const key = type === 'select' ? 'option_id' : 'status_id';
      const { api } = fixture({
        [`GET /v2/objects/${O}/attributes?limit=100&offset=0&show_archived=true`]: {
          data: [attribute({ type })]
        },
        [`GET /v2/objects/${O}/attributes/${A}/${endpoint}?show_archived=true`]: {
          data: [
            {
              id: { workspace_id: W, object_id: O, attribute_id: A, [key]: P },
              title: 'Archived choice',
              is_archived: true
            }
          ]
        }
      });
      const attributes = await api.schema(O + ':' + R, credential, W);
      expect(attributes[0].options).toEqual([{ id: P, title: 'Archived choice', archived: true }]);
    }
  });
  it('allows reference writes only when explicit null relationship metadata proves no reciprocal relationship', async () => {
    for (const relationship of [
      undefined,
      {},
      { id: { workspace_id: W, object_id: C, attribute_id: P }, is_multiselect: false },
      null
    ]) {
      const { api } = fixture({
        'GET /v2/objects': { data: [object(), object(C, 'companies')] },
        [`GET /v2/objects/${O}/attributes?limit=100&offset=0&show_archived=true`]: {
          data: [
            attribute({
              type: 'record-reference',
              relationship,
              config: { record_reference: { allowed_object_ids: [C] } }
            })
          ]
        }
      });
      const attributes = await api.schema(O + ':' + R, credential, W);
      expect(attributes[0].writable).toBe(relationship === null);
      expect(attributes[0]).not.toHaveProperty('relationship');
    }
  });
  it('allows a24KiB note draft plus bounded provenance, but rejects total content beyond26KiB', async () => {
    const { api, fetchImpl } = fixture({ 'POST /v2/notes': { data: note() } });
    const markdown = 'x'.repeat(24 * 1024) + '\n' + 'p'.repeat(1024);
    await api.createNote(O + ':' + R, { title: 'Revision', markdown }, credential, W);
    expect(JSON.parse(/** @type {any} */ (fetchImpl.mock.calls.at(-1))[1].body).data.content).toBe(
      markdown
    );
    await expect(
      api.createNote(
        O + ':' + R,
        { title: 'Revision', markdown: 'x'.repeat(26 * 1024 + 1) },
        credential,
        W
      )
    ).rejects.toThrow(/bound/);
  });
});
