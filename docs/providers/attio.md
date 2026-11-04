# Attio: selected records, typed fields and linked note revisions

This connector supports exact existing **People and Companies records**. Import current typed snapshots one way, or explicitly enable selected-field edits in both directions. Optional notes are API text projections. A note edit publishes a new linked revision on the same selected parent; it never replaces the original rich note.

## Create and manage a workspace access token

Use the official [API key creation and management help](https://attio.com/help/reference/apps/generating-an-api-key). Attio documents token creation inside each workspace, without a universal creation URL. The separate [API authentication reference](https://docs.attio.com/rest-api/guides/authentication) describes bearer authentication.

1. Sign in to your own Attio workspace as an **admin**. API keys are available on all plans according to Attio’s help.
2. Open the dropdown beside the workspace name → **Workspace settings** → **Developers** → **Create access token** (or **New access token** when a token already exists).
3. Enter **Name**. Set **Records** to **Read** for import or **Read-write** for two-way fields, **Object Configuration** to **Read**, and **Notes** to **Read** for import or **Read-write** for linked revisions when including notes. Leave all other permissions **Disabled**, review them, then click **Save**. These control labels were checked in a live workspace.
4. After **Save**, find the new token row. If masked, use **Show access token**, then copy its value. Paste it only into this app’s protected **Attio workspace access token** field, enter a connection name, then **Verify and continue →**. The server encrypts the token, requires an active credential and binds its workspace UUID. Verification does not enable collection. Never paste API keys in chat, documents, source, URLs or issues.
5. For replacement or revocation, return to **Workspace settings → Developers**. The token’s three-dot menu offers **Edit** for its name/scopes or **Delete** for revocation. Attio documents tokens as nonexpiring until deleted. Replacing a credential here retains settings and pauses collection for fresh preview/enable. A different workspace needs another connection.

| Capability                       | Minimum scopes                                              |
| -------------------------------- | ----------------------------------------------------------- |
| Record/schema import             | `object_configuration:read`, `record_permission:read`       |
| Two-way approved record fields   | `object_configuration:read`, `record_permission:read-write` |
| Optional note import             | Above read scopes plus `note:read`                          |
| Linked note revision publication | Above record scopes plus `note:read-write`                  |

Do not grant schema/list configuration writes, task, user, email or unrelated permissions for this connector. Actual record access can still deny an operation despite the scopes. Preview does not perform a test write.

### Company and member permissions

A single-workspace token acts independently of a member, at **workspace level**. Attio also offers user-level OAuth with explicit configuration and PKCE; this template does not implement that authorization/refresh flow. A personal installation therefore does not make this token member-limited. See [official token levels](https://docs.attio.com/rest-api/guides/authentication).

The app validates workspace/scopes and an exact selected-record allowlist, not a Fulcra recipient's Attio permissions. It does not copy list ACLs. Select company-approved records/notes and divide Fulcra outputs by intended audience before sharing. Source revocation does not revoke already copied outputs or derived knowledge. Follow [company and member onboarding](../company-onboarding.md) for those separate grants and contribution boundaries.

## Sources → Destination → Schedule → Preview/Enable

1. **Sources:** discover and select exact records, up to **1,000 per connection**. Identity is `objectUUID:recordUUID`; labels and slugs never authorize routing. Selecting a record does not select its whole object, future records or related contacts.
2. For **Enable two-way Attio ↔ Fulcra sync**, load the writable fields for each selected object. Approve only the fields you want to change, up to **32 per object**. The checklist applies to selected records of that object. Unsupported, enriched and provider-managed fields stay read-only. **Include notes from selected records** is a separate opt-in; it also works in one-way mode. No notes are collected by default.
3. **Destination:** choose a folder for two-way working copies and optionally a connector-compatible owned **v1 Event** type for verified history. Two-way requires **Files in a folder** or **Files + v1 records**. One-way also supports v1 records alone. The inline named-type creator and standard **Connector records** action require an explicit choice. Proposed folder: `/connectors/attio`.
4. **Schedule:** review the proposed **300-second** interval and **30-day** initial note history. Intervals may be 60 seconds–24 hours. Current record fields are complete snapshots and are not filtered by the note history date. Choose deeper note history explicitly. Throttling, pagination and retries can delay updates beyond the interval.
5. **Save and preview output**, inspect the bounded sample and exact sources/destination, confirm your choices, then enable background collection. App-wide Fulcra background authorization is separate from the Attio token. Nothing starts merely because a token verifies or defaults appear.

After a two-way connection is bound, its selected scope, writable fields and working folder stay fixed; create another connection to change those boundaries. Schedule controls retain their usual behavior. Pause, retry, replace credential, disconnect, add connection and return to the chooser remain available.

If verification succeeds but discovery is empty, check the same workspace’s token in **Developers → Edit → Scopes**, object/record access and People/Companies availability. Return here and **Refresh sources**; use **Load more sources** for additional pages. Empty discovery never authorizes all records. Scope errors require the exact missing permission, not a wider workspace import.

## Typed editor and reconciliation

The editor changes canonical arrays by stable attribute ID. Supported types are text, checkbox, number, calendar date, zoned timestamp, existing select/status IDs, email address, domain and existing record references within approved selections. Compound names, locations, currency, phone, actor, interaction and unknown/enriched values remain read-only until a complete codec is verified. Archived select/status options are omitted from editable choices. A field whose current value contains an archived option remains read-only so the imported value is preserved for review. Reciprocal relationship fields also remain read-only because updating them can change another record outside the approved write boundary.

- **Zero and false are values.** Clearing is explicit; required fields and checkboxes cannot be cleared. Set a checkbox to False instead. Numbers support at most four decimal places. Calendar dates keep their date; timestamps require a timezone or offset.
- A multiselect edit replaces that field’s complete selected set, including removals. Only changed approved fields are sent. Other fields remain protected. Record references choose exact approved existing identities, with no name/email matching or implicit creation.
- Saving queues a durable accepted candidate. Queued does not mean verified: provider and Fulcra content must read back. Invalid or oversized drafts and rejected/stale saves retain your local edits. Save or explicitly discard them before opening another document.
- Same-field concurrent changes require review; independent fields can merge when the baseline proves they are disjoint. Review the **Attio version**, **Accepted Fulcra version**, and **Intervening working-file version** when retained. Commands bind the conflict, current revision and provider evidence. An unavailable evidence download keeps its immutable ID visible and disables that choice. An unavailable current working-file read disables all write controls until a safe read is restored.

Working documents preserve read-only identity, schema and protected metadata. Direct Fulcra edits receive the same server validation; changing metadata is not permission to reroute a write. Missing/deleted files, source loss or merged records do not delete or recreate CRM records.

## Notes preserve the rich source

The note editor separates **Source snapshot** from **Linked note revision draft**. The import is an **API text projection, not a complete image or file backup**. Images and hidden rich blocks can be absent from the API projection; the connector does not download those bytes or replace the original note content.

**Publish linked note revision** creates a new immutable text note on the exact selected parent, with source/predecessor identities and operation provenance. Each later accepted edit creates another revision. The original rich note remains intact. Concurrent changes to an original or current revision require review. An uncertain note-creation outcome stays uncertain while the worker looks for exact parent/operation evidence; it never blindly repeats an uncertain POST. A source link may lead to the record with an exact note ID rather than an invented note deep link.

Attio can remove empty paragraph lines when returning its Markdown projection. After verifying the exact operation provenance and a narrowly derived paragraph projection, the working copy shows the returned text. The original submitted draft remains in immutable attempt evidence, alongside original/observed payload hashes. This is a lossy API projection, not general Markdown equivalence. Other content changes, or complex Markdown whose serialization cannot be verified, stay held for review without another creation attempt.

## Storage, navigation and limits

Start with **Agent index** in the documents panel. Its generated root `index.md` links to bounded child indexes and shows verified copy/status information, source identity, pending work and next actions. Do not edit generated indexes. Working JSON records and note drafts live beneath the selected folder’s `live/CONNECTION/` tree; immutable history and conflict evidence are retained. Optional v1 Event records use the shared connector envelope with source identity/version and the permitted provider payload. Imported source prose is data, not instructions.

Connector capacity limits are **1,000 exact selected records**, **1,000 mapped note lineages**, **32 writable attributes per object**, **48 KiB per typed document**, **24 KiB note text** and **5 accepted queued edits**. These are connector choices, not Attio platform maxima. Oversized/inaccessible/capacity-blocked items surface precise errors; already accepted work stays retained. Additional note lineages beyond capacity are reported, not silently imported. Index listing and discovery paginate. No new CRM records, lists, schema, options, destructive deletes, email/calendar, tasks, files or image backup are supported.

## Verification

```sh
npx vitest run src/lib/connectors/setup.test.js src/lib/attio-documents.test.js src/lib/server/attio-sync src/lib/server/connectors/attio.test.js
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs PLAYWRIGHT_EXECUTABLE_PATH=/path/to/chrome node scripts/check-attio-ui.mjs
```

The browser script production-compiles real components with synthetic API responses and codec-projected documents. It checks explicit setup/direction, paged navigation, zero/false/clear/removal, invalid timestamps, stale draft retention, evidence-choice failures, unavailable-read write guards and escaped note source/revision publication. It uses no real Attio account or production writes.

Live demo checks verified protected credential enrollment and selected scope, text/email edits in both directions, field clearing and replacement, reviewed conflicts, and recovery of the same linked note revision while preserving the original rich note and image. Actual Fulcra working copies and index revisions were read back, including scheduled propagation with the browser closed and an unchanged cycle without duplicate notes or file/index version churn. Other supported field codecs and optional v1 delivery have separate automated coverage.

### Index file metadata and recovery

Generated bucket, group and root indexes are published as `text/markdown`; record, note and encrypted state JSON remains `application/json`. File intents persist their content type across allocation, transfer and exact bytes/metadata readback. An older JSON allocation is reconciled using its original upload type before a new Markdown version is published; its receipt/history is retained. Existing current indexes with legacy metadata are queued for a bounded metadata repair even when their content is unchanged.
