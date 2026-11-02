# Use your connectors

Your copy runs at `your-name.my.fulcra.ai`. Sign in at `/login`, then open `/app`.

## Connect a service

1. Allow the app's background Fulcra access once. Approve in the popup; the page checks automatically and resumes after reload. If blocked, use the verification link. Browser sign-in and unattended access are separate.
2. Choose a service. Its form includes direct token/app console links, help, required scopes and copy steps. Granola creates keys in its desktop app; the exact path is shown.
3. Enter your read credential in the protected form, verify it, and select the exact sources to collect.
4. Choose **Destination**: files, v1 records, or both. Pick a folder and/or compatible owned v1 type. **+ Create new v1 data type…** creates a type with your name and optional description and selects it. The separate standard-type action creates/reuses `Connector records`.
5. Choose **Schedule** and the initial history date. Save, inspect the preview, confirm it and enable collection.

| Service | Sources                     | Setup and limits                                           |
| ------- | --------------------------- | ---------------------------------------------------------- |
| Granola | Selected folders            | [API keys, notes and transcripts](providers/granola.md)    |
| Asana   | Selected workspace projects | [Tokens, tasks and events](providers/asana.md)             |
| GitHub  | Selected repositories       | [PAT/App, issues and comments](providers/github.md)        |
| Notion  | Selected root pages         | [Connection token and nested blocks](providers/notion.md)  |
| Slack   | Selected member channels    | [Bot/user tokens, history and threads](providers/slack.md) |

Use **Back to all connectors**, **Add connection**, or the top **Connections** link to return to the chooser. Leaving details does not save edits, disconnect, or change collection.

## Defaults and controls

| Setting         | Proposed default               | Your control                                       |
| --------------- | ------------------------------ | -------------------------------------------------- |
| Frequency       | Every5 minutes                 | Per connection, 60 seconds–24 hours                |
| Initial history | Previous 7 days                | Per-connection start date; provider semantics vary |
| Destination     | Files in `/connectors/SERVICE` | Folder, compatible v1 type, or both                |
| Sources         | None                           | Explicitly selected resource IDs                   |
| Collection      | Off                            | Review preview, confirm and enable                 |

The interval is the delay after a completed cycle, not an exact freshness promise. Rate limits, large backfills and delayed source content can slow it. Notion traverses complete roots regardless of date; Asana includes incomplete tasks plus recently completed tasks. Provider guides describe the differences.

All record types use a common envelope: timestamps, connector, source ID/version, operation and provider data in `payload`. Creating a named type uses that schema. An arbitrary existing schema may require a mapper change in code; there is no field-mapping editor.

## Pause, update and disconnect

**Pause** stops future work. **Retry queued work** retries recoverable failures. **Replace credential** retains settings but requires a fresh preview to resume. **Disconnect** removes this app's local provider credential; revoke it at the provider if needed. Signing out does not revoke the app-wide background grant; use its separate disconnect control.

Imported history remains in Fulcra after source removal or disconnect. Revisions are stored separately. Last attempt, verified sync, errors and backlog are shown in connection details. A delivery is verified only after its actual record/file content reads back.

Credentials are encrypted server-side in your deployment's operational state. Its encryption key stays in server environment variables. Secrets are not returned in settings summaries; do not paste them into chat or issues. See [security](../SECURITY.md).

## Ask an agent to add a service

> Read this repo's AGENTS.md and agent guide. Add SERVICE for these sources and destination. Follow the existing adapter, credential-link and source/destination/schedule/preview patterns. Use Fulcra v1 types and folders. Add synthetic tests and explain limits. Prepare a PR for review. Ask about missing settings before enabling collection.

### Two-way Notion pages

Notion imports are one-way by default. For editable page title/Markdown/archive sync in both directions, enable the explicit two-way checkbox, choose a creation parent and follow the [Notion two-way setup](providers/notion.md#optional-two-way-page-sync). The app includes a page editor, new-page creation, recoverable archive/restore, sync controls and reviewed conflict resolution. Preview and enable are still required.

For two-way Notion pages, **Agent index** in the connection panel gives the generated `index.md` path and publication state. It is updated from verified sync results and groups page/source links by status, including archived/conflicted/unsupported entries. Agents can start there instead of enumerating UUID files. Edit the page working copies, not the generated index. See the [Notion guide](providers/notion.md#agent-navigation-index-and-storage) for storage and the reasons behind the current POC bounds.
