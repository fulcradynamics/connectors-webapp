# Template account onboarding

Approved by Ash in chat: remove misleading reference-template login actions and make the account → deployment → provider setup path explicit.

The public reference is a copyable connector template. Visitors start account creation/connection at https://fulcra.ai/product/start-for-free, then use a coding agent with terminal/deployment capability to create their own instance at their chosen my.fulcra.ai domain. Provider connection happens on that owned instance, using the required token/API key or OAuth flow. Collection requires source selection, preview and explicit enablement.

Remove direct reference `/app` and `/login` calls to action from the public homepage and user-guide header. Keep private-instance authentication, owner checks, background authorization and all existing credentials/state unchanged. Add a prominent template explanation, account onboarding link, copyable agent setup prompt and three clear steps. Preserve the honest published-preview source instructions; do not silently ship unrelated pending changes or claim main merged.

Update public user, setup and agent instructions and README to teach the same flow. The setup prompt must name the reference guides, verify the intended owner, choose an authorized namespace, preserve existing state, obtain appropriate provider scopes and verify real output before claiming success. Never ask for credentials in chat or enable collection just because a copy exists.

Approach: change the existing Svelte homepage/guide and their existing published Markdown sources; no hosting migration or authentication rewrite. This is the single approved approach. Keeping the login link with a warning would retain the confusing action; deleting login routes would break real private deployments.

Acceptance: visitors see account onboarding first and no reference-instance login/workspace links; prompt can be copied with a readable fallback; links and three-step flow work on desktop/mobile; owner-only login/APIs remain intact; exact source publication and READY deployment read back; reference identity and existing connection count preserved.
