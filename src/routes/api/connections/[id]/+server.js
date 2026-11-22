import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { ownerRuntime, ownedConnection, bodyJSON, configurationAction } from '$lib/server/api';
import { configurationUpdate } from '$lib/server/connections';
import { validateRoute } from '$lib/server/sync/sinks';
import { loadManifest } from '$lib/server/notion-sync/state';
import { loadManifest as loadAttioManifest } from '$lib/server/attio-sync/state';
import { validateAttioConfiguration } from '$lib/server/attio-sync/configuration';
import { getProviderCredential } from '$lib/server/credentials';
import { FulcraClient } from '$lib/server/fulcra';
/** @type {import('./$types').RequestHandler} */
export async function GET(event) {
  const { store } = await ownerRuntime(event);
  const connection = await ownedConnection(store, event.params.id);
  return json(
    { connection, status: await store.connectionStatus(connection.id) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
/** @type {import('./$types').RequestHandler} */
export async function PUT(event) {
  const { store, owner, crypto } = await ownerRuntime(event, true),
    connection = await ownedConnection(store, event.params.id),
    input = await bodyJSON(event.request, {
      maxBytes: connection.connector === 'attio' ? 128000 : 32000
    });
  return configurationAction(async () => {
    const resources = await store.getResources(connection.id);
    const { config, resetCheckpoint, changed } = configurationUpdate(
      connection.config,
      input,
      resources.map((/** @type {any} */ r) => r.id),
      owner.userId,
      connection.connector
    );

    if (config.twoWay) {
      if (connection.connector !== 'notion' || !store.supportsTwoWay)
        throw Error('Two-way configuration requires Notion and the native Workflow backend');
      if (await store.getGrant('notion-sync:' + connection.id))
        await loadManifest(store, { ...connection, config }, crypto);
    }
    if (connection.connector === 'attio' && (await store.getGrant('attio-sync:' + connection.id)))
      await loadAttioManifest(store, { ...connection, config }, crypto);
    if (connection.connector === 'attio' && config.attio) {
      if (config.attio.twoWay && !store.supportsTwoWay)
        throw Error('Attio two-way requires native Workflow backend');
      await validateAttioConfiguration(
        { ...connection, config },
        await getProviderCredential(store, connection.id, crypto)
      );
    }
    const client = new FulcraClient({
      endpoint: env.PUBLIC_FULCRA_API_ENDPOINT,
      accessToken: owner.accessToken
    });
    validateRoute(
      config.route,
      config.route.mode === 'file' ? [] : await client.catalog(),
      config.route.mode === 'file' ? {} : await client.schema(config.route.recordType)
    );
    if (!changed) return json({ connection });
    const saved = await store.changeGeneration(
      connection.id,
      'draft',
      config,
      connection.generation,
      resetCheckpoint
    );
    return json({ connection: saved });
  });
}
