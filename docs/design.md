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
