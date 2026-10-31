# Two-way Notion page connector

## Intent and authority

Turn the existing Notion → Fulcra POC into an opt-in, working two-way page connector. The owner requested autonomous planning, implementation and live testing, and identified the Notion workspace as disposable demo data. These are engineering choices made under that delegation, not claims that the owner chose the details below. Permission expansion still requires the browser's action-time confirmation. No permanent purge is needed.

## Approaches

1. Editable Markdown files in Fulcra, reconciled with Notion page Markdown: follows the existing file destination and lets humans/agents edit either service. **Chosen engineering approach.** Add an app editor over those same files.
2. A v1 change-command outbox: useful for applications but requires users to author command records rather than edit their documents. Defer it.
3. A general Notion block/database/property mirror: much larger mapping and schema problem. Defer database property writes, comments and binary attachment replication.

## First version

- Existing one-way connections continue to work unchanged. Two-way mode is explicit, Notion-only, and uses the existing native Workflow backend, owner boundary and encrypted provider/background grants.
- Sync page titles, Notion-flavored Markdown v2 body and recoverable archive/restore. Preserve the existing immutable import history. Do not interpret a missing search result, inaccessible page or absent file as a deletion.
- Two-way working copies live in the chosen destination's `live` folder, one stable UUID `.md` file per mapped page. Front matter is a strict small JSON-valued format: `fulcra_notion: 1`, `title: "..."`, `archived: false`; the body is Markdown. IDs/parent scope come from the server manifest, never editable content.
- The app can list/open/edit working copies, create a document, archive/restore it, trigger sync and resolve a conflict by choosing a specific reviewed current version. These actions change Fulcra working files; the ordinary native worker propagates them to Notion.
- A new Fulcra document creates a child under one explicitly selected existing page, configured as the creation parent. A new Notion child under that parent is discovered and mapped automatically. Other pages remain explicitly selected; data-source/database membership and properties are not generalized in this release.
- Bound a connection to 50 mapped pages and a page to 24 KiB of editable Markdown, with existing total native state budgets. An oversized/incomplete/unknown-block export is shown as unsupported for two-way editing, never silently rewritten. Leave read-only history available.
- A file's `archived: true` or the app's Archive action requests a recoverable Notion trash operation; restoring reverses it. A Notion `in_trash` state updates the working copy's archive flag. Do not propagate permanent deletion or treat 404 as trash.
- Two-way remains disabled until configuration/preview is confirmed. Read, Update and Insert Content are needed on selected pages/creation parent; no comment/user/agent access needed. Preview performs no writes.

## Reconciliation and durability

Keep a small non-expiring encrypted manifest per connection: stable local ID ↔ Notion page ID, last converged content hash on each side, title property ID, current status, pending operation and readback evidence. Keep full content in Fulcra files or bounded encrypted pending state, not public status.

For each mapped page, read both sides and compare normalized title/body/archive hashes with the last converged pair:

- Neither changed: no writes.
- Only Notion changed: persist a Fulcra delivery intent; reread the current Fulcra version before allocation; write and verify the exact latest file bytes before advancing the baseline.
- Only Fulcra changed: persist a Notion write intent, reread Notion immediately before each mutation, apply title/body/archive in bounded durable phases, then reread the page and Markdown before advancing the baseline.
- Both changed differently: retain both versions and show a conflict; do not pick a timestamp winner. Equal results converge without an echo write.

Notion does not document atomic compare-and-swap for page titles. Rechecks and readback detect ordinary concurrent changes; do not promise atomic cross-service transactions. Body edits use a guarded full-previous-body `update_content` operation where nonempty, refusing child-page/database deletion. Empty-body edits require the preflight snapshot and full readback. Preserve before/desired/observed content on a detected mismatch for conflict resolution.

Every side effect has a persisted intent before execution. Result ambiguity is reconciled, not blindly repeated. New Notion pages are first created with a deterministic temporary title `Fulcra sync <local UUID>`. If the creation response is lost, enumerate the configured parent's actual children and recover that exact marker; do not send a second create while the first outcome is unknown. Persist the returned page ID before filling its final title/body. Repeated polls must stabilize without new versions or duplicate pages.

Avoid overwriting a newer Fulcra edit during a pull: reread the latest file before upload and again after readback. If a race is observed, retain the competing bytes and surface a conflict. File APIs also lack a documented atomic cross-service transaction; that limitation is explicit.

## Implementation boundaries

- A pure document codec/reconciliation decision module owns validation, normalization, stable hashes and conflict decisions.
- A Notion Markdown adapter owns page/Markdown reads, guarded updates, create-marker recovery, child discovery and trash/restore.
- A dedicated native two-way worker advances one bounded persisted phase at a time, sharing credential refresh/scheduling with the existing worker. It does not replace the other adapters or bootstrap another controller.
- Owner-authenticated per-connection routes expose list/read/save/create/archive/resolve/sync operations. They accept IDs from the connection manifest only, validate same origin and body size, and never return credentials.
- A focused component renders the editor/status/conflict controls. Add direction/creation-parent configuration and exact write-permission instructions to the existing source/destination/schedule/preview flow.
- Native status exposes counts, phase, conflicts and last verified time, not staged private source content. PostgreSQL mode rejects two-way enablement clearly until implemented.

## Acceptance criteria

1. **POC:** inspect selected-source count and running state, read actual imported Markdown in Fulcra; distinguish completed initial scan from an ongoing one.
2. **Notion → Fulcra:** create a demo child in Notion; it appears as a mapped working copy with matching title/body. Edit title, headings, paragraphs, list/checklist and code; exact supported content is read back. Archive and restore propagate correctly.
3. **Fulcra → Notion:** create a working document via the app; exactly one Notion child appears under the chosen parent. Edit its title/body via Fulcra and read the matching result in Notion. Archive and restore propagate correctly.
4. **Conflict:** edit both sides since the last baseline; no automatic overwrite; app shows both versions. Resolve using the reviewed version, reread both services, then converge.
5. **Retry/loop prevention:** simulate a committed create with lost response, provider write with lost response, Fulcra upload failure/readback delay and restart between intent/apply/readback. No duplicate create, dropped baseline or advancing unverified checkpoint. Multiple unchanged cycles cause no writes.
6. **Scope/security:** reject unknown mapped IDs, foreign parent IDs, invalid/oversized working files, unsupported/incomplete Markdown and stale edit/conflict revisions. One-way mode, other connectors, owner auth and encrypted grants remain intact.
7. **Deployment:** meaningful regressions, Svelte/build/bootstrap/release/privacy checks, independent review, source readback, both existing deployments updated without replacing identity/controller; live demo evidence stored privately. Record dependency-audit CI separately, never call a failing gate passing.
8. **Exit check:** an acceptance ledger records evidence and remaining action, survives turns, and is checked together with this identity's V5/Unblock work before yielding. Continue safe authorized work while any criterion is incomplete; only pause for an exact external prerequisite, retain its linked task, and never infer completion from deployment alone.
