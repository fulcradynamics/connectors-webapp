# Company account and member connectors

Use a new company-owned Fulcra account for company imports and the company knowledge map. Members can separately keep their own connectors and knowledge skill. Each works alone; together they associate verified source pointers and explicitly shared contributions.

This guide covers the connector app. Follow [first-time company/member setup](https://github.com/ashfulcra/fulcra-tools/blob/main/docs/team-knowledge-setup.md) for Fulcra installation, account setup, joining and feedback. The skill's [company deployment contract](https://github.com/ashfulcra/fulcra-tools/blob/main/skills/map-our-team/references/company-deployment.md) owns the contribution format, reconciliation and incoming-join listener. Use its [scheduled-maintenance recipe](https://github.com/ashfulcra/fulcra-tools/blob/main/skills/map-our-team/references/scheduled-maintenance.md) for recurring reasoning. Do not maintain another copy of those protocols here.

## Four separate permissions

| Boundary                                 | What it permits                                                                                         | What it does not establish                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Provider credential and selected sources | Read selected Notion pages or Attio records; explicit two-way configuration can permit supported writes | Permission to distribute imported content to every member                         |
| Fulcra output share                      | Read the chosen company folder/files or v1 data type within the grant                                   | Connector `/app` access, provider membership or write access to the owner's files |
| Member contribution share                | Company reader can inspect that member's named contribution stream                                      | Approval to republish private evidence or change Notion/Attio                     |
| Company knowledge writer                 | Reconcile authorized evidence into the named map/knowledge output for its approved audience             | Ownership of connector indexes, working documents or credentials                  |

Fulcra shares are read-only. A shared folder includes its descendants; check direct, inherited and group grants before choosing an output audience. v1 record shares operate at data-type scope, optionally with time bounds, rather than this app applying a per-record ACL. File shares do not have time bounds. Keep different audiences in separate destinations/types and review their history before sharing. Paths, labels, an email address and a successful import are not access controls.

## Set up the company instance

1. Follow the linked Fulcra setup guide to establish the **new company account** and verify its actual Fulcra user ID. Keep the company storage identity distinct from the human operator and any agent contact identity. A company name alone is not verified ownership.
2. Deploy a fresh copy using [setup](setup.md), authenticated as the intended company owner. Give it its own namespace, instance ID, encryption keys and native state. Do not change an existing personal deployment's owner setting or copy its `.env`, private state or credentials to simulate a transfer.
3. Keep `CONNECTORS_MODE=personal`, the default owner-protected mode; the owner may be the company account. `public-template` publishes reference documentation and is not a team administration mode. Current control APIs accept exactly the verified owner; sharing output with members does not let them sign into its `/app`. Do not share the owner's login or token to add administrators.
4. Sign in as that owner at `/login`, open `/app`, and grant app-wide background access. Add each provider through its protected credential form. Use a company-approved credential and review its real authority, then select exact sources. Begin with one-way import and a small representative selection.
5. Choose company-owned folders and/or v1 types divided by intended audience. Review **Sources → Destination → Schedule → Preview/Enable**. Verify actual output bytes/records, provider identity and source IDs; an empty preview or upload receipt is not acceptance.
6. Install `map-our-team` if desired. Let it adopt verified connector discovery pointers and existing platform-connected accounts into the same company map; it does not need another import of the same source. Keep synthesis outside two-way working folders. Share only approved map/knowledge/source outputs, not credentials, development journals or raw restricted evidence.
7. Configure incoming-join checks and any recurring knowledge task through the canonical skill guides. A connector background worker imports and updates indexes without a model. It does not run the company agent, listen for member joins or reconcile member proposals. Verify an actual listener check and scheduled run in their host before claiming unattended operation.

Copy into the company agent after filling the choices:

```text
Use ashfulcra/fulcra-tools and its team-knowledge setup guide for [company].
Establish the new company-owned Fulcra account and verify its storage user ID,
separate from me as operator and from the company agent's contact identity.
Do not repurpose my personal account, map or connector deployment.

Deploy a fresh owner-protected Fulcra Connectors instance at [company namespace].
Keep independent instance keys/state. Before enabling collection, resolve my
approved provider accounts, exact sources, destination audiences and schedule.
Use protected forms for credentials; never put tokens in prompts or source.
Start with one-way import of [small approved selection]. Verify provider identity,
actual imported output and index/discovery pointers, then an unchanged repeat.

Use map-our-team's canonical company-deployment contract for the company map,
member-owned contributions, incoming-join checks and reconciliation. Share only
the outputs and member audience I approve; source access is not redistribution
approval. Keep unknown/private evidence as restricted links or proposals.
Keep knowledge synthesis outside connector working copies. Provider writeback
needs separate exact source/field/edit authorization and connector confirmation.
Report configured versus actually observed listener/scheduled execution.
```

## Join as a member

Members can use `map-our-team` with existing Fulcra platform connections without deploying this app. Deploy a personal connector only for additional sources you want to import. Its owner, source credentials, selections and outputs stay independent of the company instance.

Follow the canonical join guide to verify the company storage/contact identities and the member roster, request the intended company output shares, and optionally share a **narrow member-owned contribution stream back**. Read-only company shares cannot be used to edit company working copies. A channel handshake, a roster entry and access to company content are separate checks. A member's broad provider token is not made private merely because it is stored in a personal deployment.

```text
Help me join [company] using ashfulcra/fulcra-tools and its team-knowledge guide.
Verify my Fulcra account and the company's storage/contact identities against
the approved invitation. Reuse accessible company source pointers and my existing
platform connections; do not create duplicate imports or broaden sharing.

If I need my own connector, deploy it under my verified account with independent
keys/state and only my explicitly chosen sources. Check credential authority,
including workspace-level Attio tokens, separately from my member permissions.

Use the canonical company-deployment contribution format. Keep proposals in my
own narrow stream, with source provenance, base revision and publication audience.
Share it only with the verified company recipient when I authorize that share.
Unknown/private evidence stays restricted; a contribution is not permission to
republish it to all members or write back to a provider. Verify share/readback,
the company join acknowledgment and the content I can actually read separately.
```

## Notion and Attio source boundaries

**Notion:** this template's supported setup uses an internal connection, its capabilities and explicitly shared pages/children, followed by this app's page selections. A member's Notion login does not determine that connection's scope. Notion also documents user-scoped PATs and OAuth; this app does not provision those flows or synchronize provider ACLs. See [Notion setup and supported limits](providers/notion.md) and [official authorization](https://developers.notion.com/guides/authorization/overview).

**Attio:** the documented single-workspace token acts at workspace level, independently of a member. OAuth defaults to workspace level too; user-level OAuth requires explicit configuration and PKCE, which this app does not implement. The adapter validates workspace/scopes and selected record IDs, not each Fulcra reader's Attio rights. See [Attio setup](providers/attio.md) and [official token levels](https://docs.attio.com/rest-api/guides/authentication).

Attio's [record guide](https://attio.com/help/reference/managing-your-data/records/create-and-view-records) does not promise private records; list restrictions must not be treated as a blanket record export boundary. This connector imports selected People/Companies, not list permission models. Optional notes are separate opt-in. Choose company-approved record content and copy audiences explicitly; do not use an admin workspace key as proof of member-limited access.

Neither adapter mirrors provider permissions into Fulcra, grants team access, or withdraws already copied content when source permissions change. Use separate connections/destinations where audiences differ. Selected roots can contain newly added content; review that continuing scope with the provider owner.

## Verify the combined installation

- Company and member deployments report their distinct verified owners. A non-owner cannot use another deployment's controls. Intended recipients can read the specific shared output; excluded recipients cannot.
- A connector completes a bounded import and unchanged repeat without an agent. Discovery identifies the producing account/instance; the reader verifies the actual output revision rather than assuming a recent manifest means fresh facts.
- The skill works with platform-only sources and with connector pointers. Matching titles or folders do not merge records. Preserve provider namespace, stable object ID, revision, producing account/route and audience; unknown namespace or access remains separate.
- A member's approved test proposal is read back, acknowledged, reconciled by the designated writer and recorded with provenance under the canonical contract. An identical repeat does not duplicate it. Unread sources and uncertain publication remain pending; absence does not prove deletion.
- Knowledge writes do not alter connector-generated indexes or two-way working copies. Test provider writeback separately only when explicitly enabled for selected sources/fields; collection and dreaming are independently pausable.

These are installation acceptance checks, not a claim that this documentation has created a company account, listener or schedule. Automatic member-to-company replication, provider ACL mirroring, multi-user app administration and user-level Attio OAuth are outside the current connector implementation.

## Offboarding and feedback

Pause affected connections, revoke/rotate credentials where appropriate, review Fulcra direct/inherited/group grants and retained file/record history, stop contribution shares/listeners, and update the map's access facts. Revoking provider access does not erase copied content or unshare a derived knowledge output. Removing a roster entry alone does not revoke a Fulcra grant.

For feedback or requests to Ash's agents, start at [agents.ashkalb.com](https://agents.ashkalb.com). Read its current agent brief and the linked Fulcra Tools setup guide, reuse an existing verified connection, and share only the dedicated message channel when establishing a new one. Send a redacted problem statement and reproduction; leave credentials and private source bodies out. Read back your message and verify the matching reply before calling delivery acknowledged. This guide creates no connection or recurring message checker.

For uncertain sends, follow the current `connect-our-agents` skill's recovery and stop signals. The invitation supplies the recipient and introduction; older same-ID retry wording is not permission to repost blindly or bypass a denial.
