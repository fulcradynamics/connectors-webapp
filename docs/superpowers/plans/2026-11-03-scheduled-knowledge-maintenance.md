# Scheduled knowledge maintenance implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline. Steps use checkbox syntax for tracking.

**Goal:** Publish a reusable native-scheduler dreaming recipe rather than a personal automation.
**Architecture:** Canonical agent-neutral prompt in Company Knowledge Skill; connector template supplies the setup wrapper, native Codex/Claude instructions and a served guide. Existing deterministic workers are unchanged.
**Tech Stack:** Markdown, existing Svelte template, explicit public-guide allowlist, native scheduler documentation; no new dependency.
**Spec:** `docs/superpowers/specs/2026-11-03-scheduled-knowledge-maintenance-design.md`

## Global constraints

No personal schedule, model service, token, grant, source import or competing writer. Per-install identities/routes/cadence only. Peer owns skill source; this checkout owns connector docs/page. Generic Files operations are not atomic locks. Keep source/copy ACL and factual/index freshness separate.

## Review focus

Unfilled setup fields; wrong owner/operator identity; inherited output audience; concurrent writer; partial/empty feed mistaken for full review; unchanged version churn; scheduled-run proof fabricated from a manual run; copied private account IDs; divergence between setup wrapper and canonical run prompt.

## Task1 — Setup recipe and guide

Files: create `docs/knowledge-maintenance.md`; modify `src/lib/server/public-guides.js`, `src/routes/+page.svelte`, README and user/agent/knowledge guides.

- [ ] Reconcile canonical reference filename and input/ownership protocol with peer; use official scheduler docs.
- [ ] Write the copyable setup request and native Codex/Claude steps linking one canonical skill run prompt; distinguish default proposal, installer authorization and actual scheduled execution.
- [ ] Serve the guide through the explicit allowlist, link it from template/docs, preserve personal landing and all runtime connection behavior.

## Task2 — Verification and publication

- [ ] Read peer canonical recipe and its behavioral evidence; review per-install, independent/combined, stale/partial/no-change/concurrent/failure cases. Do not create a personal task merely as proof.
- [ ] Run required app tests/bootstrap/check/build/privacy/Gitleaks. One fresh read-only whole-change review; fix material findings and retain evidence.
- [ ] Publish/read back exact source, update PR5 with real scope/test limits, deploy authorized reference and verify guide/page/auth state and screenshot. No claim of a scheduled run.
- [ ] Retain immutable report/private workspace and own accepted V5 fold; inspect exact own exit and retain separate external prerequisites.
