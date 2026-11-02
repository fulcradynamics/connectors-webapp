import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { ownerRuntime, ownedConnection, bodyJSON, configurationAction } from '$lib/server/api';
import { previewConnection, configHash } from '$lib/server/connections';
import { getProviderCredential } from '$lib/server/credentials';
import { seal } from '$lib/server/secrets';
import { adapters } from '$lib/server/connectors';
import { FulcraClient } from '$lib/server/fulcra';
import { previewAttio } from '$lib/server/attio-sync/configuration';
import { validateOutput, validateRoute } from '$lib/server/sync/sinks';
/** @type {import('./$types').RequestHandler} */
export async function POST(event) {
  const { store, crypto, owner } = await ownerRuntime(event, true),
    input = await bodyJSON(event.request),
    connection = await ownedConnection(store, input.connectionId);
  if (!connection.config.route) error(400, 'Save source and destination configuration first');
  return configurationAction(async () => {
    const credential = await getProviderCredential(store, connection.id, crypto);
    const result =
      connection.connector === 'attio' && connection.config.attio?.twoWay
        ? await previewAttio(connection, credential, owner.userId)
        : await previewConnection(
            connection,
            adapters[/** @type {keyof typeof adapters} */ (connection.connector)],
            credential,
            owner.userId
          );
    if (result.complete) {
      const route = connection.config.route,
        client = new FulcraClient({
          endpoint: env.PUBLIC_FULCRA_API_ENDPOINT,
          accessToken: owner.accessToken
        });
      const schema = route.mode === 'file' ? {} : await client.schema(route.recordType);
      validateRoute(route, route.mode === 'file' ? [] : await client.catalog(), schema);
      for (const output of result.outputs) validateOutput(output, route, schema);
      const key = 'preview:' + connection.id;
      await store.saveGrant(key, {
        encrypted: seal(
          { hash: configHash(connection.config), generation: connection.generation },
          `${store.deploymentId}:${store.ownerId}:${key}`,
          crypto
        ),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        status: 'ready'
      });
    }
    return json(result, { headers: { 'Cache-Control': 'no-store' } });
  });
}
