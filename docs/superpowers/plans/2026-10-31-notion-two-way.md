# Two-way Notion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver and prove a functional, opt-in two-way Notion page connector.

**Architecture:** Editable Fulcra Markdown files are reconciled against Notion Markdown v2. A bounded persisted native worker owns intents, writes, verification, mappings and conflicts; existing one-way imports remain unchanged.

**Tech Stack:** Existing SvelteKit/JavaScript, native Vercel Workflow, Fulcra file APIs and Notion API `2026-03-11`.

**Spec:** `docs/superpowers/specs/2026-10-31-notion-two-way-design.md`.

## Global Constraints

- 50 mapped pages, 24 KiB editable Markdown, existing native state budgets.
- Explicit opt-in, owner/same-origin authorization, server-encrypted credentials, no new database/controller.
- Notion page title, Markdown v2 and recoverable archive only; no permanent purge, database-property/comment mirror or absence-as-delete.
- Source publication and actual readback required; fixtures do not prove live acceptance.

## Review Focus

- A newer remote change immediately before a write must produce conflict/reconciliation rather than a blind overwrite.
- A lost create response must recover the marker instead of creating a duplicate.
- Markdown normalization must stabilize without writing on every cycle.
- File metadata/IDs are untrusted and cannot select foreign Notion pages or parents.
- Restart/configuration changes must preserve baselines and ambiguous intents.

### Task 1: POC, durable ledger and document reconciliation

**Files:** `src/lib/server/notion-sync/document.js`, `document.test.js`; private acceptance ledger/exit script; private harness/spec/progress.
**Interfaces:** `encodeDocument({title,markdown,archived}) → string`; `decodeDocument(text) → document`; `documentHash(doc) → string`; `decideSync(base,{notion,fulcra}) → noop|pull|push|conflict`.

- [ ] Verify the live POC and save actual output/status evidence.
- [ ] Record harness request/run/milestone/generate before product code; install a ledger exit check in the own-session checkpoint.
- [ ] Write/run failing tests for strict codec, 24 KiB limit, single-side changes, equal edits, conflict, archive and malformed IDs/front matter.
- [ ] Implement pure normalization/hash/decision functions; rerun focused tests; commit.

### Task 2: Notion Markdown write adapter

**Files:** `src/lib/server/notion-sync/notion.js`, `notion.test.js`.
**Interfaces:** `createNotionPages({fetchImpl?})` returns `read(id)`, `children(parent,cursor?)`, `createMarker(parent,localId)`, `setTitle(id,titleProperty,title)`, `setBody(id,before,after)`, `setArchived(id,value)`; every call consumes a server credential and deadline.

- [ ] Write/run failing tests for Markdown v2, title-property lookup, incomplete/unknown-block refusal, bounded children, archive, write preconditions and lost-response marker recovery.
- [ ] Implement current official API requests; no undocumented idempotency claim or automatic duplicate create.
- [ ] Run adapter/codec tests; commit.

### Task 3: Persisted two-way worker and Fulcra file transport

**Files:** `src/lib/server/notion-sync/worker.js`, `worker.test.js`; `src/lib/server/native/worker.js`, `state.js`; `src/lib/server/fulcra.js` and tests.
**Interfaces:** `advanceNotionSync(state, connection, {client,provider,crypto,notion?}) → state`; encrypted durable manifest stored separately from expiring one-way checkpoints; one bounded phase per call. `FulcraClient.latestFile(path)` and `listFiles(folder)` return stable uploaded version identities and bounded content.

- [ ] Write/run failing tests covering pull/push/noop/conflict, new child/new file, archive/restore and invalid scope.
- [ ] Add durable prepare/apply/readback/commit phases, guarded rereads, normalization and create-marker recovery.
- [ ] Test committed write/lost reply, upload/readback failure, interruption between each phase, stale edits, unchanged cycles and mode changes; verify no duplicate page and no unverified checkpoint advancement.
- [ ] Run existing native worker/credentials regressions; commit.

### Task 4: Owner routes and explicit two-way configuration

**Files:** `src/lib/server/notion-sync/service.js`, `service.test.js`; per-connection `documents/+server.js`; native command routing; connection config/preview routes and tests.
**Interfaces:** GET returns mapped document summaries or one document with revision; POST accepts bounded `save|create|archive|resolve|sync` with stable command ID and expected revision. All operations validate selected/mapped scope and generation.

- [ ] Write/run failing tests for foreign IDs/parents, unsupported backend, unauthorized origin, stale revision and unchanged config compatibility.
- [ ] Implement native store manifest access and bounded protected document operations; explicit creation-parent/mode config; write-free preview and verified enable gate.
- [ ] Verify server authorization/config tests and one-way behavior; commit.

### Task 5: Editor, conflicts and setup guide

**Files:** `src/lib/components/NotionDocuments.svelte`, `ConnectionDetail.svelte`; shared setup metadata; provider/user/agent/design docs.
**Interfaces:** component consumes connection ID and protected `connectorRequest`; shows status, editable title/body, archive/restore, New page, Sync now, expected revision and conflict versions/resolution.

- [ ] Implement explicit mode/parent/folder/preview controls and exact Read/Update/Insert instructions; retain one-way defaults.
- [ ] Exercise real rendered UI through CUA; verify unchanged saved settings, stale/conflict errors and no secret exposure.
- [ ] Run all unit/bootstrap/check/build/release/Gitleaks checks; fresh independent review; fix findings; commit/source readback.

### Task 6: Deploy and live acceptance

**Files:** private test/evidence drivers, acceptance ledger and exit script; existing deployment scripts/state only.

- [ ] Deploy existing reference and personal projects preserving landing, keys, grants and controller; verify source/guide/runtime readbacks and safe controller rollover.
- [ ] At write-grant action time obtain the required confirmation for Update/Insert Content on the existing Notion connection; never reveal/copy the token.
- [ ] Preview and enable two-way mode with the approved creation parent.
- [ ] Run real demo create/edit/archive/restore from each side, conflict/resolution, repeated unchanged polls and restart/retry acceptance; save independent reads and screenshots privately.
- [ ] Record each criterion only when its evidence exists and matches; keep working on failures. Run own two-way exit and scoped V5/Unblock exit before every yield.
