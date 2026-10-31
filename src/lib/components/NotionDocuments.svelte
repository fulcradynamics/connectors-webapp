<script lang="ts">
  import { onMount } from 'svelte';
  import { connectorRequest } from '$lib/client/connector-api.js';
  let { connectionId, active = false }: { connectionId: string; active?: boolean } = $props();
  let listing = $state<any>(null),
    opened = $state<any>(null),
    versions = $state<any>(null);
  let title = $state(''),
    markdown = $state(''),
    archived = $state(false);
  let busy = $state(false),
    dirty = $state(false),
    creating = $state(false),
    queued = $state(false);
  let message = $state('');
  const endpoint = $derived(`/api/connections/${connectionId}/documents`);
  async function api(query = '', body?: any) {
    return connectorRequest(
      endpoint + query,
      body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          }
        : {}
    );
  }
  async function act(fn: () => Promise<void>) {
    busy = true;
    message = '';
    try {
      await fn();
    } catch (e) {
      message = e instanceof Error ? e.message : 'Action could not finish';
    } finally {
      busy = false;
    }
  }
  async function refresh() {
    await act(async () => {
      listing = await api();
    });
  }
  async function open(id: string) {
    if (dirty) {
      message = 'Save or cancel your current edit before opening another page.';
      return;
    }
    await act(async () => {
      const result = await api('?document=' + encodeURIComponent(id));
      opened = result;
      title = result.document.title;
      markdown = result.document.markdown;
      archived = result.document.archived;
      creating = false;
      queued = result.queued;
      versions = null;
      if (result.conflict) {
        const [notion, fulcra] = await Promise.all(
          ['notion', 'fulcra'].map((view) =>
            api(`?document=${encodeURIComponent(id)}&view=${view}`)
          )
        );
        versions = { notion: notion.document, fulcra: fulcra.document };
      }
    });
  }
  async function save() {
    await act(async () => {
      const result = await api(
        '',
        creating
          ? { operation: 'create', document: { title, markdown, archived: false } }
          : {
              operation: 'save',
              id: opened.id,
              expectedRevision: opened.revision,
              document: { title, markdown, archived }
            }
      );
      dirty = false;
      creating = false;
      queued = true;
      opened = { ...(opened ?? {}), id: result.id, queued: true, revision: null };
      listing = await api();
      message =
        'Saved to the durable queue. Refresh the document after its working copy and Notion readback are verified.';
    });
  }
  async function archive() {
    await act(async () => {
      await api('', {
        operation: 'archive',
        id: opened.id,
        archived: !archived,
        expectedRevision: opened.revision
      });
      queued = true;
      listing = await api();
      message = archived ? 'Restore queued.' : 'Recoverable archive queued.';
    });
  }
  async function sync(id?: string) {
    await act(async () => {
      await api('', { operation: 'sync', ...(id ? { id } : {}) });
      listing = await api();
      message = 'Sync queued. Refresh status to see verified progress.';
    });
  }
  async function resolve(choice: string) {
    await act(async () => {
      await api('', {
        operation: 'resolve',
        id: opened.id,
        choice,
        conflictId: opened.conflict.id,
        expectedRevision: opened.revision,
        expectedNotion: opened.expectedNotion
      });
      queued = true;
      listing = await api();
      message =
        'Reviewed conflict resolution queued. Both services will be read back before it is marked synced.';
    });
  }
  function newPage() {
    opened = null;
    versions = null;
    title = '';
    markdown = '';
    archived = false;
    creating = true;
    dirty = false;
    queued = false;
    message = '';
  }
  onMount(refresh);
</script>

