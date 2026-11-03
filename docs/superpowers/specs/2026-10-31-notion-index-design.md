# Notion sync-updated OKF-style index

## Intent

The owner requires an agent-readable OKF-style index updated on sync, and asks why the current limits/file storage were chosen. Existing two-way pages are versioned editable Markdown with a private encrypted operational manifest; no readable index exists. Add derived navigation to the existing private Fulcra working folder without changing page codecs, source selection, limits or storage routing.

## Approach

Chosen engineering approach under existing autonomous implementation delegation: connector-owned `index.md` next to the stable UUID working files. OKF indexes are plain Markdown without concept frontmatter. Group page links by synced/archived/conflict/attention/pending status, include deterministic short descriptions, stable local/source IDs, generated Notion source links, verified working revision and meaningful content-change time. Include retained conflict-copy links. Existing strict-header working files remain editable inputs; this is an OKF-style index, not a claim that every working file is a fully conforming OKF concept.

A JSON-only manifest would not meet the human/agent progressive-disclosure need. A separate typed concept-wrapper tree/full OKF migration would duplicate documents and add unnecessary writes; defer it. No new v1 record type or embeddings are necessary for this index. Existing one-way imports can still use files and/or v1 records; current two-way mode remains file-only.

## Constraints

- Index is derived, not authoritative: edits to it cannot route/mutate Notion. Mark it connector-owned and regenerate it. Titles/provider text are untrusted data, escaped as text; only server-bound UUIDs generate file/source links.
- Never advertise pending bytes as verified. Missing/unsupported entries distinguish source links from last verified copies; conflict/archived/recovery states remain visible.
- Stable content-change timestamps and semantic row hashes exclude routine verification time; unchanged syncs must not allocate new index versions.
- Publication uses bounded persisted allocate/transfer/readback phases with exact latest-byte verification. Restart or lost reply must reconcile the retained publication intent. Index failures retain their intent/error and retry; healthy document work and accepted edits must continue.
- Current page/count/title limits are implementation bounds, not Notion limits. Document their rationale without raising them as part of indexing.
- Existing credentials, owner scope, native controller identity/state, working files, one-way history and unrelated providers remain intact. No annotations, no alternate profile or shared worker identity.

## Acceptance

1. index.md contains all mapped entries and safe relative working/source/conflict links, grouped by meaningful status, with no secrets/provider bodies.
2. Initial/missing/corrupt projection repairs; document content/title/archive/conflict/support/recovery changes refresh it from verified manifest state. Unchanged cycles produce no index versions.
3. Durable phases survive restart/delayed readback; transient index errors remain visible/retryable and do not stop healthy page work. A newer pending edit takes priority over index publication.
4. Meaningful renderer/worker regressions, full unit/bootstrap/check/build/auth/privacy review pass; canonical source bytes read back.
5. Existing personal/template sites redeployed with preserved identities/state; actual Fulcra index readback, real document change and unchanged-sync index version stability verified. Normal main audit/review gates remain.
