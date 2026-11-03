# Finding connector data

Connectors run on the native background worker, without a model, agent session or installed skill. They import the sources you enabled and maintain their generated navigation indexes from verified sync results. A knowledge skill can use those outputs; it is not required to keep collection running.

## Discovery across apps and forks

Each authenticated app instance publishes a metadata-only file at:

```
/knowledge-sources/v1/fulcra-connectors/<instance-UUID>.json
```

The persistent deployment UUID identifies the producer instance. A fork keeps its own deployment identity and credentials. There is no shared mutable root index. The file lives in the existing owner's Fulcra account; discovering a path does not grant access to its content.

Schema `fulcra.knowledge-sources/1` advertises each connection's provider identity, sync direction, status and chosen file folder and/or v1 record type. For two-way Notion and Attio, it also points to the last verified navigation index and its exact Fulcra file revision. Generic adapters advertise their existing file/v1 destinations without inventing a per-connection index. Their discovery status stays `pending` because no scope-bound output revision is available in this manifest; readers verify the actual files or records instead of treating a successful empty poll as output evidence. Source bodies, selected resource IDs and credentials do not enter the discovery file.

Notion's internal integration ID is an integration identity, not a verified workspace ID. Missing workspace identities remain null. Attio uses its verified workspace UUID. Never merge resources across routes using a title, folder or connection UUID; deduplication requires a sufficient provider namespace and stable resource ID, while each reader's access context remains separate.

## Updates and recovery

The serialized native worker publishes discovery in idle phases, using the same persisted allocation, transfer, version guards and exact readback as generated indexes. It checks metadata at most once per minute when idle; a busy sync completes its current work first. This is not a freshness guarantee or a new source polling interval. A discovery failure backs off and lets ordinary collection continue.

The semantic body determines publication. An unchanged check does not upload a new version or advance its publication timestamp. `last_verified_at`, when present, describes the advertised index revision's verification, not a recent poll. `ready` means the producer verified that output; a reader must still check its own access and the actual current revision. `pending`, `conflict`, `disabled` and `unknown` preserve uncertainty. Disabled connections retain pointers; a transport error does not imply deletion or revoked access.

A foreign or unknown-schema document occupying the reserved producer path is held for recovery rather than overwritten. Lost transfer responses retain their receipt and require readback. A definitively rejected upload capability is replaced only after a fresh published-history read excludes its allocation; prior-attempt evidence remains retained. Accepted allocated candidates finish reconciliation before a newer configuration is advertised. Bounded prior-attempt evidence is retained when an intervening generated version requires regeneration. No discovery operation writes back to a source service.

## Independent knowledge maintenance

A map steward can adopt these pointers alongside accounts already connected through the Fulcra platform. Absence of a manifest is normal: the reader can use its existing platform accounts and known authorized sources directly. It must not copy credentials or create grants to make discovery succeed.

The connector owns manifests, navigation indexes, working documents and operational state. A steward owns `/team-map/` pointers and role knowledge. Optional persistent synthesis belongs in an explicitly authorized knowledge destination or an owned section of an existing `/vault/`. It must stay outside two-way working files, where an edit could become a provider change. Neither component rewrites the other's state.

Provider permissions and Fulcra copied-file permissions are separate. Offboarding must check each copied route and grant, not just revoke provider access. Installing a skill does not start a consolidation schedule or background model worker. Agent-assisted consolidation may be called “dreaming”; deterministic sync and index maintenance continue independently.

## Install the optional Company Knowledge Skill

The published [Company Knowledge Skill (`map-our-team`)](https://github.com/ashfulcra/fulcra-tools/tree/main/skills/map-our-team) can be installed in your agent:

```sh
npx skills add ashfulcra/fulcra-tools --skill map-our-team
```

Ask it to map the company sources you already authorized. It works with platform-connected accounts without this app, and can adopt this app's verified discovery pointers when available. The skill supplies role/access research and source-cited answers; it does not import the same data again or grant access from a link. See its [source-discovery contract](https://github.com/ashfulcra/fulcra-tools/blob/main/skills/map-our-team/references/source-discovery.md) and [gap recovery guidance](https://github.com/ashfulcra/fulcra-tools/blob/main/skills/map-our-team/references/resolve-gaps.md).

Choose persistent output ownership and any maintenance schedule explicitly with your agent. Installing this skill starts no recurring synthesis service.
