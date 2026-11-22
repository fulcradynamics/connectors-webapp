<script lang="ts">
  import { onMount } from 'svelte';
  import { validateEdit } from '$lib/attio-documents.js';
  import { connectorRequest } from '$lib/client/connector-api.js';
  let {
    connectionId,
    active = false,
    approvedResources = []
  }: {
    connectionId: string;
    active?: boolean;
    approvedResources?: string[];
  } = $props();
  let listing = $state<any>(null),
    opened = $state<any>(null),
    draft = $state<any>(null);
  let versions = $state<Record<string, { document?: any; error?: string }>>({});
  let busy = $state(false),
    dirty = $state(false),
    queued = $state(false),
    message = $state('');
  let fieldErrors = $state<Record<string, string>>({});
  const endpoint = $derived(`/api/connections/${connectionId}/documents`);
  const unavailable = $derived(
    !!opened?.workingReadUnavailable || !!opened?.providerReadUnavailable
  );
  const writeDisabled = $derived(busy || !active || queued || unavailable);
  const oversized = $derived(
    draft
      ? new TextEncoder().encode(JSON.stringify(draft)).length > 48 * 1024 ||
          (draft.kind === 'note' && new TextEncoder().encode(draft.text).length > 24 * 1024)
      : false
  );
  const validationError = $derived.by(() => {
    if (!draft || !opened) return '';
    try {
      validateEdit(opened.document, draft, approvedResources);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : 'Invalid draft';
    }
  });
  const invalid = $derived(oversized || Object.keys(fieldErrors).length > 0 || !!validationError);
  function sourceLink(value: unknown) {
    try {
      const url = new URL(String(value));
      return url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        (url.hostname === 'attio.com' || url.hostname.endsWith('.attio.com'))
        ? url.href
        : null;
    } catch {
      return null;
    }
  }
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
    } catch (error) {
      message =
        error instanceof Error
          ? error.message
          : 'Request could not finish. Your draft is retained.';
    } finally {
      busy = false;
    }
  }
  async function refresh(more = false) {
    await act(async () => {
      const result = await api(
        more && listing?.nextCursor ? '?cursor=' + encodeURIComponent(listing.nextCursor) : ''
      );
      listing = more
        ? {
            ...result,
            documents: [
              ...listing.documents,
              ...result.documents.filter(
                (doc: any) => !listing.documents.some((old: any) => old.id === doc.id)
              )
            ]
          }
        : result;
    });
  }
  async function open(id: string) {
    if (dirty) {
      message = 'Save or discard your unsaved edits before opening another document.';
      return;
    }
    await act(async () => {
      const result = await api('?document=' + encodeURIComponent(id));
      opened = result;
      draft = structuredClone(result.document);
      fieldErrors = {};
      dirty = false;
      queued = !!result.queued;
      versions = {};
      if (result.workingReadUnavailable)
        message =
          'The current working file could not be read safely. The accepted document is retained; writes stay disabled until a safe read is available.';
      else if (result.providerReadUnavailable)
        message =
          'The current Attio provider read is unavailable. The accepted document is retained; writes stay disabled until fresh provider evidence is available.';
      if (result.conflict) {
        const views = ['provider', 'fulcra', ...(result.interveningVersion ? ['working'] : [])];
        const results = await Promise.allSettled(
          views.map((view) => api(`?document=${encodeURIComponent(id)}&view=${view}`))
        );
        versions = Object.fromEntries(
          results.map((result, index) => [
            views[index],
            result.status === 'fulfilled'
              ? { document: result.value.document }
              : {
                  error:
                    result.reason instanceof Error ? result.reason.message : 'Evidence unavailable'
                }
          ])
        );
      }
    });
  }
  function close() {
    opened = null;
    draft = null;
    dirty = false;
    versions = {};
    fieldErrors = {};
    message = '';
  }
  function changeValue(attribute: any, index: number, value: string) {
    dirty = true;
    const values = [...draft.values[attribute.id]];
    if (attribute.type === 'number' || attribute.type === 'rating') {
      if (value === '') values.splice(index, 1);
      else if (!Number.isFinite(Number(value))) {
        fieldErrors[attribute.id] = 'Enter a finite number.';
        return;
      } else values[index] = Number(value);
    } else values[index] = value;
    delete fieldErrors[attribute.id];
    draft.values[attribute.id] = values;
  }
  function setValues(id: string, values: any[]) {
    draft.values[id] = values;
    delete fieldErrors[id];
    dirty = true;
  }
  function setOptions(attribute: any, element: HTMLSelectElement) {
    const ids = Array.from(element.selectedOptions, (option) => option.value).filter(Boolean);
    setValues(
      attribute.id,
      attribute.type === 'record-reference'
        ? ids.map((id) => {
            const [objectId, recordId] = id.split(':');
            return { objectId, recordId };
          })
        : ids
    );
  }
  function referenceChoices(attribute: any) {
    return approvedResources.filter((id) => attribute.targetObjectIds?.includes(id.split(':')[0]));
  }
  function selectedValues(attribute: any): string[] {
    return (draft.values[attribute.id] ?? []).map((value: any) =>
      attribute.type === 'record-reference' ? `${value.objectId}:${value.recordId}` : value
    );
  }
  async function save() {
    await act(async () => {
      await api('', {
        operation: 'save',
        id: opened.id,
        expectedRevision: opened.revision,
        document: validateEdit(opened.document, $state.snapshot(draft), approvedResources).document
      });
      dirty = false;
      queued = true;
      message =
        'Saved to the durable queue. Refresh after provider and Fulcra readback are verified.';
    });
  }
  async function sync(id?: string) {
    await act(async () => {
      await api('', { operation: 'sync', ...(id ? { id } : {}) });
      message = 'Sync queued. Refresh status for verified progress.';
    });
  }
  async function resolve(choice: string) {
    await act(async () => {
      await api('', {
        operation: 'resolve',
        id: opened.id,
        choice,
        expectedRevision: opened.revision,
        expectedProvider: opened.expectedProvider,
        conflictId: opened.conflict.id
      });
      queued = true;
      message =
        'Reviewed resolution queued. Provider and Fulcra readback must verify it before completion.';
    });
  }
  const choices = [
    { id: 'provider', title: 'Attio version', button: 'Use Attio version' },
    { id: 'fulcra', title: 'Accepted Fulcra version', button: 'Use accepted Fulcra version' },
    {
      id: 'working',
      title: 'Intervening working-file version',
      button: 'Use intervening working-file version'
    }
  ];
  onMount(() => refresh());
