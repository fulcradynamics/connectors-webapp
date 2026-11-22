// Read-only binding check. Call before local identity writes or remote setup effects.
export function verifyInstanceOwner(actualOwnerId, configuredOwnerId, savedOwnerId) {
  if (
    typeof actualOwnerId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actualOwnerId)
  )
    throw Error('Unable to verify the authenticated Fulcra account; finish sign-in before setup');
  if ([configuredOwnerId, savedOwnerId].some((id) => id && id !== actualOwnerId))
    throw Error(
      'Authenticated Fulcra account does not match the configured or saved owner. Sign in as the existing owner; do not reset identity or copy another account’s state.'
    );
  return actualOwnerId;
}
