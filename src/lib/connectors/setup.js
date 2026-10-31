export const MAX_SELECTED_SOURCES = 50;
/** @typedef {{name:string,credentialUrl:string|null,credentialLink:string,credentialNote?:string,additionalCredentialLinks?:Array<{url:string,label:string}>,setupUrl:string,setupLink:string,credentialSteps:string[],scopes:string,sourceLabel:string,sourceHelp:string,sourceTroubleshooting?:string,output:string,backfillHelp:string,limitations:string,accountHint?:string}} ConnectorSetup */
/** @type {Record<string,ConnectorSetup>} */
const providers = {
  granola: {
    name: 'Granola',
    credentialUrl: null,
    credentialLink: 'Create a Granola API key',
    credentialNote: 'Granola keys are created in the desktop app.',
    setupUrl: 'https://docs.granola.ai/help-center/sharing/integrations/granola-api',
    setupLink: 'Granola API key instructions',
    credentialSteps: [
      'Open the Granola desktop app → Settings → Connectors → API keys → Create new key.',
      'Create a key with the note-access scopes you need, then paste it below. Business or Enterprise is required; an Enterprise admin may need to allow the scopes.'
    ],
    scopes:
      'Personal notes covers notes you own or can access privately; Public notes covers workspace-visible notes. Choose only the access you intend to import.',
    accountHint:
      'Use a stable label for this Granola account, such as my-granola. This is your import identity, not the API key; keep it unchanged when replacing a key.',
    sourceLabel: 'folders',
    sourceHelp: 'Choose the exact folders to collect. Deeper descendants need explicit selection.',
    output:
      'Meeting notes and transcripts: meeting.md files; structured records contain title, URL, summary, transcript status and available transcript. Large transcripts use separate paginated artifacts.',
    backfillHelp:
      'The date bounds initial changed-note discovery. Later polls overlap updates and revisit transcripts that were not yet available.',
    limitations:
      'Attachments and private scratch notes are not imported. Delayed transcripts can arrive on a later cycle.'
  },
  asana: {
    name: 'Asana',
    credentialUrl: 'https://app.asana.com/0/my-apps',
    credentialLink: 'Open Asana token console',
    setupUrl: 'https://developers.asana.com/docs/quick-start',
    setupLink: 'Asana token setup instructions',
    credentialSteps: [
      'Open the Asana token console using the link below, choose Create new token, give it a name and copy the personal access token.',
      'Find the workspace GID using the workspaces API, then enter that numeric ID below. The token inherits your permissions; this connector makes read requests only.'
    ],
    scopes:
      'The token must read your identity, workspace projects and selected tasks. A workspace name is not its GID.',
    sourceLabel: 'projects',
    sourceHelp: 'Choose projects within the workspace identified above.',
    output:
      'Task snapshots and changes: task.md files; v1 record payloads retain task fields including name, notes, completion, dates and source link.',
    backfillHelp:
      'The initial project snapshot includes incomplete tasks plus tasks completed since the date; it is not a strict task-created-after filter. Event cursors follow changes, with daily reconciliation.',
    limitations:
      'Large projects can need several cycles. Removed project membership, deletion and access loss are retained statuses; old Fulcra copies are not purged.'
  },
  github: {
    name: 'GitHub',
    credentialUrl:
      'https://github.com/settings/personal-access-tokens/new?name=Fulcra%20Connectors&metadata=read&issues=read&pull_requests=read',
    credentialLink: 'Create GitHub fine-grained token',
    additionalCredentialLinks: [
      { url: 'https://github.com/settings/apps/new', label: 'Create a GitHub App instead' },
      { url: 'https://github.com/settings/apps', label: 'Manage existing GitHub Apps' }
    ],
    setupUrl:
      'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
    setupLink: 'GitHub token setup instructions',
    credentialSteps: [
      'Open the fine-grained token creation form below. Choose the resource owner and Only select repositories, select the repositories to sync, then choose an expiration.',
      'Keep Metadata, Issues and Pull requests set to read-only, then Generate token and copy it. Organization approval may be required. For the App option, use the separate App links below, install it on selected repositories and generate a private key in its settings.'
    ],
    scopes:
      'Use selected repositories with read permissions. The App option needs your App ID, installation ID and private key; the app renews installation tokens.',
    sourceLabel: 'repositories',
    sourceHelp: 'Only the selected owner/repository IDs are collected.',
    output:
      'Issue and pull-request metadata plus issue comments, as structured v1 records and JSON document files. The selected source and original URL remain in the payload.',
    backfillHelp:
      'The date bounds initial updated issues and comments. Subsequent polls use update overlap and independent comment pagination.',
    limitations:
      'Repository files and PR review comments are outside this example. Polling cannot detect every historical deletion; signed webhook hints are optional.'
  },
  notion: {
    name: 'Notion',
    credentialUrl: 'https://app.notion.com/developers/connections',
    credentialLink: 'Open Notion connection console',
    setupUrl: 'https://developers.notion.com/guides/get-started/internal-connections',
    setupLink: 'Notion connection setup instructions',
    credentialSteps: [
      'Open the Notion connection console below. In Build → Internal connections, choose Create a new connection, name it and select the workspace to import. You must be a workspace owner. If you already created one, open it instead.',
      'In Configuration → Capabilities, enable Read content. For one-way import, keep Update content and Insert content off. For optional two-way sync, also enable Update content and Insert content. Keep comment and agent access off and choose No user information.',
      'Open Content access → Edit access. Select the pages or databases to share, then Save. Sharing a parent grants access to its children. A new connection has no page access, even when its token verifies.',
      'Alternatively, open a page in Notion → ••• → Connections → Add connection, select your internal connection and confirm the page/child access.',
      'Return to Configuration and copy the API token. Paste it only in the protected Internal connection API token field below, name this connection, then Verify and continue. Never paste the token in chat or a page.',
      'In Sources, discover and select pages. For two-way sync, explicitly enable its checkbox and choose a selected creation parent; it creates editable Fulcra working files and can write changes back to Notion. If discovery is empty, allow search indexing, then Refresh sources. Review Destination, Schedule and preview before enabling.'
    ],
    scopes:
      'Read content on shared pages and children for one-way import. Optional two-way sync also requires Update content and Insert content on selected pages and the creation parent. Comment, user-information and agent access are not needed.',
    sourceLabel: 'root pages',
    sourceHelp:
      'Select page documents to import, including individual database entries returned by search. Each selected page includes its accessible nested blocks. Sharing a database does not automatically select its rows or future entries.',
    sourceTroubleshooting:
      'Token verification checks the connection identity, not page access. In the Notion connection console, open Content access → Edit access → select pages or databases → Save. Confirm the workspace and connection match this token. Allow search indexing to catch up, then Refresh sources here. Shared parents include their children, but you must select the page documents to import.',
    output:
      'Default one-way Notion → Fulcra; optional two-way page title/Markdown/archive sync uses editable working copies. One-way imports complete page/block documents as Markdown files and v1 records with normalized page content. Unsupported blocks are marked; external files remain links.',
    backfillHelp:
      'Notion imports the complete selected root and nested blocks; this is not a date filter. Roots are rescanned to find changes in older nested content.',
    limitations:
      'Database/data-source rows are not automatically expanded or added later; select individual page entries from discovery. Comments are not imported. One-way mode never writes back; optional two-way mode syncs page title, Markdown and recoverable archive/restore. Other database properties and comments are not mirrored. Each root is bounded to 5,000 blocks and 2 MB of traversal state; choose smaller roots when needed.'
  },
  slack: {
    name: 'Slack',
    credentialUrl: 'https://api.slack.com/apps',
    credentialLink: 'Open Slack app and token settings',
    setupUrl: 'https://docs.slack.dev/authentication/tokens/',
    setupLink: 'Slack token setup instructions',
    credentialSteps: [
      'Open Slack app settings below and create an app or select an existing one. Open OAuth & Permissions and add the read scopes listed below for the channel types you need.',
      'Choose Install to Workspace (or Reinstall after changing scopes), approve the scopes, then copy the Bot User OAuth Token or the user OAuth token issued for your selection. Paste it below. Invite the app to the selected channels when using a bot token.'
    ],
    scopes:
      'Public channels: channels:read and channels:history. For private channels add groups:read and groups:history. Use a bot or user token permitted to read history and replies in your workspace; app-level/configuration tokens cannot substitute. No message-send permission is needed.',
    sourceLabel: 'channels',
    sourceHelp:
      'This picker offers member channels only: the token’s user or bot must be a member of each selected channel. History and thread pagination are handled independently.',
    output:
      'Selected messages and threads as v1 records and Markdown artifacts, using exact Slack timestamps for identity. This example does not download files.',
    backfillHelp:
      'The date bounds initial message history. Large history/thread backfills can need many cycles; smaller windows reduce backlog.',
    limitations:
      'Polling alone cannot guarantee old edits, deletions or replies to old threads. Signed events are needed for those updates. Rate limits may make the effective cadence much slower than your selected interval.'
  }
};
/** @param {string} connector */
export function getConnectorSetup(connector) {
  if (!Object.hasOwn(providers, connector)) throw Error('Unsupported connector');
  return providers[connector];
}
/** Defaults are proposals until saved; existing configurations retain their exact values.
 * @param {string} connector @param {any} config @param {number} now */
export function setupDefaults(connector, config = {}, now = Date.now()) {
  getConnectorSetup(connector);
  return {
    mode: config.route?.mode ?? 'file',
    folder: config.route?.folder ?? `/connectors/${connector}`,
    recordType: config.route?.recordType ?? '',
    intervalSeconds: config.intervalSeconds ?? 300,
    backfillSince: config.backfillSince ?? new Date(now - 7 * 86400000).toISOString()
  };
}
/** @param {number} seconds */
export function describeInterval(seconds) {
  if (seconds === 60) return 'Every minute';
  if (seconds % 3600 === 0) return `Every ${seconds / 3600} hours`;
  if (seconds % 60 === 0) return `Every ${seconds / 60} minutes`;
  return `Every ${seconds} seconds`;
}
/** @param {{mode:string,folder?:string,recordType?:string}} route */
export function describeDestination(route) {
  const files = `Files → ${route.folder || 'choose a folder'}`;
  const records = route.recordType ? `v1 records → ${route.recordType}` : 'Choose a v1 data type';
  return route.mode === 'file'
    ? files
    : route.mode === 'record'
      ? records
      : `${files} · ${records}`;
}
