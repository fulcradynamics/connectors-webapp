# GitHub provenance implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline; tests before implementation.

**Goal:** Bounded source attribution before arbitrary GitHub content, with a truthful guarded legacy repair.
**Architecture:** Pure formatter + pure repair planner, existing shared file intents for reviewed CLI repair; no provider/runtime service changes.
**Tech Stack:** JavaScript/Vitest, existing native/file helpers and Fulcra CLI owner authorization.
**Spec:** `docs/superpowers/specs/2026-11-03-github-provenance-design.md`

## Constraints and review focus

Preserve source payload/event IDs/dedup and selectedscope. No source/provider edits, new selection/grants or rootmanifestresourceIDs. Fail closed on invalid IDs, foreign URLs, manually changed legacy bytes, wrong owner/path/record binding, concurrent versions or uncertain publication. No false all-legacy migration claim.

- [ ] Reproduce missing-prefix behavior with long/hostile issue/PR/comment fixtures; implement bounded canonical source envelope; verify identical normalizedrecord/file identity and no-change bytes.
- [ ] RED→GREEN repair planner tests for independently verified old record/file, unchanged repeat, scope/path/record/manual-content rejection. Add retained dryrun/apply CLI with pausedconnection guard and readback/recovery; document file-only limits.
- [ ] Required checks/fresh whole-change review; publish/source/deploy readbacks via existing canonical/personal deployment identities, not this source-only worktree.
- [ ] Actual selected implementation copy repair + boundedprefix/unchanged-repeat/version/eventidentity and preservedconfig evidence; notify peer, retain own report/V5/exits.
