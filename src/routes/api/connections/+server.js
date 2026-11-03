import { json, error } from '@sveltejs/kit';
import { ownerRuntime, bodyJSON, configurationAction } from '$lib/server/api';
import { adapters } from '$lib/server/connectors';
import { seal } from '$lib/server/secrets';
import { enrollProviderCredential } from '$lib/server/provider-enrollment';
/** @type {import('./$types').RequestHandler} */
export async function GET(event) {
  const { store } = await ownerRuntime(event);
  return json(
    { connections: await store.listConnections() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
/** @type {import('./$types').RequestHandler} */
export async function POST(event) {
  const { store, crypto } = await ownerRuntime(event, true),
    input = await bodyJSON(event.request);
  const adapter = adapters[/** @type {keyof typeof adapters} */ (input.connector)];
  if (!adapter) error(400, 'Choose a supported connector');
  if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 100)
    error(400, 'Choose a connection label');
  return configurationAction(async () => {
    const { credential, accountId } = await enrollProviderCredential(
      input.connector,
      input.credential ?? {}
    );
    const connection = await store.createConnection({
      connector: input.connector,
      label: input.label.trim(),
      accountId,
      config: {}
    });
    const key = 'provider:' + connection.id;
    await store.saveGrant(key, {
      encrypted: seal(credential, `${store.deploymentId}:${store.ownerId}:${key}`, crypto),
      status: 'ready'
    });
    return json({ connection }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  });
}
