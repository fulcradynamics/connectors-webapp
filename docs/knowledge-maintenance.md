# Schedule company knowledge maintenance

Use an ordinary scheduled task in Codex or Claude to run the optional Company Knowledge Skill. The agent's model reviews evidence and maintains knowledge pointers; the connector app continues importing and updating navigation indexes independently. No separate model server, database or cron service is needed.

This is a reusable setup recipe. It creates no schedule merely by being installed or copied. Each installer chooses the account, sources, writer, output scope and timing.

## Prepare your installation

1. Install the [Company Knowledge Skill (`map-our-team`)](https://github.com/ashfulcra/fulcra-tools/tree/main/skills/map-our-team), and connect the source accounts you want the agent to use. A connector app is optional; platform-connected accounts work on their own.
2. Ask the agent to find your existing team map and verify its storage account, team and effective audience. If no map exists, create and verify one with the skill before configuring recurring maintenance. Check inherited folder/account/group grants for any output, not just direct shares. Keep the human operator separate from the storage-account owner. An unreadable map is not an absent map.
3. Choose one designated writer and an explicit handoff from any current writer. Keep other agents in proposal mode. A normal file is not an atomic distributed lock; use one writer workflow, and stop mutation if an unexpected edit appears.
4. Select actual company sources. Include account and route context; imported data marked ready can still be demo, personal or historical. Source access and Fulcra-copy access are separate. Missing tools or a partial listing do not authorize another login or broader collection.
5. Choose whether the task may save its maintenance checkpoint in the named state location. A configured path alone is not write authority; without authorization, checkpoint proposals stay in the run result. Start with a manual proposal pass. By default, the map holds routing/role/check facts and synthesis stays in the run result. Proposal mode does not change the canonical map or persistent knowledge output, even if a destination is writable. Applying substantive knowledge requires maintain-map mode plus a separately authorized output or owned existing vault section; keep it outside two-way working documents.

The skill's [scheduled-maintenance reference](https://github.com/ashfulcra/fulcra-tools/blob/main/skills/map-our-team/references/scheduled-maintenance.md) owns the canonical run prompt and per-installation configuration. Keep that run prompt with its filled configuration in the task, rather than relying on chat history or a link alone. It covers source citations, bounded reads, pending work, unchanged repeats and recovery. This guide is the setup wrapper, not another implementation of that protocol.

## Copy this setup request into your agent

Fill the bracketed choices in ordinary language. Your agent should resolve and verify account IDs using the installed tools; never paste tokens into a task prompt.

```text
Set up scheduled company-knowledge maintenance for [team]. Use the installed
map-our-team skill and its references/scheduled-maintenance.md recipe.

Use the existing map in [authorized company account / known map location].
Start in manual proposal mode with [company source accounts and routes].
Keep synthesis in the run result unless I explicitly choose an authorized
persistent knowledge output or owned existing section.

Verify the team, storage account, effective output audience and current writer.
Show the resolved per-installation configuration, a bounded evidence-backed
proposal, and an unchanged repeat. Keep demo/personal/unknown material classified;
never turn index publication time into proof that company facts are current.

For ongoing writes, establish one designated writer and the actual handoff.
Reuse my explicit write authorization when already given; ask only for a missing
consequential choice. Do not create shares, credentials or additional imports.

Then help me create or update one native [Codex or Claude] scheduled task at
[cadence and timezone], using the canonical run prompt plus verified configuration.
Show its saved task ID, writer binding, mode, schedule and runtime requirements.
Run it once on demand and read back any authorized changed outputs. Only call it
unattended after an actual scheduled run has been observed. Preserve pending work
on failure; do not silently switch accounts, writers, outputs or source scopes.
```

## Codex setup

Use the desktop app's **Scheduled** view or ask Codex to schedule the verified prompt. An existing steward chat is useful when the task should retain that writer's context. A standalone scheduled task starts separate runs, so include the complete prompt/configuration and designated writer binding. Invoke `map-our-team` explicitly.

Choose cadence/timezone and model settings in the scheduler. Local-project tasks need that machine on, the app running and the project available. Use **Scheduled** to inspect the saved configuration and results. Confirm that the actual scheduled context has its required tools and access; a successful manual chat is not proof of an unattended run. See the current [official scheduling documentation](https://learn.chatgpt.com/docs/automations).

## Claude setup

In Claude Cowork, open **Scheduled → New task → Create with Claude**, or choose **Set up manually** and enter the task name, complete prompt/configuration, approval mode and frequency. In the newer unified experience, describe the recurring task in a conversation and review the proposed schedule. Finish the product's **Schedule** or **Save** action, then inspect the task in **Scheduled**.

Use the installed skill and already connected tools in that task. Tasks requiring local files/apps run locally; check the runtime shown for your setup. Run once on demand and inspect the results before relying on recurring work. See [Anthropic's current scheduling instructions](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork).

## Verify before relying on it

- The task's actual account, map root and designated writer match the installation. No other active writer or duplicate schedule targets that map.
- A first bounded pass uses real authorized sources, cites them, separates company/demo/personal/unknown evidence and reports unread or unfinished scope honestly.
- An identical repeat leaves map/knowledge content, publication versions and semantic timestamps unchanged. Per-run status can record a new check without rewriting the knowledge map.
- A partial read, inaccessible source or uncertain publication retains its cursor/pending work. Read back an uncertain write before retrying; never advance unprocessed scope or infer deletion from absence.
- An unexpected writer/edit stops mutation and retains proposals. Ordinary version checks are not a cross-service atomic lock.
- The saved task configuration and first actual scheduled run are visible in the host scheduler. Until observed, describe recurring execution as configured or unverified, not proven.

The reusable recipe and manual behavior can be tested without creating anyone's personal automation. A particular schedule, machine lifetime and credential renewal still need their own installation evidence. Installing the skill alone starts no background task.
