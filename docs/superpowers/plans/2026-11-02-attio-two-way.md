# Attio two-way connector implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task by task. Steps use checkbox tracking.

**Goal:** Build the reviewed first Attio increment: selected People/Companies typed fields in both directions and linked note revisions, with durable sharded state/index, owner setup/editor UX and verified publication/deployment.

**Architecture:** Reuse native serialized commands, encrypted grants, persisted worker and Fulcra files/v1 records. Isolate Attio HTTP/identity from isomorphic typed documents and field reconciliation. A compact encrypted manifest references256 hash-bucket files; workers load one bucket per bounded step and persist every accepted write/evidence allocation before delivery. Provider creation is limited to reviewed note revisions; new CRM-record/schema/list creation stays disabled in the first increment.

**Tech Stack:** Existing Svelte5/Kit3, JavaScript+JSDoc, Vitest, Workflow5.2.3, existing FulcraClient/seal/owner protocol. No new framework/database/cron.

**Spec:** ../specs/2026-11-02-attio-two-way-design.md

## Global constraints

- Existing owner identities, environment files, credentials, landing, Notion/GitHub/Garmin behavior remain intact; no collection defaults to enabled.
- Sources, destinations, schedule and preview/enable remain explicit. Attio resource ID is `objectUUID:recordUUID`; workspace UUID is stored by validated enrollment.
- Provider writes only changed approved typed attribute IDs; no PATCH append as generic sync, no rich source-note content replacement, no hard delete, no implicit schema/reference record creation.
- Notes: title/text drafts create a new note on the same approved parent; imported source note remains intact. Lost/uncertain POST never blindly replays.
- Proposed target1,000 exact selected records+1,000 note lineages; at most32 writable attributes/entity,48KiB typed document/24KiB note text,5 accepted queued edits,512KiB compact manifest,128KiB plaintext bucket,500 exact-path published versions, existing native total budgets. Reject before accepting beyond budgets; retain already accepted work.
- Complete uploaded/archived/deleted history, strict UTF8 and streaming byte limits; only one uploaded current head. Archived bytes are evidence only.
- No annotations, atomic CAS claim, bypassed GitHub review, real credentials/private IDs in fixtures/source, or owner-token fallback for unrelated workers.

## Review focus

- Stable account/object/record/attribute identity across rename/reconnect and forged direct-file metadata: tests Tasks1/2/4.
- Cleared false/zero/empty/multiselect removals and unselected/enriched fields: Tasks1/2/4.
- Accepted edit survives every file/provider/shard/index handoff and unknown POST response; third versions do not become silent winners: Tasks3/4.
- Large discovery/navigation across bucket/page boundaries without oversized inline controller state or no-op churn: Tasks3/5.
- Setup/editor works with absent scopes, images missing from note API, unavailable evidence and signed-out/other owner: Tasks1/4/5.

## Shared interfaces

Provider module `src/lib/server/attio-sync/provider.js` exports `createAttioAPI({fetchImpl=fetch}={})`, default `attioAPI`, `parseResource(id)->{objectId,recordId}` and `resourceId(objectId,recordId)`.
- `validate(credential, deadline?) -> {accountId,workspaceId,scopes}` requires active:true and stable workspace identity.
- `listResources({credential,cursor=null,deadline?}) -> {resources:[{id,name,kind:'record',objectId,recordId,workspaceId,url?}],nextCursor}` paginates only People/Companies exact records. Cursor bounded/untrusted; verifies workspace and object IDs.
- `readRecord(id,credential,workspaceId,deadline?) -> {binding:{workspaceId,objectId,recordId},title,url,attributes:Attribute[],rawValues:{[attributeId]:providerValue[]}}` with complete bounded schema+active current values.
- `schema(id,credential,workspaceId,deadline?) -> Attribute[]`.
- `writeRecord(id,valuesByAttributeId,credential,workspaceId,deadline?) -> void` accepts already encoded Attio value arrays, PUT only given attributes; guarded caller owns reconciliation.
- `listNotes(id,credential,workspaceId,cursor=null,deadline?) -> {notes:NoteProjection[],nextCursor}` parent-filtered25/page; `readNote(noteId,parentResourceId,credential,workspaceId,deadline?) -> NoteProjection`.
- `createNote(parentResourceId,{title,markdown},credential,workspaceId,deadline?) -> NoteProjection` POST once; caller owns uncertainty and readback.
- NoteProjection `{binding:{workspaceId,objectId,recordId,noteId},title,text,url?,createdAt}`. Missing rich content explicitly partial; no updates/deletes in this module.
- Attribute `{id,slug,title,type,multiple,writable,required,options?:[{id,title}],targetObjectIds?:string[]}`. Primitive provider values stay raw until codec. Stable IDs authorize; slugs/labels only translate known schema.

