<script lang="ts">
  import { mergeDiscoveredSources } from '$lib/client/source-options.js';
  import { connectorRequest } from '$lib/client/connector-api.js';
  import CredentialLinks from './CredentialLinks.svelte';
  import { onMount, untrack } from 'svelte';
  import ConnectionForm from './ConnectionForm.svelte';
  import NotionDocuments from './NotionDocuments.svelte';
  import { supportedType } from '$lib/attio-documents.js';
  import AttioDocuments from './AttioDocuments.svelte';
  import {
    getSourceLimit,
    getConnectorSetup,
    setupDefaults,
    describeDestination,
    describeInterval
  } from '$lib/connectors/setup.js';
  let {
    connection,
    backgroundReady = false,
    onclose,
    onchanged
  }: {
    connection: any;
    backgroundReady?: boolean;
    onclose: () => void;
    onchanged: () => void;
  } = $props();
  // Saved chooser rows are reactive proxies; capture plain configuration before
  // copying editable field selections into this connection's local setup state.
  const initial = untrack(() => ({
    config: $state.snapshot(connection.config),
    connector: connection.connector
  }));
  const info = untrack(() => getConnectorSetup(initial.connector));
  const defaults = untrack(() => setupDefaults(initial.connector, initial.config));
  const stages = ['Sources', 'Destination', 'Schedule', 'Review'];
  const sourceLimit = getSourceLimit(initial.connector);
  const isAttio = initial.connector === 'attio';
  let step = $state(0);
  let resources = $state<any[]>([]);
  let twoWayEnabled = $state(initial.connector === 'notion' && !!initial.config.twoWay?.enabled);
  let attioTwoWay = $state(!!initial.config.attio?.twoWay);
  let includeNotes = $state(!!initial.config.attio?.includeNotes);
  let writableAttributes = $state<Record<string, string[]>>(
    structuredClone(initial.config.attio?.writableAttributes ?? {})
  );
  let schemas = $state<Record<string, any[]>>({});
  let twoWayParent = $state(initial.config.twoWay?.parentId ?? '');
  let cursor = $state<string | null>(null);
  let selected = $state<string[]>(initial.config.resources ?? []);
  let mode = $state(defaults.mode);
  let folder = $state(defaults.folder);
  let recordType = $state(defaults.recordType);
  let types = $state<any[]>([]);
  let interval = $state(defaults.intervalSeconds);
  let since = $state(defaults.backfillSince.slice(0, 10));
  let status = $state<any>(null);
  let preview = $state<any>(null);
  let confirmed = $state(false);
  let busy = $state(false);
  let message = $state('');
  let loaded = $state(false);
  let replacing = $state(false);
  let creatingType = $state(false);
  let typeName = $state('');
  let typeDescription = $state('');
  const sourceChoices = $derived([
    ...resources,
    ...selected
      .filter((id) => !resources.some((resource) => resource.id === id))
      .map((id) => ({ id, name: id, undiscovered: true }))
  ]);
  const sourcesReady = $derived(
    selected.length > 0 &&
      selected.length <= sourceLimit &&
      (!twoWayEnabled || selected.includes(twoWayParent))
  );
  const destinationReady = $derived(
    (mode === 'record' || !!folder.trim()) &&
      (mode === 'file' || !!recordType) &&
      (!attioTwoWay || mode !== 'record')
  );
  const destinationSummary = $derived(describeDestination({ mode, folder, recordType }));
  function invalidate() {
    preview = null;
    confirmed = false;
  }
  async function api(path: string, method = 'GET', body?: any) {
    const result = await connectorRequest(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return result;
  }
  async function action(fn: () => Promise<void>) {
    busy = true;
    message = '';
    try {
      await fn();
    } catch (error) {
      message = error instanceof Error ? error.message : 'Request failed';
    } finally {
      busy = false;
    }
  }
  async function discover() {
    await action(async () => {
      const result = await api(
        `/api/connections/${connection.id}/resources${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`
      );
      resources = mergeDiscoveredSources(resources, result.resources, !!cursor);
      cursor = result.nextCursor;
      loaded = true;
    });
  }
  async function load() {
    await action(async () => {
      const result = await api(`/api/connections/${connection.id}`);
      connection = result.connection;
      status = result.status;
      const destinations = await api('/api/destinations/types');
      types = destinations.types;
    });
  }
  onMount(() => {
    load();
  });
  function select(id: string, checked: boolean) {
    selected = checked ? [...selected, id] : selected.filter((x) => x !== id);
    preview = null;
    confirmed = false;
  }
  const selectedObjects = $derived([...new Set(selected.map((id) => id.split(':')[0]))]);
  const editableAttribute = (attribute: any) =>
    attribute.writable &&
    supportedType(attribute.type) &&
    (!attribute.multiple ||
      ['select', 'record-reference', 'email-address', 'domain'].includes(attribute.type));
  async function loadSchema(objectId: string) {
    await action(async () => {
      const id = selected.find((id) => id.startsWith(objectId + ':'));
      if (!id) return;
      const result = await api(
        `/api/connections/${connection.id}/documents?schema=${encodeURIComponent(id)}`
      );
      schemas[objectId] = result.attributes;
    });
  }
  function selectAttribute(objectId: string, id: string, checked: boolean) {
    const current = writableAttributes[objectId] ?? [];
    writableAttributes[objectId] = checked
      ? [...new Set([...current, id])]
      : current.filter((value) => value !== id);
    invalidate();
  }
  async function saveAndPreview() {
    await action(async () => {
      const result = await api(`/api/connections/${connection.id}`, 'PUT', {
        resources: selected,
        ...(isAttio
          ? {
              attio: {
                twoWay: attioTwoWay,
                includeNotes,
                writableAttributes: attioTwoWay
                  ? Object.fromEntries(
                      selectedObjects.map((id) => [id, writableAttributes[id] ?? []])
                    )
                  : {}
              }
            }
          : { twoWay: twoWayEnabled ? { enabled: true, parentId: twoWayParent } : null }),
        backfillSince: new Date(since + 'T00:00:00Z').toISOString(),
        intervalSeconds: Number(interval),
        route: { mode, folder, recordType }
      });
      connection = result.connection;
      preview = await api('/api/preview', 'POST', { connectionId: connection.id });
      confirmed = false;
      step = 3;
      onchanged();
    });
  }
  async function change(actionName: string) {
    await action(async () => {
      await api(`/api/connections/${connection.id}/action`, 'POST', {
        action: actionName,
        confirmed
      });
      if (actionName === 'pause' || actionName === 'disconnect') {
        preview = null;
        confirmed = false;
      }
      await load();
      onchanged();
    });
  }
  const display = (value: string | null) =>
    value ? new Date(value).toLocaleString() : 'No verified activity yet';
</script>

<section class="detail">
  <div class="title">
    <div>
      <p class="eyebrow">{connection.connector} · {connection.account_id}</p>
      <h2>{connection.label}</h2>
    </div>
    <div class="detail-actions">
      <button class="secondary" onclick={onclose}>Back to all connectors</button>
      <button class="primary" onclick={onclose}>Add connection</button>
    </div>
  </div>
  <div class="stats">
    <div>
      <small>Status</small><strong
        >{status?.credential_status === 'reauthorize' ? 'Reauthorize' : connection.status}</strong
      >
    </div>
    <div><small>Last attempt</small><span>{display(status?.last_attempt)}</span></div>
    <div><small>Last verified sync</small><span>{display(status?.last_verified_sync)}</span></div>
    <div>
      <small>Queued jobs / failed artifacts</small><span
        >{status?.backlog ?? 0} / {status?.failed_items ?? 0}</span
      >
    </div>
  </div>
  {#if status?.last_error}<p class="notice">
      Last result: {status.last_error}. A delivery receipt alone does not count as verified success.
    </p>{/if}
  {#if replacing}<ConnectionForm
      connector={connection.connector}
      existing={connection}
      oncancel={() => (replacing = false)}
      oncreated={() => {
        replacing = false;
        preview = null;
        load();
        onchanged();
      }}
    />{/if}
  <CredentialLinks {info} />
  <p>
    <a href={`/guides/providers/${connection.connector}.md`} target="_blank" rel="noreferrer"
      >Detailed provider reference ↗</a
    >
  </p>
  <aside class="configuration-summary" aria-label="Connection settings summary">
    <h3>
      {connection.config.resources?.length
        ? 'Saved connection and proposed edits'
        : 'Proposed base settings — not enabled'}
    </h3>
    {#if connection.config.resources?.length}<p>
        <strong>Saved:</strong>
        {describeDestination(connection.config.route)} · {describeInterval(
          connection.config.intervalSeconds
        )} · {connection.config.resources.length} selected {info.sourceLabel}.
      </p>{/if}
    <p>
      <strong>Current choices:</strong>
      {selected.length} selected {info.sourceLabel} · {destinationSummary} · {describeInterval(
        Number(interval)
      )} · initial date {since}.
    </p>
    <p>
      {connection.connector === 'notion' && connection.config.twoWay?.enabled
        ? 'Two-way Notion ↔ Fulcra: editable page titles, Markdown and recoverable archive/restore. Other Notion properties and comments are not mirrored.'
        : info.output}
    </p>
    {#if isAttio}<p>
        <strong>Current direction:</strong>
        {attioTwoWay ? 'Attio ↔ Fulcra for the approved fields' : 'Attio → Fulcra only'} · notes {includeNotes
          ? 'included from selected parents'
          : 'excluded'}.
      </p>{/if}
    <p>
      Configuration and preview do not import data. A connection must be enabled before writes
      begin.
    </p>
  </aside>
  <nav class="stage-nav" aria-label="Connection setup">
    {#each stages as stage, i}<button
        class:active={step === i}
        aria-current={step === i ? 'step' : undefined}
        disabled={busy ||
          (i > 0 && !sourcesReady) ||
          (i > 1 && !destinationReady) ||
          (i === 3 && !preview)}
        onclick={() => (step = i)}>{stage}</button
      >{/each}
  </nav>
  <div class="steps">
    <fieldset disabled={busy}>
      {#if step === 0}<section class="stage">
          <h3>3. Select {info.sourceLabel}</h3>
          <p>
            {info.sourceHelp} Only the IDs you select are collected. Discovery does not enable syncing.
            Choose up to {sourceLimit} per connection.
          </p>
          {#if connection.connector === 'notion'}
            <label class="choice"
              ><input
                type="checkbox"
                bind:checked={twoWayEnabled}
                onchange={() => {
                  if (twoWayEnabled) mode = 'file';
                  invalidate();
                }}
              /><span>Enable two-way Notion ↔ Fulcra sync</span></label
            >
            {#if twoWayEnabled}
              <p>
                Two-way sync can update, create, archive and restore Notion pages. In the Notion
                connection console → Configuration, enable Read content, Update content and Insert
                content. Keep comment, user and agent access off. Nothing writes until you preview
                and enable below.
              </p>
              <label
                >Creation parent page<select bind:value={twoWayParent} onchange={invalidate}
                  ><option value="">Choose a selected page</option>{#each selected as id}<option
                      value={id}>{resources.find((r) => r.id === id)?.name ?? id}</option
                    >{/each}</select
                ></label
              >
              <p>
                New pages created from Fulcra become children of this page; new Notion children here
                are discovered automatically. Editable working files go under the destination’s live
                folder for this connection. The parent, folder and initial selection are fixed once
                bound; use another connection for a different scope.
              </p>
            {/if}
          {/if}
          {#if isAttio}
            <label class="choice"
              ><input
                type="checkbox"
                bind:checked={attioTwoWay}
                onchange={() => {
                  if (attioTwoWay && mode === 'record') mode = 'file';
                  invalidate();
                }}
              /><span>Enable two-way Attio ↔ Fulcra sync</span></label
            >
            {#if attioTwoWay}
              <p>
                Only approved fields on the exact selected records can be written. Records, schema
                and lists are not created. Select up to 32 writable fields for each object.
                Unsupported and enriched fields stay read-only. Object, field, source and folder
                choices are fixed after binding; use another connection for a different scope.
              </p>
              {#each selectedObjects as objectId}
                <section class="new-type" aria-label={`Writable fields for object ${objectId}`}>
                  <h4>Object <code>{objectId}</code></h4>
                  <button class="secondary" onclick={() => loadSchema(objectId)}
                    >Load writable fields for this object</button
                  >
                  {#each schemas[objectId] ?? [] as attribute}
                    <label class="choice"
                      ><input
                        type="checkbox"
                        checked={(writableAttributes[objectId] ?? []).includes(attribute.id)}
                        disabled={!editableAttribute(attribute) ||
                          (!(writableAttributes[objectId] ?? []).includes(attribute.id) &&
                            (writableAttributes[objectId] ?? []).length >= 32)}
                        onchange={(event) =>
                          selectAttribute(objectId, attribute.id, event.currentTarget.checked)}
                      /><span
                        >{editableAttribute(attribute)
                          ? 'Allow '
                          : 'Read-only: '}{attribute.title}<small
                          >{attribute.type} · {attribute.id}</small
                        ></span
                      ></label
                    >
                  {/each}
                  {#if !schemas[objectId]}<p>
                      Load schema from a selected record to review fields before enabling any
                      writes.
                    </p>{/if}
                  <p>{(writableAttributes[objectId] ?? []).length} approved writable fields.</p>
                </section>
              {/each}

              <p>
                Notes are API text projections, not image/file backups. Editing publishes a new
                linked note revision on the same record; the original rich note stays intact. Notes
                use your chosen initial history window, proposed at 30 days. No note writes occur
                until you preview and enable.
              </p>
            {/if}
            <label class="choice"
              ><input type="checkbox" bind:checked={includeNotes} onchange={invalidate} /><span
                >Include notes from selected records</span
              ></label
            >
            {#if !attioTwoWay}<p>
                One-way mode imports optional API text projections from these selected parents. It
                never publishes note revisions or field edits.
              </p>{/if}
          {/if}
          <button class="secondary" disabled={busy} onclick={discover}
            >{loaded
              ? cursor
                ? 'Load more sources'
                : 'Refresh sources'
              : `Discover available ${info.sourceLabel}`}</button
          >
          <div class="resources">
            {#each sourceChoices as resource}<label class="choice"
                ><input
                  type="checkbox"
                  checked={selected.includes(resource.id)}
                  onchange={(event) => select(resource.id, event.currentTarget.checked)}
                /><span
                  >{resource.name}<small>{resource.id}</small>{#if resource.undiscovered}<small
                      >Not in current discovery; uncheck to remove this saved selection.</small
                    >{/if}</span
                ></label
              >{/each}
          </div>
          {#if loaded && !resources.length}<p>
              No accessible {info.sourceLabel} were returned. Check the credential permissions and provider
              sharing settings.
            </p>{/if}
          {#if loaded && !resources.length && info.sourceTroubleshooting}<p>
              {info.sourceTroubleshooting}
            </p>{/if}
          {#if selected.length > sourceLimit}<p role="alert" class="error">
              Select at most {sourceLimit} sources per connection.
            </p>{/if}
          {#if selected.length && !resources.length}<p>
              Saved selections remain removable. Rediscover to verify access before saving.
            </p>{/if}
          <button class="primary" disabled={busy || !sourcesReady} onclick={() => (step = 1)}
            >Continue to destination</button
          >
        </section>{:else if step === 1}<section class="stage">
          <h3>4. Choose where this writes in your Fulcra</h3>
          <p>
            The base configuration writes files to <code>/connectors/{connection.connector}</code>.
            Change the path or select records below. Destinations are configured independently for
            each connection.
          </p>
          <label
            >Write format<select bind:value={mode} disabled={twoWayEnabled} onchange={invalidate}
              ><option value="file">Files in a folder</option><option
                value="record"
                disabled={attioTwoWay}>v1 records</option
              ><option value="both">Files + v1 records</option></select
            ></label
          >
          {#if mode !== 'record'}<label
              >Folder path<input
                bind:value={folder}
                placeholder="/connectors/example"
                oninput={invalidate}
              /></label
            >
            <p>
              {#if twoWayEnabled}
                Editable working copies go under <code
                  >{folder || '/your-folder'}/live/{connection.id}/page-id.md</code
                >. Edit the title, Markdown or archived field there, or use the editor below.
                Earlier versions are retained.
              {:else if attioTwoWay}
                Typed working copies and a paginated agent index go under <code
                  >{folder || '/your-folder'}/live/{connection.id}/</code
                >. Edit only approved values or the linked-note revision draft. Verified snapshots
                and conflicts are retained.
              {:else}
                Files go under this path, grouped by stable source revision. For example <code
                  >{folder || '/your-folder'}/revision-id/document</code
                >. Existing history is retained.
              {/if}
            </p>{/if}
          {#if mode !== 'file'}<label
              >Recordable v1 data type<select bind:value={recordType} onchange={invalidate}
                ><option value="">Choose a data type</option>{#each types as type}<option
                    value={type.id}>{type.name ?? type.id} — {type.id}</option
                  >{/each}</select
              ></label
            >
            <button
              class="text-button"
              type="button"
              onclick={() => (creatingType = !creatingType)}
              aria-expanded={creatingType}>+ Create new v1 data type…</button
            >
            {#if creatingType}
              <div class="new-type" aria-label="Create a named v1 data type">
                <label
                  >Data type name<input
                    bind:value={typeName}
                    maxlength="100"
                    placeholder="Project updates"
                  /></label
                >
                <label
                  >Description (optional)<input
                    bind:value={typeDescription}
                    maxlength="1000"
                  /></label
                >
                <p>
                  Creates an owned, recordable/queryable v1 Event type with the connector schema. It
                  is selected here; save and preview to change this connection’s destination.
                </p>
                <button
                  class="secondary"
                  type="button"
                  disabled={!typeName.trim() || busy}
                  onclick={() =>
                    action(async () => {
                      const result = await api('/api/destinations/types', 'POST', {
                        name: typeName.trim(),
                        description: typeDescription.trim()
                      });
                      types = [
                        ...types.filter((type) => type.id !== result.type.id),
                        { ...result.type, name: result.type.name || typeName.trim() }
                      ];
                      recordType = result.type.id;
                      creatingType = false;
                      typeName = '';
                      typeDescription = '';
                      invalidate();
                    })}>Create v1 data type</button
                >
                <button class="text-button" type="button" onclick={() => (creatingType = false)}
                  >Cancel new data type</button
                >
              </div>
            {/if}
            <button
              class="text-button"
              disabled={busy}
              onclick={() =>
                action(async () => {
                  const result = await api('/api/destinations/types', 'POST');
                  recordType = result.type.id;
                  types = (await api('/api/destinations/types')).types;
                  invalidate();
                })}>Create or reuse connector record type</button
            >
            <p>
              Choose an existing compatible type, create one with your own name, or create/reuse the
              standard <strong>Connector records</strong>
              Event type. No type is silently selected or created. Selected type:
              <code>{recordType || 'none'}</code>.
            </p>
            <details>
              <summary>Record fields and custom data types</summary>
              <p>
                All examples use the same v1 envelope: source timestamps, <code>connector</code>,
                <code>source_id</code>, <code>source_version</code>, <code>operation</code>, and
                <code>payload</code>. The payload contains this provider’s data: {info.output}
              </p>
              <p>
                A custom type must be owned by you, recordable/queryable v1, declare a <code
                  >payload</code
                > object and accept the complete output. Preview shows the exact records; saving checks
                the destination and schema structure; preview validates the sample records before collection
                can be enabled. If the schema rejects the sample, return to Destination and choose a compatible
                type. An arbitrary schema needs a mapper change in your fork; there is no field-mapping
                editor here.
              </p>
            </details>
          {/if}
          <p>
            These are your owner destinations. Sharing imported data is managed separately in
            Fulcra.
          </p>
          <button class="secondary" disabled={busy} onclick={() => (step = 0)}
            >Back to sources</button
          >
          <button class="primary" disabled={busy || !destinationReady} onclick={() => (step = 2)}
            >Continue to schedule</button
          >
        </section>{:else if step === 2}<section class="stage">
          <h3>5. Configure this connection’s schedule</h3>
          <p>
            <strong>{describeInterval(Number(interval))}</strong>, for this connection only. The
            base interval is 5 minutes; allowed values are 60 seconds to 24 hours. Other connections
            can use different schedules.
          </p>
          <label
            >Polling interval (seconds)<input
              type="number"
              min="60"
              max="86400"
              step="1"
              bind:value={interval}
              oninput={invalidate}
            /></label
          >
          <p>
            After a completed poll cycle the app waits this interval. Initial backfills and
            paginated continuations can run sooner; throttling, retries and backlog can make actual
            updates arrive later. This is not a guarantee of real-time updates.
          </p>
          <label>Backfill begins<input type="date" bind:value={since} oninput={invalidate} /></label
          >
          <p><strong>How {info.name} uses this date:</strong> {info.backfillHelp}</p>
          <p><strong>Provider limits:</strong> {info.limitations}</p>
          <button class="secondary" disabled={busy} onclick={() => (step = 1)}
            >Back to destination</button
          >
          <button
            class="primary"
            disabled={busy ||
              !sourcesReady ||
              !destinationReady ||
              Number(interval) < 60 ||
              Number(interval) > 86400 ||
              !Number.isInteger(Number(interval)) ||
              !since}
            onclick={saveAndPreview}>{busy ? 'Working…' : 'Save and preview output'}</button
          >
        </section>{:else if step === 3 && preview}<section class="preview stage">
          <h3>6. Review and enable</h3>
          <p>
            <strong>Destination:</strong>
            {destinationSummary}. <strong>Schedule:</strong>
            {describeInterval(Number(interval))}.
          </p>
          <p>
            No destination writes were performed. {preview.complete
              ? 'This is a bounded sample.'
              : (preview.detail ?? 'Provider retry required; go back and preview again.')}
          </p>
          {#if preview.complete && preview.detail}<p>{preview.detail}</p>{/if}
          {#if preview.complete && !preview.outputs?.length}<p>
              No matching items were returned for this sample. Enabling will watch the selected
              sources for future changes.
            </p>{/if}
          <pre>{JSON.stringify(preview.outputs, null, 2).slice(0, 24000)}</pre>
          {#if preview.complete && connection.status === 'ready'}<p role="status" class="notice">
              Automatic collection is enabled for these saved settings. Check the last verified sync
              above; Pause stops future collection.
            </p>
          {:else if preview.complete}
            {#if !backgroundReady}<p class="notice">
                <a href="#background-access">Allow app-wide automatic sync above</a> before enabling.
                This is shared by every connector; provider verification alone does not authorize Fulcra
                writes.
              </p>{/if}
            <label class="choice"
              ><input type="checkbox" bind:checked={confirmed} /><span
                >I reviewed these sources, destination, backfill and interval.</span
              ></label
            >
            <button
              class="primary"
              disabled={busy || !confirmed || !backgroundReady}
              onclick={() => change('enable')}>Enable background collection</button
            >
          {/if}
          <button class="secondary" disabled={busy} onclick={() => (step = 2)}
            >Back to schedule</button
          >
        </section>{/if}
    </fieldset>
  </div>
  {#if message}<p role="alert" class="error">{message}</p>{/if}
  {#if connection.connector === 'notion' && connection.config.twoWay?.enabled}<NotionDocuments
      connectionId={connection.id}
      active={connection.status === 'ready'}
    />{/if}
  {#if connection.connector === 'attio' && connection.config.attio?.twoWay}<AttioDocuments
      connectionId={connection.id}
      active={connection.status === 'ready'}
      approvedResources={connection.config.resources ?? []}
    />{/if}
  <div class="actions">
    <button class="secondary" disabled={busy} onclick={() => (replacing = true)}
      >Replace credential</button
    ><button class="secondary" disabled={busy} onclick={() => change('pause')}>Pause</button><button
      class="secondary"
      disabled={busy || connection.status !== 'ready'}
      onclick={() => change('retry')}>Retry queued work</button
    ><button class="danger" disabled={busy} onclick={() => change('disconnect')}
      >Disconnect and remove local credential</button
    >
  </div>
  <p class="foot">
    Disconnect stops future collection. Revoke the provider token in its own service if needed.
    Existing imports remain in Fulcra.
  </p>
</section>

<style>
  .detail-actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .new-type {
    padding: 14px;
    border: 1px solid #3c4656;
    border-radius: 8px;
    margin: 10px 0;
  }
  .detail {
    padding: 28px;
    border: 1px solid #3c4656;
    border-radius: 16px;
    background: #181f2b;
    margin: 26px 0;
  }
  .title {
    display: flex;
    justify-content: space-between;
    gap: 16px;
  }
  h2 {
    font-size: 26px;
  }
  h3 {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 10px;
  }
  .eyebrow {
    font-size: 11px;
    color: #8fddc7;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 18px;
    margin: 25px 0;
    padding: 20px 0;
    border-block: 1px solid #333e4e;
  }
  .stats div {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .stats small {
    font-size: 11px;
    color: #94a3b6;
  }
  .stats span {
    font-size: 12px;
  }
  .stats strong {
    text-transform: capitalize;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    min-inline-size: 0;
  }
  .steps {
    margin: 28px 0;
  }
  .stage {
    max-width: 800px;
  }
  .stage-nav {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 24px 0;
  }
  .stage-nav button {
    border: 1px solid #48596f;
    border-radius: 8px;
    padding: 10px 16px;
    color: #bfd0e3;
    font-size: 13px;
  }
  .stage-nav .active {
    border-color: #91e5ca;
    color: #91e5ca;
  }
  .configuration-summary {
    padding: 18px;
    border: 1px solid #41546a;
    border-radius: 10px;
    background: #131d2a;
  }
  .configuration-summary p {
    margin-bottom: 6px;
  }
  a {
    color: #91e5ca;
    text-decoration: underline;
  }
  code {
    overflow-wrap: anywhere;
  }
  details {
    border: 1px solid #41546a;
    border-radius: 8px;
    padding: 14px;
    color: #b6c9dc;
    font-size: 12px;
    line-height: 1.7;
  }
  summary {
    cursor: pointer;
  }
  @media (max-width: 600px) {
    .detail {
      padding: 16px;
    }
    .stage-nav button {
      padding: 8px;
    }
  }
  p {
    font-size: 12px;
    line-height: 1.7;
    color: #93a3b6;
    margin: 10px 0 18px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: #c0ccdc;
    font-size: 12px;
    margin: 16px 0;
  }
  input:not([type='checkbox']),
  select {
    padding: 10px;
    border-radius: 7px;
    border: 1px solid #3a485b;
    background: #101722;
    color: #e5eef9;
    width: 100%;
  }
  .choice {
    display: flex;
    flex-direction: row;
    align-items: start;
    gap: 10px;
  }
  .choice small {
    display: block;
    font-size: 10px;
    color: #7d91a8;
    word-break: break-all;
  }
  .resources {
    max-height: 260px;
    overflow: auto;
  }
  .primary {
    padding: 12px 17px;
    border-radius: 8px;
    background: #91e5ca;
    color: #10291f;
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
  }
  .secondary {
    padding: 9px 13px;
    border: 1px solid #4b5a6e;
    border-radius: 7px;
    font-size: 12px;
    color: #c2d0e1;
    cursor: pointer;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 30px;
  }
  .danger {
    font-size: 12px;
    color: #e9a4a7;
  }
  .text-button {
    font-size: 12px;
    color: #8bd9c1;
    text-decoration: underline;
  }
  .notice {
    color: #dfc18d;
  }
  .error {
    color: #ffa6a6;
  }
  .preview {
    margin-top: 28px;
    border-top: 1px solid #354258;
    padding-top: 24px;
  }
  pre {
    padding: 18px;
    background: #0e151f;
    color: #aabbd0;
    border-radius: 8px;
    font-size: 11px;
    max-height: 350px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .foot {
    font-size: 11px;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
