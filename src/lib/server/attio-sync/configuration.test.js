import { it, expect } from 'vitest';
import { validateAttioConfiguration, previewAttio } from './configuration.js';
const uuid = (/** @type {number} */ n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const c = {
      connector: 'attio',
      id: uuid(1),
      account_id: uuid(2),
      config: {
        resources: [`${uuid(3)}:${uuid(4)}`],
        route: { mode: 'file', folder: '/demo' },
        attio: { twoWay: true, includeNotes: false, writableAttributes: { [uuid(3)]: [uuid(5)] } }
      }
    },
    attribute = {
      id: uuid(5),
      type: 'text',
      writable: true,
      multiple: false,
      required: false,
      title: 'Synthetic',
      slug: 'synthetic'
    },
    api = /** @type {any} */ ({
      validate: async () => ({
        workspaceId: uuid(2),
        scopes: ['record_permission:read-write', 'object_configuration:read']
      }),
      schema: async () => [attribute],
      readRecord: async () => ({
        binding: { workspaceId: uuid(2), objectId: uuid(3), recordId: uuid(4) },
        title: 'Synthetic',
        url: '',
        createdAt: '2026-11-01T00:00:00Z',
        attributes: [attribute],
        rawValues: { [uuid(5)]: [{ value: 'Value' }] }
      })
    });
  return { c, api, attribute };
}
it('requires trusted workspace, write scopes and supported writable schema before saving', async () => {
  const f = fixture();
  await validateAttioConfiguration(f.c, {}, f.api);
  f.attribute.writable = false;
  await expect(validateAttioConfiguration(f.c, {}, f.api)).rejects.toThrow(/field/i);
  f.attribute.writable = true;
  f.api.validate = async () => ({ workspaceId: uuid(2), scopes: ['record_permission:read'] });
  await expect(validateAttioConfiguration(f.c, {}, f.api)).rejects.toThrow(/scope/i);
  f.api.validate = async () => ({
    workspaceId: uuid(99),
    scopes: ['record_permission:read-write']
  });
  await expect(validateAttioConfiguration(f.c, {}, f.api)).rejects.toThrow(/workspace/i);
});
it('previews typed records without mutation and describes exact two-way scope', async () => {
  const f = fixture(),
    result = await previewAttio(f.c, {}, 'owner', f.api);
  expect(result.complete).toBe(true);
  expect(result.writesPerformed).toBe(false);
  expect(result.outputs[0].record.payload.values[uuid(5)]).toEqual(['Value']);
  expect(result.detail).toMatch(/linked|approved/i);
});
