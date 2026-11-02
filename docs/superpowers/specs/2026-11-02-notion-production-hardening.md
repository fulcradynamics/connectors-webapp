# Notion production hardening

Ash requests production hardening before a two-way Attio specification. Engineering choices below are implementation decisions under the existing autonomous delegation. Keep supported Notion title/Markdown/archive behavior, mappings, grants, routes and deployment identities. Existing strict audit and required non-author review remain release gates.

## Acceptance

- Current selected pages with opaque blocks can have verified working copies and safe in-place text edits without reconstructing or deleting opaque content. Scope and incomplete reads fail closed.
- Preserve original accepted edits, conflict versions and archive bodies; reconcile uncertain writes and native restarts without duplicate mutations. No universal CAS guarantee is claimed: Notion exposes no documented conditional-write primitive.
- Required strict audit, fixture/bootstrap/type/build/auth/privacy checks pass under reviewed compatible dependencies. Actual production/native migration, page change/index/no-echo and protected block identity/readback prove deployment behavior.
- Explain remaining supported limits and unverified paths precisely. No unsupported full-mirror claim, silent size increase, audit suppression or branch-protection bypass.

## Two representations

Complete Markdown pages retain the current strict working-file header and editor. Mixed pages use a versioned managed-block projection inside the existing Markdown body. Its JSON capsule binds page ID, ordered top-level block IDs/types, immutable attributes/style metadata and protected subtree snapshots. Only strings in declared editable text runs are mutable. A shared browser/server parser validates the format and immutable layout; source text is JSON encoded and cannot become delimiters or instructions.

Mixed mode supports existing top-level rich-text leaf blocks only (paragraph/headings/list items/to-do/quote/callout/code with text runs). The app shows text fields; formatting, opaque blocks, container hierarchy, additions/removals/reordering and non-text runs are protected and edited in Notion. Root containers and their complete descendants are immutable in this first release. This is a deliberate supported-data contract, not arbitrary Markdown interpretation around opaque markers.

Enumerate child pagination and descendants using bounded requests/nodes/depth, reject repeated cursors, missing IDs, inaccessible reads, unsupported unknown shapes and capacity overflow. A partial tree is never marked complete. Opaque state participates in the projected document hash, conflict tokens, archived retained copy and guarded comparison. Hash references alone are not sufficient if the readable snapshot is missing; the managed body retains the bounded projection, while immutable working-file versions retain evidence outside the manifest.

## Writes and recovery

Compute one next block edit from the retained expected and desired bodies. Validate exact page binding, ordered block identity and all non-text fields. Re-read the target block, compare expected allowed fields, PATCH only its rich_text (omit children), then read back in later persisted steps. Only IDs owned by the fresh provider projection may be patched. Normalization or third-party changes produce conflict/reconciliation, never blind replay or rollback.

The existing notion write intent retains expected/desired/source revision. Each body step changes at most one block; its deterministic intermediate document recognizes a committed write whose response was lost. Other text edits stay in desired until verified. Opaque/layout changes invalidate recognition even with identical visible text. Archive/restore continues retaining the verified projection and rechecks restored content before applying text edits.

The service rejects changes to managed structure before accepting an app save. Direct file edits are revalidated against provider-owned layout before any provider mutation. New-page creation uses ordinary Markdown and cannot submit a forged managed capsule. The index continues reflecting last verified state without per-poll version churn.

## Dependencies and rollout

Use a supported direct framework migration where required, scoped reviewed transitive compatibility overrides and a minimal auditable security backport only where no upstream fix exists. Record original license, patch rationale, exploit regression and consumer contracts. Keep Workflow5.2.3 runtime/state compatibility; do not force an old SDK or alter audit policy. Review the exact candidate, run all checks and both app native-rollover/readback canaries with existing identities/configuration before publication acceptance.

## Release boundaries

Keep 50 mappings/24KiB per managed or Markdown body/200-character titles until separately partitioned-state support is implemented. Capacity failures must retain accepted work or reject before acceptance; they must not truncate provider writes. No physical opaque deletion, no database-property/comment mirroring and no Attio implementation in this milestone. After Notion hardening, produce a separate two-way Attio spec using pinned MIT prior art, with its own permissions, conflict and acceptance contract.