Shared document module `src/lib/attio-documents.js` exports `projectRecord(projection,writableIds,approvedResources=[])`, `projectNote(projection,{originalNoteId?,headNoteId?}={})`, `validateEdit(before,candidate,approvedResources=[])`, `encodeDocument(doc)`, `decodeDocument(text)`, `encodeValues(doc,changedIds)`, `supportedType(type)`.
- RecordDoc `{version:1,kind:'record',binding:{workspaceId,objectId,recordId},title,url,attributes:Attribute[],values:{[attributeId]:canonicalValue[]},protected:{[attributeId]:rawUnsupportedValue[]}}`. Attribute.writable is true only for allowed schema+selected writable IDs+supported codec. Unknown/enriched values protected; only writable value arrays may change.
- Canonical arrays contain strings(text/date/timestamp/email/domain/option IDs), finite numbers, booleans, or `{objectId,recordId}` references. Cardinality and clear semantics explicit. Compound unsupported types remain protected.
- NoteDoc `{version:1,kind:'note',binding:{workspaceId,objectId,recordId,noteId:originalNoteId},headNoteId,title,text,url,representation:'api-text-projection'}`. Only title/text drafts change; binding/head/source URL protected.
- Server reconcile module `src/lib/server/attio-sync/reconcile.js`: `baselineFor(doc)->{schemaHash,protectedHash,fields:{attributeId:hash}}` and `reconcile({baseline,local,remote})->{kind:'pull'|'push'|'conflict'|'noop'|'missing'|'schema_conflict',document,changedIds,conflicts}`. Per-field disjoint merge; same-field conflict; no baseline divergence cannot push. Hash source metadata is semantic/stable (no observation-time churn).

Nonsecret config is `attio:{twoWay:true,includeNotes:boolean,writableAttributes:{[objectUUID]:attributeUUID[]}}`, exact selected resource IDs in config.resources. New-record creation is not enabled. Configuration uses one-way normal adapter when attio.twoWay false/absent.

Documents owner endpoint remains `/api/connections/:id/documents`, dispatched by connector:
- GET list `?cursor=` -> `{documents:[{id,title,kind,status,conflictId?,error?,sourceUrl?}],nextCursor,index:{path,state},queued,pending}`; paginated bucket listing.
- GET `?schema=resourceId` -> `{attributes}` for exact discovered/selected record; allowed before enable/config, provider reads only.
- GET `?document=localId[&view=provider|fulcra|working]` -> `{id,document,revision,queued,status,conflict?,expectedProvider,interveningVersion?,workingReadUnavailable,sourceDocument?}`. Current accepted candidate remains inspectable on read failures.
- POST `{operation:'save',id,expectedRevision,document}`, `{operation:'sync',id?}`, or `{operation:'resolve',id,choice:'provider'|'fulcra'|'working',expectedRevision,expectedProvider,conflictId}`. No new source routing accepted from client. Note save label “Publish linked note revision”.

## Task1: Provider API, identity and read-only adapter
Files: create attio-sync/provider.js/tests, connectors/attio.js/tests. Do not edit registry/UI/config/worker.
- [x] RED HTTP fixture tests for active:false200, workspace/object mismatch, pagination, bound/cursor errors, HTTP-date RetryAfter, changed-fields-only PUT, note parent binding; prove absence before implementation.
- [x] Implement above provider interfaces with primary current Attio docs, fixed API origin,2MiB streaming read bound, deadlines and low request pacing; sanitize errors, no token printing. API schema/field encoding follows docs, not guesses.
- [x] Adapter exports createAttio/attio, validate/listResources/readPage for selected records+notes snapshots only, shared ChangePage checkpoint. Validate stable account. Preview never writes.
- [x] GREEN focus; self-review and report tested contracts/primary sources. Commit only assigned files or leave root to commit coordinated files.

## Task2: Typed documents and reconciliation
Files: create shared attio-documents.js/tests, server attio-sync/reconcile.js/tests. Do not edit provider/UI/worker.
- [x] RED type/shape/edit/clear/false/zero/reference/forged metadata and per-field conflict cases.
- [x] Implement shared contracts, canonical normalization and correct Attio writable-value encoding, no metadata spread. Include text/checkbox/number/date/timestamp/select/status/reference required codecs; compound types may remain readonly honestly.
- [x] GREEN lossless typed canonical round trips, disjoint merge/same-field conflicts, schema change, no-baseline divergence/missing file; source URLs sanitized. Reject prototype keys/malformed/oversized encodings.
- [x] Focused tests+types and implementation review; commit assigned files.

