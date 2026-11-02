# Architecture

Each deployment belongs to one verified Fulcra owner. It imports selected third-party data into that owner's Fulcra folders, v1 data types, or both. Provider credentials and unattended Fulcra access are separate encrypted grants.

## Flow

1. Authenticate the owner and validate a provider credential.
2. Discover sources and persist explicit stable-ID selections.
3. Choose destination, history and interval; preview without writes.
4. Confirm enablement. The runner reads bounded pages and persists candidate outputs.
5. Persist delivery intent, submit files/records, verify exact readback, then commit the checkpoint.

Adapters implement credential validation, discovery and bounded source reads. The shared runner owns delivery, revision identity, retries and cursor advancement. Signed events enqueue hints for that same runner; they cannot choose destinations or bypass source selection.

## State and trust

Native Vercel Workflow persistence, queue and sleeps provide operational state and scheduling through Fulcra hosting. A serialized controller applies configuration/commands and advances bounded worker phases. Command IDs preserve deduplication across timeouts and handoffs. Missing established state fails closed. PostgreSQL is an optional alternate runner.

Imported content lives in Fulcra. Credentials and staged source bodies are additionally AES-256-GCM encrypted with instance/owner context; the key remains server-only. Source payloads and documents never authorize actions. Owner mutation routes verify identity and same origin; machine callbacks use their own authentication.

## Revisions and limits

A revision ID includes owner, connector, source account, route version, source ID/version and canonical payload. The same revision must produce stable artifact bytes. Source changes create new revisions; imports are retained after deletion/access loss. Cross-service exactly-once transactions are not claimed.

Native state is bounded: 20 connections, up to 50 selected discovered sources per connection, 100 changes per page, 1 MiB staged values, a 1.5 MiB worker-state budget and a 2 MiB normal total budget. Large roots/backfills may need smaller selections or multiple cycles. Source staging expires logically after 24 hours. Platform history follows hosting retention; see [operations](operations.md) and [provider limits](user-guide.md#connect-a-service).

## Opt-in Notion two-way pages

The native backend can opt a Notion connection into page-title/Markdown-v2/archive reconciliation over owner-editable Fulcra working files. A non-expiring encrypted per-connection manifest holds scope, mappings, baseline hashes and pending operations; provider/file writes advance in bounded persisted phases and commit only after readback. Selected roots and one selected creation parent define scope. New children under that parent and new UUID working files are mapped, bounded to50pages/24KiB perbody. Conflicts retain both versions in owner files and require current reviewed resolution. Per-attempt creation guards plus deterministic Notion marker titles reconcile response loss without duplicate POSTs. Existing one-way adapters, revision history, owner auth and native controller identity are retained. See the Notion provider guide and two-way design for API race limits.

Mixed Notion pages use a complete bounded protected-block projection when Markdown export is incomplete. Existing top-level text runs may be edited in place; layout, styling, opaque blocks and entire nested containers remain provider-owned. Full protected snapshots participate in hashes/conflicts, while one-block persisted writes and deterministic intermediate versions reconcile lost responses. Accepted text survives missing working files even after provider progress. Explicit conflict resolution rebases chosen text onto fresh protected snapshots only when block/run correspondence is unchanged. Automatically discovered/created pages are checked against the actual provider parent on each reconciliation; moved children are quarantined. See [production hardening design](superpowers/specs/2026-11-02-notion-production-hardening.md).
