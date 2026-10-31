# Notion QA and Canonical Template Publication Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Execute sequentially with an independent final code review.

**Goal:** Further QA the existing two-way Notion connector, fix demonstrated defects, publish verified source and update the canonical template deployment.

**Architecture:** Preserve the native Workflow manifest, guarded provider/file writes and existing authentication. Exercise synthetic failure paths and real disposable demo documents. Keep normal review/CI requirements for canonical main; no forced merge or audit suppression.

**Tech Stack:** Node24+, SvelteKit, Workflow5, Vitest, Fulcra v1 files, Notion Markdownv2.

**Spec:** docs/superpowers/specs/2026-10-31-notion-two-way-design.md, including existing scope and limits.

## Global Constraints

- Preserve existing deployment identity, grants, credentials, selections, landing and unrelated connectors.
- Titles/Markdown/recoverable archive+restore only;50mapped pages/24KiB body; no inferred deletion.
- All real Notion data in the authorized demo workspace is disposable; use recoverable archive, no permanent purge.
- Read source publication back; verify actual deployed user flow.
- Canonical main retains normal passing checks and independent review. Agent review is not a GitHub approval.

## Review Focus

- Stale client revisions while a write phase is pending must never overwrite intervening edits.
- Repeated saves, retries and lost provider replies must not duplicate pages or lose accepted content.
- Empty bodies, Unicode, unsupported/incomplete exports and archive hiding Markdown must preserve valid data.
- Conflict snapshots and stale reviews must remain scoped/current with both versions retained.
- Dependency changes must preserve build/native continuation contracts and pass actual audit without gate suppression.

### Task1: Establish baseline and investigate release blockers

- [ ] Record own V5 task and M23-1 harness before changes; preserve actual baseline results.
- [ ] Run npm test, dependency audit; inspect required CI/review status and primary upstream fix documentation.
- [ ] Independent review of source and dependency remediation; record exact demonstrated findings.

### Task2: Fix demonstrated defects with regressions

Files: src/lib/server/notion-sync/*.js/*.test.js; native/client/UI tests only as findings require; package.json/package-lock.json for validated dependency corrections.

- [ ] For each important finding, add minimal failing behavioral test and observe expected failure.
- [ ] Implement smallest correction, run regression then full suite and Svelte check.
- [ ] For dependencies, retain baseline audit failure and use only supported upgrades/compatible constraints; verify audit/build/runtime before publication.

### Task3: Live and integration QA

- [ ] Exercise stale-save rejection against a newer live working revision, same-operation replay, Unicode/empty-body roundtrip and recoverable restore in disposable demo pages.
- [ ] Verify same-owner scope/anonymous/foreign-origin rejection, original one-way/config/landing retained.
- [ ] Run npm test/test:bootstrap/check/build, required HTTP/privacy/Gitleaks, and final independent review.

### Task4: Publish and deploy

- [ ] Push reviewed source to canonical repository; exact GitHub readback and normal CI. Merge only if required non-author approval and CI pass; otherwise preserve concrete linked prerequisite.
- [ ] Update authorized canonical template deployment using its own environment and native state-preserving rollover; verify public guide/setup UI, authenticated controls, anonymous API denials and existing configuration.
- [ ] Preserve private workspace/harness/readbacks and own V5 exit evidence. Report exact shipped source, site and any remaining merge limitation.
