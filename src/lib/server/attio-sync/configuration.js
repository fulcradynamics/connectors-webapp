import { supportedType, projectRecord } from '../../attio-documents.js';
import { attioAPI, parseResource } from './provider.js';
import { providerHash } from './projection.js';
import { prepareOutput } from '../sync/runner.js';
/** Validate provider capabilities on the server before configuration or preview approval.
 * @param {any} c @param {any} credential @param {any} api */
export async function validateAttioConfiguration(c, credential, api = attioAPI) {
  const deadline = Date.now() + 25000,
    verified = await api.validate(credential, deadline);
  if (verified.workspaceId !== c.account_id)
    throw Error('Attio workspace configuration changed; use another connection');
  const scopes = new Set(verified.scopes);
  if (
    c.config.attio?.twoWay &&
    Object.values(c.config.attio.writableAttributes).some((/** @type {any} */ a) => a.length) &&
    !scopes.has('record_permission:read-write')
  )
    throw Error('Attio record write scope required');
  if (c.config.attio?.includeNotes && !scopes.has('note:read-write') && !scopes.has('note:read'))
    throw Error('Attio note read scope required');
  if (c.config.attio?.twoWay && c.config.attio.includeNotes && !scopes.has('note:read-write'))
    throw Error('Attio linked note revision write scope required');
  for (const [objectId, ids] of Object.entries(c.config.attio?.writableAttributes ?? {})) {
    if (!(/** @type {any[]} */ (ids).length)) continue;
    const resource = c.config.resources.find(
      (/** @type {string} */ r) => parseResource(r).objectId === objectId
    );
    if (!resource) throw Error('Attio field object is outside selected scope');
    const attributes = await api.schema(resource, credential, c.account_id, deadline);
    for (const id of /** @type {any[]} */ (ids)) {
      const a = attributes.find((/** @type {any} */ a) => a.id === id);
      if (!a?.writable || !supportedType(a.type))
        throw Error('Attio field configuration is no longer writable or supported');
    }
  }
  return verified;
}
/** Bounded typed preview, with the same optional v1 envelope used by the worker.
 * @param {any} c @param {any} credential @param {string} ownerId @param {any} api */
export async function previewAttio(c, credential, ownerId, api = attioAPI) {
  await validateAttioConfiguration(c, credential, api);
  const outputs = [],
    deadline = Date.now() + 25000;
  for (const id of c.config.resources.slice(0, 2)) {
    const projection = await api.readRecord(id, credential, c.account_id, deadline);
    if (
      projection.binding.workspaceId !== c.account_id ||
      `${projection.binding.objectId}:${projection.binding.recordId}` !== id
    )
      throw Error('Attio preview source binding changed');
    const document = projectRecord(
      projection,
      c.config.attio.writableAttributes[projection.binding.objectId] ?? [],
      c.config.resources
    );
    outputs.push(
      prepareOutput(
        c,
        {
          id,
          version: providerHash(document),
          timestamp: projection.createdAt,
          payload: document,
          files: []
        },
        ownerId
      )
    );
  }
  return {
    outputs,
    writesPerformed: false,
    complete: true,
    hasMore: c.config.resources.length > 2,
    detail:
      'Only approved fields on the exact selected records can be updated. Note edits publish linked revisions and preserve the original note; API note text is a partial projection. No new CRM records, schema changes or source deletions are enabled.'
  };
}
