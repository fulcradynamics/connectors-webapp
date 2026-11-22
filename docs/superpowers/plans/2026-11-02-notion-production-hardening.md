# Notion Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans; use independent focused agents for separate modules and review, then independent whole-branch review.

**Goal:** Safely sync current mixed-block Notion pages and produce an audited, tested release candidate before specifying two-way Attio.
**Architecture:** Preserve the current native runner and complete-Markdown mode. Add a server-owned managed-block projection with strict shared parsing and one-block persisted edits; migrate dependencies with exact provenance and compatibility evidence.
**Tech Stack:** Node24+, SvelteKit, Workflow5.2.3, Vitest, Fulcra folders/v1.
**Spec:** docs/superpowers/specs/2026-11-02-notion-production-hardening.md

## Global Constraints

- Preserve owner/grants/routes/identity/native state and unrelated work; no permanent opaque deletion or security/review bypass.
- Native work remains persisted and bounded; one remote mutation per phase, exact readback before convergence.
- 50 mappings/24KiB body/200-character title limits retained and disclosed; no silent truncation.
- No universal CAS promise; partial reads and third states conflict/fail closed.

## Review Focus

- Forged/reordered/cross-page managed structure must reject before writes; literal delimiter-looking source text remains data.
- Opaque subtree changes with unchanged visible text invalidate guards/conflict resolution.
- Response loss after any block write must recognize the deterministic intermediate while retaining other desired edits.
- Pagination/deadline/capacity failures cannot be reported complete or discard accepted text.
- Dependency migration must retain native controller continuation, owner auth and exact serving behavior.

### Task1: Strict shared managed-body contract

Create src/lib/notion-managed.js and notion-managed.test.js. Exports isManaged(markdown), parseManaged(markdown), encodeManaged(capsule), planManagedEdit(before,after), validateManagedEdit(before,after). Capsule version1/pageId/ordered blocks; editable blocks expose only texts:string[] plus frozen styles/attributes, noneditable blocks retain bounded snapshot. planManagedEdit returns first changed block plus deterministic intermediate body, or null. No transport or crypto in shared code.
- [ ] RED tests for roundtrip, literal marker text, allowed text edits, crosspage IDs, structure/order/style edits, source injection, Unicode/byte limits and no-change identity.
- [ ] Implement strict deterministic format/validation and GREEN.

### Task2: Provider projection and phased block writes

Create server/notion-sync/managed.js and tests; modify notion.js/tests and worker.js/tests. Read complete bounded blocktrees after incomplete Markdown export; construct managed projection with immutable subtree/attribute fingerprints. Patch only authorized supported leaf text fields using fresh target read. Worker recognizes deterministic intermediate and persists one block progress per body phase; ordinary Markdown paths unchanged.
- [ ] RED pagination/incomplete/opaque-preservation and partial-write/restart/thirdstate/source-race/archive regressions.
- [ ] Implement provider projection and guarded per-block writes; GREEN.

### Task3: Owner editing and recovery experience

Modify service.js/tests and NotionDocuments.svelte; add focused shared/UI tests. Managed save cannot change immutable layout, create cannot forge managed scope; app shows supported text fields and protected-content explanation. Existing raw Markdown pages/editor and retained conflict/recovery views remain usable.
- [ ] RED managed route validations and UI selection/text-preservation checks.
- [ ] Implement and run suite/check/build.

### Task4: Reviewed dependency migration

Modify package.json/package-lock.json and narrowly scoped vendor backport/provenance if required. Use isolated audit-clean candidate; require exploit regressions and actual consumer contracts, no suppression.
- [ ] Record baseline audit, inspect original/fixed changes and consumers.
- [ ] Adopt reviewed exact migration and run strict audit plus all fixture/bootstrap/type/build/auth checks.

### Task5: Review, publication and live production canaries

Update provider/user/agent/operations docs and tests. Independently review whole branch, resolve demonstrated defects with regressions. Publish focused source against main with existing merge prerequisites, forward to reference integration/personal preserving unrelated features and own configurations. Run native rollovers, actual current mixed-page text changes/protected IDs, reverse changes, conflict/archive/recovery and index/no-echo readbacks. Record harness/private workspace exact reads and accepted own V5 fold. Then write two-way Attio spec; do not inherit upstream manual-test claims.
- [ ] Full checks/review/privacy/Gitleaks; source and own app readbacks.
- [ ] Actual live canaries, final acceptance versus exact external prerequisites.
- [ ] Subsequent two-way Attio specification.
