# Knowledge source discovery implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make deterministic connector outputs discoverable by the independently usable Company Knowledge Skill, verify composition, then publish its optional add-on entry.

**Architecture:** A bounded per-instance manifest links existing source routes and verified indexes. Native persisted publication is independent of agents; the skill owns map/knowledge adoption and does not write sync surfaces.

**Tech Stack:** Existing Svelte/JavaScript, Vitest, native Workflow actor, Fulcra Files/v1 records; no new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-03-knowledge-source-discovery-design.md`

## Global constraints

- Schema `fulcra.knowledge-sources/1`; path `/knowledge-sources/v1/fulcra-connectors/<persistent-instance-id>.json`; at most20 sources and64KiB.
- Existing deployment/owner credentials, grants, connection scope and landing remain intact; no model or skill runtime dependency.
- No private instance values, source payloads or journals in public source/tests. Test identities are generated.
- App owns producer files; steward owns `/team-map/`; synthesis is separately owned. No implicit grants or source writes.

## Review focus

- Integration/account IDs falsely treated as workspace IDs: explicit nullable identity tests.
- Multiple forks or a preexisting foreign document: path separation and ownership rejection tests.
- Receipt-only/ambiguous writes and intervening versions: exact readback/restart/changed-file tests.
- Clock-only version churn and queued scope changes: stable semantic body and retained-attempt tests.
- Metadata failure blocking sync or leaking secrets: worker continuation and strict allowlist tests.

## Task1 — Producer contract and retained publication

Files: create `src/lib/server/knowledge-sources.js` and `knowledge-sources.test.js`; reuse `attio-sync/files.js` file guards and existing encryption/identity helpers.

Interfaces: `knowledgeSourcesPath(state)`, `knowledgeSourcesView(state, crypto)`, `advanceKnowledgeSources(state, {crypto, client, now})`. The view is strict connection-level metadata; advance returns whether it consumed this worker phase and retains its operation under `state.knowledgeSources`.

- [ ] Write failing tests for observed identity/routes, unknown/disabled/current status, bounded strict content, distinct instances, stable publication, readback/restart and foreign-file protection.
- [ ] Run the focused file and confirm missing feature failures.
- [ ] Implement pure rendering plus one retained remote phase per call; back off on failure and avoid clock churn.
- [ ] Run focused tests and commit the contract unit.

## Task2 — Native scheduling and standalone operation

Files: modify `src/lib/server/native/worker.js`, `workflows/native-controller.js`; extend native worker/scheduling tests as needed; update README, agent/user and storage guides.

- [ ] Add a failing native test using valid instance/owner identities and the real publication unit: publish without provider/model activity, resume after restart, let normal ingestion proceed after metadata failure.
- [ ] Wire only idle actor phases and include retained producer due time in native scheduling. Preserve active jobs and default no-grant behavior.
- [ ] Verify regular sync suites, unchanged publication versions, disabled-route pointers and default clone behavior without a skill.
- [ ] Run full test/bootstrap/type/build/privacy/secret checks; commit and publish/read back exact source.

## Task3 — Composition, live evidence and optional add-on

Peer owns `map-our-team` skill changes/review and its standalone/composed behavioral tests. This session owns producer/deployment and template publication.

- [ ] Read and reconcile peer contract/review/test artifacts against actual producer JSON, including access context and native-only fallback.
- [ ] Deploy authorized personal/reference sources without copying identities. Verify exact source/READY state, producer manifest/routes, preserved connections and unchanged repeated versions.
- [ ] Have the peer interpret the actual manifest/index; keep simulated adoption, live reads and actual source/permission checks distinctly labeled.
- [ ] Once skill source is published/read back and integration gates pass, add a concise optional skill link to landing/user/agent guides. Explain optional consolidation/dreaming and that installing a skill does not start a schedule.
- [ ] Recheck source/page/guide bytes, retain private evidence and accepted own V5 fold; preserve normal main-review prerequisites.
