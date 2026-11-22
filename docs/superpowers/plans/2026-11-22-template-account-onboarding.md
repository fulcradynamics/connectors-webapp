# Template account onboarding Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. One fresh whole-change reviewer checks the final patch.

**Goal:** Make the reference template's signup and deployment path clear and remove misleading login actions.

**Architecture:** Keep the existing Svelte app and private authentication. Add a public onboarding prompt helper and visible readable fallback; update existing homepage, user guide and Markdown guide sources.

**Tech Stack:** Existing SvelteKit/Svelte, Node 24, Vitest.

**Spec:** docs/superpowers/specs/2026-11-22-template-account-onboarding.md

## Global Constraints

- Base on deployed 9fb3c4c and limit this change to onboarding; preserve preview attribution and normal main review requirements.
- Keep all private login/routes/owner validation and existing instance state untouched.
- Account entry: https://fulcra.ai/product/start-for-free; private app: the user's own chosen domain.
- Never include credentials, owner IDs or operational journals in tracked source.

## Review Focus

- A visitor clicks any homepage/guide action: no navigation into reference /app or /login.
- Clipboard unavailable/denied: show selectable prompt and never claim copied.
- An ordinary chat lacks code/deploy tools: instructions explain the needed coding host.
- A returning owner has existing state: prompt/setup preserve identity, keys and grants.
- Provider access differs by service: explain tokens/API keys or OAuth, preview and explicit enablement.

### Task 1: Implement and verify the approved onboarding

**Files:** src/routes/+page.svelte, src/routes/guide/+page.svelte, src/lib/template-onboarding.js, src/lib/template-onboarding.test.js, docs/user-guide.md, docs/setup.md, docs/agent-guide.md, README.md.

- [x] Verify clean baseline with npm test; retain deployed reference identity baseline privately.
- [x] Add clipboard success/denial tests; observe RED, implement helper and readable UI fallback, observe GREEN.
- [x] Replace reference login/workspace actions with signup and agent-setup actions; add template explanation and account/deploy/use steps.
- [x] Align all four guide/readme sources with owned deployment and provider authorization language.
- [x] Run npm test, test:bootstrap, check, build, release/privacy checks and Gitleaks. Browser-check links, clipboard, tabs/flow and mobile; keep owner auth unchanged.
- [x] Fresh whole-change review; fix important findings with observed regression evidence.
- [ ] Publish branch/PR against main with explicit inherited preview baseline, read source back, deploy the exact approved patch to existing reference, and verify READY, public copy/guides/auth and preserved identity/state.