<section class="documents" aria-label="Two-way Notion documents">
  <h3>Two-way Notion pages</h3>
  <p>
    Edit either Notion or these Fulcra working copies. New pages are created under your selected
    creation parent. Archive and restore are recoverable; missing files and lost access do not
    delete Notion pages.
  </p>
  {#if !active}<p role="status">
      Collection is paused. Preview and enable this connection to apply edits.
    </p>{/if}
  <div class="actions">
    <button disabled={busy} onclick={refresh}>Refresh status</button>
    <button disabled={busy || !active} onclick={() => sync()}>Sync now</button>
    <button disabled={busy || dirty || !active} onclick={newPage}>New page</button>
  </div>
  {#if message}<p role="status">{message}</p>{/if}
  {#if listing}
    {#each listing.discoveryWarnings ?? [] as warning}<p role="status">{warning}</p>{/each}
    <p>Working copies: <code>{listing.folder}</code></p>
    <p>
      {listing.documents.length} mapped pages · {listing.queued} queued edits{listing.pending
        ? ` · Applying ${listing.pending.kind}`
        : ''}
    </p>
    <div class="document-list">
      {#each listing.documents as doc}
        <div class="document-row">
          <button disabled={busy || doc.status === 'unsupported'} onclick={() => open(doc.id)}
            >{doc.title}</button
          >
          <span>{doc.status}{doc.archived ? ' · archived' : ''}</span>
          {#if doc.notionId}<a
              href={`https://www.notion.so/${doc.notionId.replaceAll('-', '')}`}
              target="_blank"
              rel="noreferrer">Open in Notion ↗</a
            >{/if}
          {#if doc.error}<p>{doc.error}</p>{/if}
        </div>
      {/each}
    </div>
  {/if}
  {#if creating || opened}
    <div class="editor">
      <h4>{creating ? 'Create a page from Fulcra' : 'Edit Fulcra working copy'}</h4>
      {#if opened?.conflict}
        <p role="alert">
          Both sides changed. Review the retained versions and choose one to sync. Neither side wins
          automatically.
        </p>
        {#if versions}
          <div class="conflict-versions">
            <div>
              <h4>Notion version</h4>
              <strong>{versions.notion.title}</strong>
              <pre>{versions.notion.markdown}</pre>
              <p>{versions.notion.archived ? 'Archived' : 'Active'}</p>
            </div>
            <div>
              <h4>Fulcra version</h4>
              <strong>{versions.fulcra.title}</strong>
              <pre>{versions.fulcra.markdown}</pre>
              <p>{versions.fulcra.archived ? 'Archived' : 'Active'}</p>
            </div>
          </div>
          <div class="actions">
            <button disabled={busy || queued || !active} onclick={() => resolve('notion')}
              >Use Notion version</button
            ><button disabled={busy || queued || !active} onclick={() => resolve('fulcra')}
              >Use Fulcra version</button
            >
          </div>
        {/if}
      {:else}
        <label
          >Page title<input
            aria-label="Page title"
            bind:value={title}
            maxlength="200"
            disabled={busy || queued || !active}
            oninput={() => (dirty = true)}
          /></label
        >
        <label
          >Page Markdown<textarea
            aria-label="Page Markdown"
            bind:value={markdown}
            disabled={busy || queued || !active}
            oninput={() => (dirty = true)}
          ></textarea></label
        >
        <p>
          Notion-flavored Markdown. Up to 24 KiB per page. Current state: {archived
            ? 'archived'
            : 'active'}.
        </p>
        <div class="actions">
          <button
            class="primary"
            disabled={busy || queued || !active || !title.trim() || (!creating && !dirty)}
            onclick={save}>{creating ? 'Create and sync page' : 'Save and sync'}</button
          >
          {#if opened?.revision}<button
              disabled={busy || dirty || queued || !active}
              onclick={archive}>{archived ? 'Restore page' : 'Archive page'}</button
            >{/if}
        </div>
      {/if}
      {#if opened}<div class="actions">
          <button disabled={busy || dirty} onclick={() => open(opened.id)}>Reload document</button
          ><button disabled={busy || dirty || !active} onclick={() => sync(opened.id)}
            >Sync this page now</button
          >
        </div>{/if}
      {#if queued}<p role="status">
          This page has queued work. Reload it after verified syncing to edit again.
        </p>{/if}
      <button
        disabled={busy}
        onclick={() => {
          opened = null;
          creating = false;
          dirty = false;
          versions = null;
        }}>{dirty ? 'Discard unsaved edits' : 'Close editor'}</button
      >
    </div>
  {/if}
</section>

<style>
  .documents {
    margin-top: 24px;
    padding: 22px;
    border: 1px solid #394b60;
    border-radius: 12px;
    background: #141c28;
  }
  h3,
  h4,
  strong {
    color: #eff4fa;
  }
  h3 {
    font-size: 19px;
  }
  h4 {
    margin: 12px 0;
  }
  p {
    color: #b4c0d0;
    font-size: 13px;
    line-height: 1.65;
    margin: 12px 0;
  }
  code {
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 12px 0;
  }
  button {
    color: #e0e8f0;
    border: 1px solid #43516b;
    background: #202b3c;
    padding: 10px 14px;
    border-radius: 7px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  button.primary {
    background: #90e4c9;
    color: #10231e;
    font-weight: 600;
  }
  .document-list {
    max-height: 360px;
    overflow-y: auto;
    margin: 16px 0;
  }
  .document-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    border-bottom: 1px solid #303c4f;
    padding: 10px 0;
  }
  .document-row button {
    flex: 1;
    min-width: 170px;
    text-align: left;
  }
  .document-row span,
  a {
    color: #aabbd0;
    font-size: 12px;
  }
  .editor {
    margin-top: 22px;
    border-top: 1px solid #3a4960;
    padding-top: 14px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: #d8e2ef;
    font-size: 13px;
    margin: 14px 0;
  }
  input,
  textarea {
    width: 100%;
    box-sizing: border-box;
    background: #0f1723;
    border: 1px solid #43516b;
    border-radius: 7px;
    color: #e5edf5;
    padding: 12px;
  }
  textarea {
    min-height: 230px;
    font-family: monospace;
    line-height: 1.5;
  }
  .conflict-versions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
  }
  pre {
    background: #0f1723;
    padding: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 300px;
    overflow-y: auto;
    color: #c8d6e7;
    font-size: 12px;
  }
</style>
