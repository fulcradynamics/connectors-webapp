<script lang="ts">
  import { connectorRequest } from '$lib/client/connector-api.js';
  import CredentialLinks from './CredentialLinks.svelte';
  import { untrack } from 'svelte';
  import {
    getConnectorSetup,
    setupDefaults,
    describeInterval,
    describeDestination
  } from '$lib/connectors/setup.js';
  let {
    connector,
    existing = null,
    oncreated,
    oncancel
  }: {
    connector: string;
    existing?: any;
    oncreated: (connection: any) => void;
    oncancel: () => void;
  } = $props();
  const info = $derived(getConnectorSetup(connector));
  const defaults = $derived(setupDefaults(connector, existing?.config));
  let label = $state(
    untrack(() => existing?.label ?? connector[0].toUpperCase() + connector.slice(1))
  );
  let token = $state('');
  let accountId = $state(untrack(() => existing?.account_id ?? ''));
  let workspaceId = $state('');
  let webhookSecret = $state('');
  let kind = $state('token');
  let appId = $state('');
  let installationId = $state('');
  let privateKey = $state('');
  let busy = $state(false);
  let message = $state('');
  async function enroll() {
    busy = true;
    message = '';
    try {
      const credential =
        kind === 'github_app'
          ? { kind, appId, installationId, privateKey, webhookSecret }
          : { token, accountId, workspaceId, webhookSecret };
      const result = await connectorRequest(
        existing ? `/api/connections/${existing.id}/credentials` : '/api/connections',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connector, label, credential })
        }
      );
      token = '';
      privateKey = '';
      webhookSecret = '';
      oncreated(result.connection ?? existing);
    } catch (error) {
      message = error instanceof Error ? error.message : 'Enrollment failed';
    } finally {
      busy = false;
    }
  }
</script>

<form
  class="panel"
  onsubmit={(event) => {
    event.preventDefault();
    enroll();
  }}
