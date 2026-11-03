# Add a connector

Use the [step-by-step agent guide](https://connectors.my.fulcra.ai/guides/agent.md) for exact code/UI registration points, example selection and verification commands. The [user guide](https://connectors.my.fulcra.ai/guide) explains setup and a ready-to-use agent brief.

For forks, local setup and submitting a reviewed upstream pull request, start with [CONTRIBUTING](../CONTRIBUTING.md). Fulcra is the content database; adapters use the shared runner rather than provisioning their own backing services.

Adapters implement `validate(credential)`, `listResources({credential,cursor,deadline})` and `readPage({connection,credential,checkpoint,deadline,hints})`; register them in `src/lib/server/connectors/index.js`. JSDoc contracts live in `src/lib/connectors/types.js`. Read current official provider documentation and pin version headers where supported.

Return a bounded `ChangePage`: stable source ID, source version, real source timestamp, explicit operation, JSON payload and optional textual file artifacts. `candidateCheckpoint` must carry every pagination/frontier token needed to resume. Return `continuation` for immediate follow-up, `retryAt` for throttling, or `resetRequired` for bounded reconciliation. Adapters never write to Fulcra or commit checkpoints. Avoid observation timestamps in logical revision identity. Timestamp-only versions can collide; canonical content also participates in the shared revision UUID.

Never follow provider pagination to a different origin/resource scope. Use `providerHTTP` for deadline/error limits and reject credentials in configuration. Provider credentials are server-only encrypted envelopes; resource selection must come from server-verified discovery. Do not persist private notes/screenshots/files merely because an upstream response contains them.

Write fixture tests before implementation for pagination, stable IDs, source boundaries, expired/revoked credentials, retry timing, edits/deletions and delayed/partial content. Test the shared runner with real PostgreSQL for claims, fencing and recovery. Signed webhooks only persist deduplicated hints and schedule the same selected-source poll; they cannot choose destinations or start direct sink writes. Acknowledgment is transactional with checkpoint persistence.

Add a setup guide that states required account tier/scopes, exact supported data, polling limits, retention behavior and every unverified live path. Exercise a bounded real account/source/change/readback before labeling it verified. Provider fixtures passing is not a production acceptance milestone.

## Required user setup experience

Reuse the [agent guide's inline setup contract](/guides/agent.md#inline-setup-contract). Every connector needs verified direct token/app creation or management links on its credential form, replacement form and saved detail view; a documentation link alone is insufficient. Populate `credentialUrl`, `credentialLink`, separate `setupUrl`/`setupLink`, scopes and concrete steps in `src/lib/connectors/setup.js`, rendered by `CredentialLinks.svelte`. For documented desktop-only creation, use a null URL plus a clear native path/help link. Keep links independent of this template owner's identity.

Preserve explicit source selection, destination folder/v1 type, per-connection frequency/history, preview/enable and pause/retry/disconnect controls. Explain proposed defaults and ask the user about missing preferences before enablement. Add exact-link browser checks and provider/user instructions to each contribution.

Garmin demonstrates personal-key exchange, encrypted short-lived token renewal, verified account/time-zone binding and calendar-date reconciliation. Follow [its guide](/guides/providers/garmin.md) for this pattern. Dispatch enrollment from the server-checked connector, never a caller-selected credential kind. Token renewal belongs under the shared grant lock; source adapters still only return bounded changes.
