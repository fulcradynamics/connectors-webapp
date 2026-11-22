# Notion OKF-style Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans; independent final review before publication.

**Goal:** Publish and maintain agent-readable navigation for two-way Notion working files.
**Architecture:** Pure deterministic index projection plus persisted bounded file-publication phases, integrated with existing native sync and owner status. Working files and encrypted scope remain authoritative.
**Tech Stack:** Node24+, SvelteKit, Workflow, Vitest, Fulcra v1 files.
**Spec:** docs/superpowers/specs/2026-10-31-notion-index-design.md

## Global Constraints

- Preserve owner/auth/grants/controller/configuration and unrelated work.
- No new provider writes or record/embedding sinks for indexing. No limit increases.
- No per-poll index writes; verify exact latest bytes before reporting publication.
- All user/provider labels are untrusted text. Stable server UUIDs own links.

## Review Focus

- Initial pending/unsupported/missing copies must not be mislabeled verified.
- Malicious title/link/control text cannot escape Markdown or redirect paths.
- Lost transfer response/readback delay/restart cannot create index write loops.
- An index error or long publication must not swallow or starve accepted page edits.
- Poll verification timestamps cannot create endless index versions.

### Task1: Pure index projection

Files: src/lib/server/notion-sync/index.js and index.test.js.
Interfaces: renderIndex(connection, manifest) -> {content, viewHash}; stable semantic fields only.
- [x] Write failing grouping/link/escaping/no-noop-churn tests, run RED.
- [x] Implement bounded deterministic index.md projection, run GREEN.

### Task2: Durable publication and native integration

Files: notion-sync/index.js, worker.js, worker.test.js, service.js/tests and NotionDocuments.svelte.
Interfaces: prepareIndex(manifest,connection) and advanceIndex(manifest,connection,client); retained index intent/status in encrypted manifest.
- [x] RED regressions for initial publication, changed metadata, restart/readback failure, healing and unchanged-cycle stability.
- [x] Add stable contentUpdatedAt, bounded allocate/transfer/verify phases, safe retry scheduling/accepted-edit priority. Publish only verified metadata; expose index path/readback status in owner UI.
- [x] Run full suite/check/build and review fixes with concrete tests.

### Task3: Documentation/publication/live acceptance

Files: provider/user/agent guides and existing public source branch; private harness/evidence outside public source.
- [x] Explain implementation limits/storage/index ownership and how agents locate/read it; all normal checks/auth/privacy/Gitleaks.
- [ ] Publish/read back canonical source and update existing personal/template apps with preserved native state.
- [ ] Read actual Fulcra index, change a demo document, verify updated index and unchanged-sync version stability. Record exact results and own exit/V5 fold.