>
  <div class="title">
    <h2>{existing ? 'Replace credentials for' : 'Connect'} {connector}</h2>
    <button type="button" onclick={oncancel}>Cancel</button>
  </div>
  <p class="eyebrow">Step 2 of 6 · Connect {info.name}</p>
  <section class="instructions" aria-label={`${info.name} credential instructions`}>
    <h3>Get your {info.name} credential</h3>
    <ol>
      {#each info.credentialSteps as instruction}<li>{instruction}</li>{/each}
    </ol>
    <CredentialLinks {info} />
    <p><strong>Permissions:</strong> {info.scopes}</p>
  </section>
  <p>
    Enter the secret here. It is encrypted for your deployment and is never shown in the settings
    summary. Verification does not start importing.
  </p>
  <label>Connection name<input bind:value={label} maxlength="100" required /></label>
  {#if connector === 'github'}<label
      >Authentication<select bind:value={kind}
        ><option value="token">Read-only fine-grained token</option><option value="github_app"
          >GitHub App installation</option
        ></select
      ></label
    >{/if}
  {#if kind === 'github_app'}<div class="fields">
      <label>App ID<input bind:value={appId} required /></label><label
        >Installation ID<input bind:value={installationId} required /></label
      >
    </div>
    <label
      >Private key<textarea bind:value={privateKey} required autocomplete="off" spellcheck="false"
      ></textarea></label
    >{:else}<label
      >{connector === 'garmin'
        ? 'Garmin Personal API key'
        : connector === 'notion'
          ? 'Internal connection API token'
          : connector === 'attio'
            ? 'Attio workspace access token'
            : 'Read token / API key'}<input
        type="password"
        bind:value={token}
        required
        autocomplete="off"
      /></label
    >{/if}
  {#if connector === 'granola'}<label
      >Stable source account ID<input
        bind:value={accountId}
        placeholder="Your workspace or account identifier"
        required
      /></label
    >
    <p>{info.accountHint}</p>{/if}
  {#if connector === 'asana'}<label>Workspace ID<input bind:value={workspaceId} required /></label
    >{/if}
  {#if ['granola', 'slack', 'github'].includes(connector)}<label
      >Webhook signing secret <small>optional</small><input
        type="password"
        bind:value={webhookSecret}
        autocomplete="off"
      /></label
    >{/if}
  {#if connector === 'slack'}<p class="notice">
      Polling alone cannot guarantee old edits or deletions. Use signed events for those updates.
      Channel threads may require a user read token.
    </p>{/if}
  <aside class="instructions">
    <h3>What happens next</h3>
    <p>
      Choose {info.sourceLabel}, a Fulcra destination, and your schedule; then inspect a preview and
      enable explicitly.
    </p>
    {#if existing}<p>
        <strong>Retained settings:</strong>
        {describeInterval(defaults.intervalSeconds)} · {describeDestination(defaults)} · {existing
          .config.resources?.length ?? 0} selected {info.sourceLabel} · starting date {defaults.backfillSince.slice(
          0,
          10
        )}.
      </p>
      <p>
        Current status: {existing.status}. Successful credential replacement pauses collection and
        keeps your source, destination and schedule settings. Review a fresh preview and enable
        again to resume.
      </p>
    {:else}<p>
        <strong>Proposed base settings:</strong>
        {describeInterval(defaults.intervalSeconds)}, a {connector === 'attio' ? 30 : 7}-day
        starting date, and files in
        <code>{defaults.folder}</code>. Nothing is selected or collecting yet. Change these in the
        next steps.
      </p>{/if}
    <p><strong>What this imports:</strong> {info.output}</p>
    <p><strong>Provider behavior:</strong> {info.backfillHelp} {info.limitations}</p>
  </aside>
  {#if message}<p role="alert" class="error">{message}</p>{/if}<button
    class="primary"
    type="submit"
    disabled={busy}>{busy ? 'Verifying account…' : 'Verify and continue →'}</button
  ><a href={`/guides/providers/${connector}.md`} target="_blank" rel="noreferrer"
    >Provider setup guide ↗</a
  >
</form>

<style>
  .panel {
    border: 1px solid #39414e;
    background: #1a202b;
    padding: 26px;
    border-radius: 14px;
    margin-top: 24px;
  }
  .instructions {
    margin: 18px 0;
    padding: 18px;
    border: 1px solid #394b60;
    border-radius: 10px;
    background: #141c28;
  }
  .instructions h3 {
    font-size: 15px;
    color: #eff4fa;
  }
  .instructions ol {
    list-style: decimal;
    padding-left: 20px;
    font-size: 13px;
    color: #c0cad8;
    line-height: 1.7;
  }
  .instructions li {
    margin: 10px 0;
  }
  .instructions p {
    margin-bottom: 8px;
  }
  .instructions code {
    overflow-wrap: anywhere;
  }
  .eyebrow {
    font-size: 12px;
    color: #90e4c9;
  }
  .title {
    display: flex;
    justify-content: space-between;
  }
  h2 {
    font-size: 22px;
  }
  .title button {
    color: #9daab8;
  }
  p {
    color: #9daab8;
    font-size: 14px;
    line-height: 1.6;
    margin: 12px 0 22px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
    margin: 18px 0;
    color: #c0cad8;
  }
  input,
  select,
  textarea {
    background: #111722;
    border: 1px solid #3c4656;
    color: #eff4fa;
    border-radius: 8px;
    padding: 11px;
  }
  textarea {
    min-height: 110px;
  }
  .fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
  }
  .primary {
    padding: 12px 18px;
    background: #90e4c9;
    color: #10231e;
    border-radius: 8px;
    font-weight: 600;
    margin: 12px 18px 0 0;
    cursor: pointer;
  }
  a {
    font-size: 12px;
    color: #9daab8;
  }
  .notice {
    font-size: 12px;
    color: #e4c48a;
  }
  .error {
    color: #ffaeae;
  }
  small {
    color: #8994a5;
  }
</style>
