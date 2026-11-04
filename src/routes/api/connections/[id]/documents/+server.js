import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { ownerRuntime, ownedConnection, bodyJSON, configurationAction } from '$lib/server/api';
import { getProviderCredential } from '$lib/server/credentials';
import { FulcraClient } from '$lib/server/fulcra';
import { createAttioDocumentService } from '$lib/server/attio-sync/service';
import { createDocumentService } from '$lib/server/notion-sync/service';
/** @param {any} event @param {boolean} mutate */
async function service(event, mutate = false) {
  const { store, crypto, owner } = await ownerRuntime(event, mutate);
  const connection = await ownedConnection(store, event.params.id);
  const credential = await getProviderCredential(store, connection.id, crypto);
  return (connection.connector === 'attio' ? createAttioDocumentService : createDocumentService)({
    store,
    connection,
    crypto,
    credential,
    client: new FulcraClient({
      endpoint: env.PUBLIC_FULCRA_API_ENDPOINT,
      accessToken: owner.accessToken
    })
  });
}
/** @type {import('./$types').RequestHandler} */
export async function GET(event) {
  return configurationAction(async () => {
    const docs = await service(event),
      id = event.url.searchParams.get('document'),
      schema = event.url.searchParams.get('schema');
    return json(
      schema
        ? await /** @type {any} */ (docs).schema(schema)
        : id
          ? await docs.read(id, event.url.searchParams.get('view') ?? 'current')
          : await /** @type {any} */ (docs).list(event.url.searchParams.get('cursor')),
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  });
}
/** @type {import('./$types').RequestHandler} */
export async function POST(event) {
  return configurationAction(async () => {
    const docs = await service(event, true);
    const input = await bodyJSON(event.request, { maxBytes: 64000 });
    return json(await docs.mutate(input), { headers: { 'Cache-Control': 'private, no-store' } });
  });
}
