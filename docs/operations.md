# Operations and recovery

## What to check

Connection details show last attempt, verified sync/delivery, error and queued/failed work. A successful upload response is pending until record content or file bytes read back. Checkpoints advance only after required artifacts verify.

Rate limits schedule provider-aware retries. Large backfills may take several cycles. A verification mismatch pauses visibly; investigate the destination instead of manually advancing a cursor.

## Controls

Pause/configuration/disconnect changes fence future worker phases; an already executing bounded phase can finish before pause commits. Credential replacement retains settings, pauses collection and requires preview confirmation. Background disconnect disables local unattended access and attempts to revoke the current refresh grant. Browser sign-out is separate.

A saved native operation reference represents an in-flight action. Keep it after a network failure. The client retains the command ID and retries/reconciles that command; do not bypass it by repeatedly issuing new mutations. An ambiguous rotating-token refresh requires reauthorization instead of blind reuse of the old token.

## Preserve these together

Keep the instance ID, pinned controller root, owner-bound Fulcra runtime marker and encryption key/keyring. Do not clear them to repair a deployment. Missing established state fails closed. Recovery must reconcile retained encrypted snapshots and unresolved delivery intents. Test recovery before relying on an instance for important data.

Controllers hand off state after 500 transitions to the current deployment. Pause before incompatible updates. Hosting retention is not an unlimited backup; preserve recovery material privately.

## Retention and keys

Source staging expires logically after 24 hours and is cleaned on worker/read activity; downtime can delay removal. Encrypted historical payloads follow platform retention. Disconnecting a service does not delete imports from Fulcra or revoke its token at the provider automatically. Purge only after an explicit owner decision.

For key rotation, keep old keys in `CREDENTIAL_PREVIOUS_KEYS`, deploy the new active key/ID and verify old envelopes still decrypt. Preserve old keys until relevant retained state is re-encrypted or removed. Never log or commit keyrings.

## Optional PostgreSQL worker

Only `CONNECTORS_BACKEND=postgres` requires a managed TLS database and independent scheduler. Run migrations deliberately. It uses atomic claims, bounded leases and generation fencing; stale workers cannot commit checkpoints. Test it with an isolated `TEST_DATABASE_URL`, never production.

Optional discovery publication retains its upload receipt while waiting for readback and backs off for 30 seconds so source collection can continue. An unavailable navigation manifest must not block ordinary ingestion.

The PostgreSQL delivery path rejects a retained artifact whose expected bytes changed under the same revision/path. An earlier verified receipt is not evidence for different content. Preserve the original delivery receipt and staged candidate, inspect the formatter/source identity change, and use an explicitly reviewed migration when needed; do not delete receipts or advance the checkpoint to bypass the mismatch.