## Task3: Sharded native state, file intents and navigation
Files: attio-sync/state.js, files.js, index.js and tests; minimal configurable bound in FulcraClient+tests. Root owns.
- [x] RED encrypted bucket scope/hash tamper, stale pointer/restart, full-history race and streamed bound tests.
- [x] Compact manifest refs256 SHA256(localId) first-byte buckets; encrypted immutable-ID/hash bucket reads, max64entries/128KiBplaintext; one active bucket persisted. No map body for all2,000 items in controller. Record/note local UUID derived stable namespace.
- [x] Persist guard/allocation/transfer/readback and detect intervening/deleted versions; accepted candidate held through every phase. Bucket publish compares plaintext semantic hash; immutable ref advances only after exact current readback. Separate root/group/bucket indexes, stable semantic no-op bytes and bounded links. Failed index publication yields to queued work.
- [x] GREEN synthetic1,000records+1,000notes load, bucket/index discovery pages and resume. Existing native state budgets and reservations tested.

## Task4: Worker/service/config and UI integration
Root owns worker.js/service.js/tests, routes documents/config, native worker/state/http bounds, connections validators/enrollment, registry. UI agent owns components/setup/docs listed below; shared interfaces above.
- [x] RED initial import, both-direction field edits, per-field concurrency/conflict/third evidence, accepted missing/invalid/unsupported/source404/429, lost PUT, failed/restarted shard/index write.
- [x] Worker processes one bounded persisted phase: choose exact record/queued edit -> load one bucket -> provider/schema read -> current working read -> reconcile -> provider guard/mutation/readback -> working guard/allocate/transfer/readback -> optional v1 write/verify -> baseline/bucket publish -> index. Keep accepted body in manifest until all required verified phases finish. One unhealthy item yields.
- [x] Notes discover only selected parents/window; import text projection, preserve original snapshot, publish linked revisions with durable pre-call attempt guard. Bind created ID to known lineage; own revision IDs never become another source export. Lost POST only recovers through parent-filtered exact operation marker/hash; zero/multiple matches retain uncertainty without replay. Current/original branch changes conflict. No source note content PATCH.
- [x] Extend Attio-only source limits to1,000, resource-cache budgets/command config body bounds with native total budgets. Existing providers retain50. Strict config/schema writable-field choice and scope frozen after established state; compatible scheduling updates preserved. No field write before explicit enable.
- [x] UI agent: Attio catalog/token instructions, sources record selection +per-object writable field checklist via schema GET, note opt-in, folder/v1/schedule/preview/enable, editor typed values and note source/draft, three-way review/no unsafe HTML, state/error and draft retention. Keep Notion controls isolated. Files AttioDocuments.svelte, ConnectionDetail.svelte, ConnectorCatalog.svelte, ConnectionForm.svelte, connectors/setup.js/tests, provider guide and public guide links. Root wires registry/endpoints; no common files edited concurrently.
- [x] GREEN integration native restart/accepted queue/ref fencing, optional v1 delivery/readback, auth/foreign/sameorigin, empty-source/scopes/account replacement behavior.

## Task5: QA, publication and owned live acceptance
- [x] Run full test/bootstrap/type/build/audit/privacy/Gitleaks; production-compiled browser setup/editor/third-version/unavailable/draft tests, sharded load/restart tests, independent whole-branch review and important fixes RED→GREEN.
- [ ] Publish focused source PR againstmain (dependent on prior accepted-but-unmerged changes), exact source readback; preserve ordinary review gate. Forward to existing integration/personal branches without environment copying; deploy/read back exact source commits; owner/public HTTP/guides and state-preserving native rollover including pending-only successor wake.
- [ ] Create user-requested free demo Attio workspace; stop at explicit browser-required terms/security confirmation and email verification, retaining exact task/prerequisite. No inbox/calendar import or unrelated account grants. After protected API key and chosen demo resources, preview/enable and verify actual record edits both ways, original rich note intact/new revision, conflict, index/noecho and scheduled run. Missing account access leaves live acceptance open, not silently fixture-complete.
- [ ] Save precise final source/evidence/report to private journal/Fulcra workspace; accepted V5 folds only for actual completed criteria. Run exact own exit.py, inspect retained work/attention, continue authorized unblocked work.