</script>

<section class="documents" aria-label="Two-way Attio documents">
  <h3>Two-way Attio records and linked notes</h3>
  <p>
    Edit approved typed fields on selected existing records. Note drafts publish linked revisions
    while preserving the original rich note. Records, schema, options and lists are not created or
    deleted.
  </p>
  {#if !active}<p role="status">Collection is paused. Preview and enable to apply edits.</p>{/if}
  <div class="actions">
    <button disabled={busy} onclick={() => refresh()}>Refresh status</button><button
      disabled={busy || !active || unavailable}
      onclick={() => sync()}>Sync now</button
    >
  </div>
  {#if message}<p role="status">{message}</p>{/if}
  {#if listing}
    {#if listing.index}<p>
        Agent index: <code>{listing.index.path}</code> · {listing.index.state}. Read its paginated
        child indexes for verified working copies and next actions; edit working documents, not
        generated indexes.
      </p>
      {#if listing.index.error}<p role="status">{listing.index.error}</p>{/if}{/if}
    <p>
      {listing.documents.length} loaded documents · {listing.queued ?? 0} queued edits{listing.pending
        ? ' · Work pending'
        : ''}
    </p>
    <div class="document-list">
      {#each listing.documents as doc (doc.id)}<div class="document-row">
          <button disabled={busy || dirty} onclick={() => open(doc.id)}>{doc.title}</button><span
            >{doc.kind} · {doc.status}</span
          >{#if sourceLink(doc.sourceUrl)}<a
              href={sourceLink(doc.sourceUrl)}
              target="_blank"
              rel="noopener noreferrer">Open in Attio ↗</a
            >{/if}{#if doc.error}<p>{doc.error}</p>{/if}
        </div>{/each}
    </div>
    {#if listing.nextCursor}<button disabled={busy} onclick={() => refresh(true)}
        >Load more documents</button
      >{/if}
  {/if}
  {#if opened && draft}
    <div class="editor">
      <h4>
        {draft.kind === 'note' ? 'Linked note revision draft' : 'Edit approved record fields'}
      </h4>
      <p><strong>{draft.title}</strong> · {opened.status}{queued ? ' · Queued' : ''}</p>
      <details>
        <summary>Read-only source identity</summary>
        <pre>{JSON.stringify(draft.binding, null, 2)}</pre>
        {#if sourceLink(draft.url)}<a
            href={sourceLink(draft.url)}
            target="_blank"
            rel="noopener noreferrer">Open source in Attio ↗</a
          >{/if}
      </details>
      {#if opened.workingReadUnavailable}<p role="alert">
          The current working-file read is unavailable. Accepted values remain visible. Reload after
          access is restored; all write controls are disabled.
        </p>{/if}
      {#if opened.providerReadUnavailable}<p role="alert">
          The current Attio provider read is unavailable. Accepted values remain visible. Reload
          after access is restored; all write controls are disabled until provider evidence is
          current.
        </p>{/if}
      {#if opened.conflict}
        <p role="alert">
          Both sides changed or retained evidence needs review. Inspect each version and choose
          explicitly. An unavailable evidence choice cannot be selected.
        </p>
        <p>
          Conflict: <code>{opened.conflict.id}</code>. Current working revision:
          <code>{opened.revision ?? 'unavailable'}</code>.
        </p>
        <div class="conflict-versions">
          {#each choices as choice}<section class="version">
              <h4>{choice.title}</h4>
              {#if choice.id === 'working'}<p>
                  Retained version: <code
                    >{opened.interveningVersion?.fileId ?? 'No intervening version retained'}</code
                  >
                </p>{/if}
              {#if versions[choice.id]?.document}<pre>{JSON.stringify(
                    versions[choice.id].document,
                    null,
                    2
                  )}</pre>{:else}<p role="alert">
                  {versions[choice.id]?.error ?? 'This evidence is unavailable.'}
                </p>{/if}
              <button
                disabled={writeDisabled || !versions[choice.id]?.document}
                onclick={() => resolve(choice.id)}>{choice.button}</button
              >
            </section>{/each}
        </div>
      {:else if draft.kind === 'note'}
        <section class="source-snapshot">
          <h4>Source snapshot</h4>
          <p>
            API text projection, not a complete image or file backup. The original rich note remains
            in Attio. Source note: <code>{draft.binding.noteId}</code> · revision head:
            <code>{draft.headNoteId}</code>.
          </p>
          {#if opened.sourceDocument && !opened.sourceReadUnavailable}<strong
              >{opened.sourceDocument.title}</strong
            >
            <pre>{opened.sourceDocument.text}</pre>{:else}<p>
              The original source snapshot could not be loaded. The accepted revision draft is
              retained below.
            </p>
            {#if opened.sourceReference}<p>
                Retained source snapshot: <code>{opened.sourceReference.fileId}</code
                >{#if opened.sourceReference.hash}
                  · hash <code>{opened.sourceReference.hash}</code>{/if}. This reference is
                read-only evidence.
              </p>{/if}
          {/if}
        </section>
        <label
          >Note revision title<input
            bind:value={draft.title}
            disabled={writeDisabled}
            maxlength="200"
            oninput={() => (dirty = true)}
          /></label
        >
        <label
          >Note revision text<textarea
            bind:value={draft.text}
            disabled={writeDisabled}
            oninput={() => (dirty = true)}
          ></textarea></label
        >
        <p>
          Publishing creates a new linked text note on this exact parent record. Up to 24 KiB of
          note text. Attio may normalize paragraph spacing in the returned text projection; the
          original submitted draft is retained as evidence. Images, files and hidden rich blocks are
          not included in this projection.
        </p>
        <button
          class="primary"
          disabled={writeDisabled || !dirty || invalid || !draft.title.trim()}
          onclick={save}>Publish linked note revision</button
        >
      {:else}
        {#each draft.attributes as attribute (attribute.id)}
          <section class="attribute">
            <p>
              {attribute.title} · {attribute.type} · {attribute.multiple
                ? 'multiple values'
                : 'single value'}{attribute.required ? ' · required' : ''}<small
                >{attribute.id}</small
              >
            </p>
            {#if attribute.writable}
              {#if attribute.type === 'checkbox'}
                <label
                  >{attribute.title}<select
                    aria-label={attribute.title}
                    value={draft.values[attribute.id]?.length
                      ? String(draft.values[attribute.id][0])
                      : ''}
                    disabled={writeDisabled}
                    onchange={(event) =>
                      setValues(
                        attribute.id,
                        event.currentTarget.value === ''
                          ? []
                          : [event.currentTarget.value === 'true']
                      )}
                    ><option value="" disabled>No value — choose True or False</option><option
                      value="true">True</option
                    ><option value="false">False</option></select
                  ></label
                >
              {:else if attribute.type === 'select' || attribute.type === 'status' || attribute.type === 'record-reference'}
                {#if attribute.multiple}<label
                    >{attribute.title}<select
                      aria-label={attribute.title}
                      multiple
                      value={selectedValues(attribute)}
                      disabled={writeDisabled}
                      onchange={(event) => setOptions(attribute, event.currentTarget)}
                      >{#if attribute.type === 'record-reference'}{#each referenceChoices(attribute) as id}<option
                            value={id}>{id}</option
                          >{/each}{:else}{#each (attribute.options ?? []).filter((option: any) => !option.archived) as option}<option
                            value={option.id}>{option.title}</option
                          >{/each}{/if}</select
                    ></label
                  >{:else}<label
                    >{attribute.title}<select
                      aria-label={attribute.title}
                      value={selectedValues(attribute)[0] ?? ''}
                      disabled={writeDisabled}
                      onchange={(event) => setOptions(attribute, event.currentTarget)}
                      ><option value="">No value</option
                      >{#if attribute.type === 'record-reference'}{#each [...new Set( [...referenceChoices(attribute), ...selectedValues(attribute)] )] as id}<option
                            value={id}>{id}</option
                          >{/each}{:else}{#each (attribute.options ?? []).filter((option: any) => !option.archived) as option}<option
                            value={option.id}>{option.title}</option
                          >{/each}{/if}</select
                    ></label
                  >{/if}
                <p>
                  Selections replace this field’s full value set, including removals. References use
                  only approved existing records; no names or email matching.
                </p>
              {:else}
                {#each draft.values[attribute.id] ?? [] as value, index (index)}
                  <label
                    >{attribute.title}{attribute.multiple
                      ? ` value ${index + 1}`
                      : ''}{#if attribute.type === 'text'}<textarea
                        aria-label={attribute.multiple
                          ? `${attribute.title} value ${index + 1}`
                          : attribute.title}
                        {value}
                        disabled={writeDisabled}
                        oninput={(event) =>
                          changeValue(attribute, index, event.currentTarget.value)}
                      ></textarea>{:else}<input
                        aria-label={attribute.multiple
                          ? `${attribute.title} value ${index + 1}`
                          : attribute.title}
                        type={attribute.type === 'number' || attribute.type === 'rating'
                          ? 'number'
                          : attribute.type === 'date'
                            ? 'date'
                            : 'text'}
                        step="any"
                        {value}
                        disabled={writeDisabled}
                        placeholder={attribute.type === 'timestamp' ? '2026-11-02T12:00:00Z' : ''}
                        oninput={(event) =>
                          changeValue(attribute, index, event.currentTarget.value)}
                      />{/if}</label
                  >
                  {#if attribute.multiple}<button
                      disabled={writeDisabled ||
                        (attribute.required && draft.values[attribute.id].length <= 1)}
                      onclick={() =>
                        setValues(
                          attribute.id,
                          draft.values[attribute.id].filter((_: any, i: number) => i !== index)
                        )}>Remove {attribute.title} value {index + 1}</button
                    >{/if}
                {/each}
                {#if attribute.multiple || !draft.values[attribute.id]?.length}<button
                    disabled={writeDisabled}
                    onclick={() =>
                      setValues(attribute.id, [
                        ...(draft.values[attribute.id] ?? []),
                        attribute.type === 'number' || attribute.type === 'rating' ? 0 : ''
                      ])}>Add {attribute.title} value</button
                  >{/if}
              {/if}
              <button
                disabled={writeDisabled ||
                  attribute.required ||
                  attribute.type === 'checkbox' ||
                  !draft.values[attribute.id]?.length}
                onclick={() => setValues(attribute.id, [])}>Clear {attribute.title}</button
              >
              {#if fieldErrors[attribute.id]}<p role="alert">{fieldErrors[attribute.id]}</p>{/if}
            {:else}<p>Read-only · unsupported, unselected or provider-managed field.</p>
              <pre>{JSON.stringify(
                  draft.protected?.[attribute.id] ?? draft.values[attribute.id],
                  null,
                  2
                )}</pre>{/if}
          </section>
        {/each}
        <button class="primary" disabled={writeDisabled || !dirty || invalid} onclick={save}
          >Save and sync fields</button
        >
      {/if}
      {#if dirty && validationError && !oversized}<p role="alert">
          {validationError}. Your draft is retained.
        </p>{/if}
      {#if oversized}<p role="alert">
          Draft exceeds the 48 KiB document or 24 KiB note text limit. Shorten it to save; your
          draft is retained.
        </p>{/if}
      {#if queued}<p role="status">
          An accepted edit is queued. Reload after verified syncing before editing again.
        </p>{/if}
      <div class="actions">
        <button disabled={busy || dirty} onclick={() => open(opened.id)}>Reload document</button
        ><button disabled={writeDisabled || dirty} onclick={() => sync(opened.id)}
          >Sync this document now</button
        ><button disabled={busy} onclick={close}
          >{dirty ? 'Discard unsaved edits' : 'Close editor'}</button
        >
      </div>
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
  small {
    display: block;
    font-size: 11px;
    color: #90a3ba;
    overflow-wrap: anywhere;
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
  textarea,
  select {
    width: 100%;
    box-sizing: border-box;
    background: #0f1723;
    border: 1px solid #43516b;
    border-radius: 7px;
    color: #e5edf5;
    padding: 12px;
  }
  textarea {
    min-height: 100px;
    font-family: monospace;
    line-height: 1.5;
  }
  select[multiple] {
    min-height: 110px;
  }
  .conflict-versions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
  }
  .version,
  .attribute,
  .source-snapshot {
    padding: 12px;
    border: 1px solid #33445b;
    border-radius: 8px;
    margin: 12px 0;
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
  summary {
    cursor: pointer;
    color: #b4c0d0;
  }
</style>
