import { nativeHTTP } from '$lib/server/native/http.js';
import { env } from '$env/dynamic/private';
import { requireOwner } from '$lib/server/owner';
import { instanceMode, personalAccess } from '$lib/server/instance-access';
import { personalLanding } from '$lib/server/personal-landing';
/** @type {import('@sveltejs/kit/hooks').Handle} */
export async function handle({ event, resolve }) {
  if (instanceMode(env.CONNECTORS_MODE) === 'personal') {
    const response = await personalAccess(event, { landing: personalLanding });
    if (response) return response;
  } else if (event.url.pathname.startsWith('/api/user/')) await requireOwner(event.cookies);
  const response = (await nativeHTTP(event)) ?? (await resolve(event));
  if (instanceMode(env.CONNECTORS_MODE) === 'personal' && !event.url.pathname.startsWith('/_app/'))
    response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
