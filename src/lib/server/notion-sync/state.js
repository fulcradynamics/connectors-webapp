import { seal, unseal } from '../secrets.js';
import { contentHash, canonical } from '../sync/identity.js';
import { pageId } from './notion.js';
/** @param {any} connection */
export function workingFolder(connection) {
  const folder = connection.config.route?.folder;
  if (
    typeof folder !== 'string' ||
    !folder.startsWith('/') ||
    folder.split('/').some((x) => x === '..' || x === '.') ||
    /[\\\0]/.test(folder)
  )
    throw Error('Invalid two-way folder configuration');
  return `${folder.replace(/\/$/, '')}/live/${pageId(connection.id)}`;
}
/** @param {any} connection */
export const scopeHash = (connection) =>
  contentHash(
    canonical({
      resources: [...connection.config.resources].sort(),
      parentId: connection.config.twoWay.parentId,
      folder: workingFolder(connection)
    })
  );
/** @param {any} store @param {any} connection @param {any} crypto @returns {Promise<any>} */
export async function loadManifest(store, connection, crypto) {
  const key = 'notion-sync:' + connection.id;
  const saved = await store.getGrant(key);
  if (saved) {
    const value = unseal(saved.encrypted, `${store.deploymentId}:${store.ownerId}:${key}`, crypto);
    if (value.scopeHash !== scopeHash(connection))
      throw Error(
        'Two-way scope configuration changed; use a separate connection for another parent, selection or folder'
      );
    return value;
  }
  const entries = Object.fromEntries(
    connection.config.resources.map((/** @type {string} */ id) => [
      pageId(id),
      { localId: pageId(id), notionId: pageId(id), origin: 'selected', status: 'pending' }
    ])
  );
  return {
    version: 1,
    scopeHash: scopeHash(connection),
    entries,
    pending: null,
    queue: {},
    resolutions: {},
    priority: [],
    index: 0,
    scan: 'pages',
    scanCursor: null,
    scanRequested: false,
    lastCycle: null
  };
}
/** Non-expiring encrypted manifest. Expiring staging is not a durable convergence baseline.
 * @param {any} store @param {any} connection @param {any} value @param {any} crypto */
export async function saveManifest(store, connection, value, crypto) {
  const notionIds = Object.values(value.entries)
    .map((/** @type {any} */ e) => e.notionId)
    .filter(Boolean);
  if (new Set(notionIds).size !== notionIds.length)
    throw Error('Two-way mapping configuration is not unique');
  if (
    Object.keys(value.entries).length > 50 ||
    Buffer.byteLength(JSON.stringify(value)) > 512 * 1024
  )
    throw Error('Two-way manifest capacity exceeded');
  const key = 'notion-sync:' + connection.id;
  await store.saveGrant(key, {
    encrypted: seal(value, `${store.deploymentId}:${store.ownerId}:${key}`, crypto),
    status: 'ready'
  });
}
