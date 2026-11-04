# Verification status

The adapters, shared runner, native state/command lifecycle, owner gates and bootstrap helper have automated synthetic tests. Browser checks exercise credential links, named v1 types, source/destination/schedule/preview, navigation and background authorization recovery.

Live checks cover selected GitHub imports and revisions, Notion two-way page edits and recovery, and Attio selected-record edits and linked note revisions. Readbacks verify actual Fulcra records/files, source changes, background scheduling, conflict resolution and sync-updated indexes within each connector's supported scope. Provider guides describe the available data and controls.

Run the current test commands in [contributing](../CONTRIBUTING.md); CI is the source of current public build results. Instance IDs, run records and private evidence stay in the owner's Fulcra workspace.
