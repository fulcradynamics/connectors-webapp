# Connector and knowledge-skill coexistence

Ash's requirements: connectors, templates and forks operate without an agent; the Company Knowledge Skill operates through already connected platform accounts without this app; installing both improves discovery and knowledge while preserving their independent operation. Advertise the add-on only after the skill and integration are verified.

## Approach

A shared writable root index would create competing writers. Completely separate, undiscoverable stores would make installed components miss each other. Use one small, deterministic discovery manifest per app instance and retain existing source and knowledge locations. This follows the contract reconciled with the existing Company Knowledge Skill session in `skills/map-our-team/references/source-discovery.md`.

The default native worker publishes `/knowledge-sources/v1/fulcra-connectors/<persistent-instance-id>.json` in the already authorized owner's Fulcra account. Different forks/installations retain different persistent instance IDs. The manifest never changes shares or grants. Fulcra owner identity comes from the authenticated read context, not a claim inside the document.

Each file has schema `fulcra.knowledge-sources/1`, producer ID/instance, publication time, and up to20 connection summaries. Required source fields are provider, connection_id, mode and status. Optional fields include provider_account_id, identity_kind, workspace_id, files_path, record_type, index_path/index_revision, last_verified_at, selected_count and scope_hash. No resource bodies, selected resource IDs, credentials, cursors, controller/run IDs or human content enter this manifest. Bound it to64KiB.

Attio exposes its verified workspace ID. Notion exposes its integration identity with workspace unknown; account, installation and integration identities must not be relabeled. Instance-local connection IDs never deduplicate resources across installations. Consumers need sufficient provider/resource namespace and separate access context before coalescing native and copy routes.

Existing Notion and Attio working copies/indexes remain connector-owned. Their verified index file ID and stable publication time can be advertised. Generic routes advertise the existing folder and/or v1 data type, without inventing an index or a content-freshness timestamp. Preserve last verified pointers when disabled or uncertain. Unknown authentication/transport failure is not confirmed access loss.

## Publication and scheduling

The native worker creates the manifest from its own validated configuration and saved index metadata. It uses retained bounded file intent phases: inspect, guard, allocate, transfer and exact published-content readback. Publication has no model or skill dependency. No source/provider mutation occurs in a discovery phase.

Work runs between active document jobs. A failed metadata publication backs off and lets ingestion continue; its intent survives normal restart/rollover. The controller schedules retained catalogue work. Semantic comparison excludes publication clocks and routine poll timestamps, so unchanged evidence creates no new versions. Never replace an unrelated or differently owned file at the reserved path. Scope changes during an already allocated attempt are reconciled without discarding the retained receipt.

The skill reads authorized manifests and their actual advertised routes, then maintains steward-owned pointers under its existing `/team-map/`. Optional synthesis uses separately authorized owned knowledge sections, such as an existing `/vault/`. The app writes neither namespace. The skill does not edit source working files, producer indexes, manifests or operational state. Missing manifests are normal for skill-only/native-platform operation. Installing the skill does not install a background dreaming process.

## Acceptance

- Connectors-only publication works without an LLM, skill installation or map/vault.
- Skill-only discovery works with connected platform accounts and no app manifest.
- Both-installed reads associate the actual producer manifest, route, stable identity, verified revision and owner context; no duplicate import or new permission grant.
- Multiple instances, unknown schemas, path/producer mismatch, transport failure, disabled sources and concurrent metadata edits retain correct ownership and status.
- Exact readback precedes current publication; interrupted phases recover; unchanged runs preserve file/version IDs.
- Full checks and independent review pass. Live native deployment preserves existing identity/grants/connections/landing. Producer output and consumer interpretation are read back before adding the published skill to the template.

PostgreSQL remains an alternate sync backend; automatic producer publication is on the default native path. Its existing ingestion remains independent, and known output routes can still be mapped without manifests. No cross-service atomic transaction or source-permission inheritance is claimed.
