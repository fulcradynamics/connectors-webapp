// Production-compiled synthetic owner UI. No provider accounts or remote writes.
// PLAYWRIGHT_MODULE may point to an isolated Playwright installation.
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { projectRecord, projectNote } from '../src/lib/attio-documents.js';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(repo, '.private'), { recursive: true, mode: 0o700 });
const scratch = await mkdtemp(path.join(repo, '.private/attio-ui-'));
let server, browser;
const connectionId = '11111111-1111-4111-8111-111111111111';
const objectId = '22222222-2222-4222-8222-222222222222';
const recordId = '33333333-3333-4333-8333-333333333333';
const resourceId = `${objectId}:${recordId}`;
const uuid = (n) => `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`;
const aid = Object.fromEntries(
  [
    'text',
    'number',
    'checkbox',
    'tags',
    'date',
    'time',
    'ref',
    'system',
    'multitext',
    'status'
  ].map((id, i) => [id, uuid(i + 1)])
);
const red = uuid(20),
  blue = uuid(21),
  workspaceId = uuid(30),
  noteId = uuid(31);
const attributes = [
  {
    id: 'text',
    title: 'Description',
    type: 'text',
    multiple: false,
    writable: true,
    required: false
  },
  {
    id: 'number',
    title: 'Score',
    type: 'number',
    multiple: false,
    writable: true,
    required: false
  },
  {
    id: 'checkbox',
    title: 'Active',
    type: 'checkbox',
    multiple: false,
    writable: true,
    required: false
  },
  {
    id: 'tags',
    title: 'Tags',
    type: 'select',
    multiple: true,
    writable: true,
    required: false,
    options: [
      { id: red, title: 'Red' },
      { id: blue, title: 'Blue' },
      { id: uuid(22), title: 'Archived choice', archived: true }
    ]
  },
  {
    id: 'status',
    title: 'Stage',
    type: 'status',
    multiple: false,
    writable: true,
    required: false,
    options: [
      { id: blue, title: 'Blue' },
      { id: uuid(22), title: 'Archived choice', archived: true }
    ]
  },
  {
    id: 'date',
    title: 'Start date',
    type: 'date',
    multiple: false,
    writable: true,
    required: false
  },
  {
    id: 'time',
    title: 'Updated at',
    type: 'timestamp',
    multiple: false,
    writable: true,
    required: false
  },
  {
    id: 'ref',
    title: 'Related record',
    type: 'record-reference',
    multiple: true,
    writable: true,
    required: false,
    targetObjectIds: [objectId]
  },
  {
    id: 'multitext',
    title: 'Unsupported multi text',
    type: 'text',
    multiple: true,
    writable: true,
    required: false
  },
  {
    id: 'system',
    title: 'Enrichment',
    type: 'personal-name',
    multiple: false,
    writable: false,
    required: false
  }
].map((attribute) => ({ ...attribute, slug: attribute.id, id: aid[attribute.id] }));
const doc = projectRecord(
  {
    binding: { workspaceId, objectId, recordId },
    title: 'Synthetic company',
    url: 'https://app.attio.com/fixture',
    attributes,
    rawValues: {
      [aid.text]: [{ value: 'keep' }],
      [aid.number]: [{ value: 2 }],
      [aid.checkbox]: [{ value: true }],
      [aid.tags]: [{ option: { id: { option_id: red } } }, { option: { id: { option_id: blue } } }],
      [aid.status]: [{ status: { id: { status_id: blue } } }],
      [aid.date]: [{ value: '2026-11-02' }],
      [aid.time]: [{ value: '2026-11-02T12:00:00Z' }],
      [aid.ref]: [],
      [aid.multitext]: [],
      [aid.system]: [{ name: 'Read only' }]
    }
  },
  Object.values(aid),
  [resourceId]
);
const note = projectNote({
  binding: { workspaceId, objectId, recordId, noteId },
  title: 'Source note',
  text: 'Source <img src=x onerror=alert(1)> text',
  url: 'https://app.attio.com/fixture'
});

try {
  await writeFile(
    path.join(scratch, 'index.html'),
    '<div id="app"></div><script type="module" src="/main.js"></script>'
  );
  await writeFile(
    path.join(scratch, 'main.js'),
    `import {mount} from 'svelte'; import App from './App.svelte'; mount(App,{target:document.getElementById('app')});`
  );
  await writeFile(
    path.join(scratch, 'App.svelte'),
    `<script>
import Form from '${repo}/src/lib/components/ConnectionForm.svelte';
import Detail from '${repo}/src/lib/components/ConnectionDetail.svelte';
import Documents from '${repo}/src/lib/components/AttioDocuments.svelte';
let view=$state('form');
const connection={id:'${connectionId}',connector:'attio',label:'Synthetic Attio',account_id:'fixture-workspace',status:'draft',config:{}};
let savedConnection=$state({...connection,status:'ready',config:{resources:['${resourceId}'],attio:{twoWay:true,includeNotes:true,writableAttributes:{'${objectId}':['${aid.text}']}},route:{mode:'file',folder:'/fixture'},intervalSeconds:300,backfillSince:'2026-01-01T00:00:00.000Z'}});
</script><nav><button onclick={()=>view='form'}>Test form</button><button onclick={()=>view='setup'}>Test setup</button><button onclick={()=>view='saved'}>Test saved connection</button><button onclick={()=>view='docs'}>Test documents</button></nav>
{#if view==='form'}<Form connector="attio" oncreated={()=>{}} oncancel={()=>{}} />{:else if view==='setup'}<Detail {connection} backgroundReady={true} onclose={()=>{}} onchanged={()=>{}} />{:else if view==='saved'}<Detail connection={savedConnection} backgroundReady={true} onclose={()=>{}} onchanged={()=>{}} />{:else}<Documents connectionId="${connectionId}" active={true} approvedResources={['${resourceId}']} />{/if}`
  );
  const config = {
    configFile: false,
    root: scratch,
    logLevel: 'error',
    plugins: [svelte({ configFile: false, compilerOptions: { dev: false } })],
    resolve: { alias: { $lib: path.join(repo, 'src/lib') }, dedupe: ['svelte'] },
    build: { outDir: path.join(scratch, 'dist'), emptyOutDir: true },
    preview: { host: '127.0.0.1', port: 0, strictPort: true }
  };
  await build(config);
  server = await preview(config);
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {})
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let savedConfig,
    savedDocument,
    resolveInput,
    failSave = true,
    conflict = false,
    unavailable = false,
    providerUnavailable = false,
    sourceUnavailable = false,
    documentKind = 'record';
  let connection = {
    id: connectionId,
    connector: 'attio',
    label: 'Synthetic Attio',
    account_id: 'fixture-workspace',
    status: 'draft',
    config: {}
  };
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    let body = {},
      status = 200;
    if (url.pathname.endsWith('/documents')) {
      const id = url.searchParams.get('document'),
        view = url.searchParams.get('view');
      if (url.searchParams.has('schema')) body = { attributes };
      else if (req.method() === 'POST') {
        const input = req.postDataJSON();
        if (input.operation === 'save') {
          savedDocument = input;
          if (failSave) {
            status = 409;
            body = { message: 'Stale revision — draft retained' };
          } else body = { id: input.id, queued: true };
        } else if (input.operation === 'resolve') {
          resolveInput = input;
          body = { queued: true };
        } else body = { queued: true };
      } else if (id) {
        if (view === 'working') {
          status = 503;
          body = { message: 'Retained evidence unavailable' };
        } else
          body = {
            id,
            document: structuredClone(documentKind === 'note' ? note : doc),
            revision: 'revision-1',
            queued: false,
            status: conflict ? 'conflict' : 'synced',
            workingReadUnavailable: unavailable,
            providerReadUnavailable: providerUnavailable,
            ...(conflict
              ? {
                  conflict: { id: 'conflict-1' },
                  expectedProvider: providerUnavailable ? null : { hash: 'provider-hash' },
                  interveningVersion: { fileId: 'retained-file-id' }
                }
              : {}),
            ...(documentKind === 'note'
              ? sourceUnavailable
                ? {
                    sourceReadUnavailable: true,
                    sourceReference: {
                      fileId: 'source-snapshot-immutable-id',
                      hash: 'a'.repeat(64)
                    }
                  }
                : { sourceDocument: structuredClone(note) }
              : {})
          };
      } else
        body = {
          documents: url.searchParams.has('cursor')
            ? [{ id: 'note', title: 'Source note', kind: 'note', status: 'synced' }]
            : [
                {
                  id: 'record',
                  title: 'Synthetic company',
                  kind: 'record',
                  status: 'synced',
                  sourceUrl: 'javascript:alert(1)'
                }
              ],
          nextCursor: url.searchParams.has('cursor') ? null : 'page-2',
          index: { path: '/fixture/live/index.md', state: 'verified' },
          queued: 0,
          pending: null
        };
    } else if (url.pathname.endsWith('/resources'))
      body = {
        resources: [
          { id: resourceId, name: 'Synthetic company', kind: 'record', objectId, recordId }
        ],
        nextCursor: null
      };
    else if (url.pathname === '/api/destinations/types')
      body = { types: [{ id: 'Event/synthetic', name: 'Synthetic events' }] };
    else if (url.pathname === `/api/connections/${connectionId}`) {
      if (req.method() === 'PUT') {
        savedConfig = req.postDataJSON();
        connection.config = savedConfig;
      }
      body = { connection, status: {} };
    } else if (url.pathname === '/api/preview')
      body = { complete: true, outputs: [], writesPerformed: false };
    else if (url.pathname.endsWith('/action')) {
      connection.status = 'ready';
      body = { status: 'ready' };
    } else {
      status = 500;
      body = { message: 'Unexpected synthetic request' };
      errors.push(url.pathname);
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(base);
  await page.getByText('Workspace settings → Developers', { exact: false }).first().waitFor();
  assert.equal(
    await page
      .getByRole('link', { name: 'Attio API key creation and management help' })
      .getAttribute('href'),
    'https://attio.com/help/reference/apps/generating-an-api-key'
  );
  await page.getByLabel('Attio workspace access token').waitFor();
  await page.getByRole('button', { name: 'Test setup', exact: true }).click();
  await page.getByRole('button', { name: 'Discover available People / Companies records' }).click();
  await page.getByLabel(`Synthetic company${resourceId}`).check();
  assert.equal(await page.getByLabel('Enable two-way Attio ↔ Fulcra sync').isChecked(), false);
  assert.equal(await page.getByLabel('Include notes from selected records').isChecked(), false);
  await page.getByLabel('Include notes from selected records').check();
  await page.getByRole('button', { name: 'Continue to destination' }).click();
  await page.getByLabel('Write format').selectOption('record');
  await page.getByLabel('Recordable v1 data type').selectOption('Event/synthetic');
  await page.getByRole('button', { name: 'Continue to schedule' }).click();
  await page.getByRole('button', { name: 'Save and preview output' }).click();
  await page.getByRole('heading', { name: '6. Review and enable' }).waitFor();
  assert.deepEqual(savedConfig.attio, {
    twoWay: false,
    includeNotes: true,
    writableAttributes: {}
  });
  assert.ok(!Object.hasOwn(savedConfig, 'twoWay'));
  assert.equal(savedConfig.route.mode, 'record');
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByLabel('Enable two-way Attio ↔ Fulcra sync').check();
  await page.getByRole('button', { name: 'Load writable fields', exact: false }).click();
  assert.equal(await page.getByLabel('Read-only: Unsupported multi text').isDisabled(), true);
  await page.getByLabel('Allow Description').check();
  await page.getByLabel('Include notes from selected records').check();
  await page.getByRole('button', { name: 'Continue to destination' }).click();
  await page.getByLabel('Write format').selectOption('both');
  await page.getByLabel('Recordable v1 data type').selectOption('Event/synthetic');
  await page.getByRole('button', { name: 'Continue to schedule' }).click();
  await page.getByRole('button', { name: 'Save and preview output' }).click();
  await page.getByRole('heading', { name: '6. Review and enable' }).waitFor();
  assert.deepEqual(savedConfig.attio, {
    twoWay: true,
    includeNotes: true,
    writableAttributes: { [objectId]: [aid.text] }
  });
  assert.ok(!Object.hasOwn(savedConfig, 'twoWay'), 'Attio never sends Notion twoWay config');
  assert.deepEqual(savedConfig.resources, [resourceId]);
  assert.equal(savedConfig.route.mode, 'both');
  await page.getByRole('button', { name: 'Replace credential', exact: true }).click();
  await page.getByRole('heading', { name: 'Replace credentials for attio' }).waitFor();
  assert.equal(await page.getByLabel('Attio workspace access token').inputValue(), '');
  await page.getByText('Retained settings:', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Test documents', exact: true }).click();
  await page.getByText('Agent index:').waitFor();
  assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);
  await page.getByRole('button', { name: 'Load more documents' }).click();
  await page.getByRole('button', { name: 'Source note', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Synthetic company', exact: true }).click();
  await page.getByLabel('Tags', { exact: true }).waitFor();
  assert.equal(
    await page.locator('option').filter({ hasText: 'Archived choice' }).count(),
    0,
    'Archived select/status options are not editable choices'
  );
  assert.equal(await page.getByRole('button', { name: 'Clear Active' }).isDisabled(), true);
  await page.getByLabel('Related record', { exact: true }).selectOption([resourceId]);
  await page.getByLabel('Score', { exact: true }).fill('0');
  await page.getByLabel('Active', { exact: true }).selectOption('false');
  await page.getByLabel('Tags', { exact: true }).selectOption([red]);
  await page.getByRole('button', { name: 'Clear Description' }).click();
  await page.getByLabel('Updated at', { exact: true }).fill('2026-11-02T12:00:00');
  assert.equal(await page.getByRole('button', { name: 'Save and sync fields' }).isDisabled(), true);
  await page.getByLabel('Updated at', { exact: true }).fill('2026-11-02T12:00:00Z');
  await page.getByRole('button', { name: 'Save and sync fields' }).click();
  await page.getByText('Stale revision — draft retained').waitFor();
  assert.deepEqual(savedDocument.document.values[aid.ref], [{ objectId, recordId }]);
  assert.deepEqual(savedDocument.document.values[aid.number], [0]);
  assert.deepEqual(savedDocument.document.values[aid.checkbox], [false]);
  assert.deepEqual(savedDocument.document.values[aid.tags], [red]);
  assert.deepEqual(savedDocument.document.values[aid.text], []);
  assert.equal(await page.getByLabel('Score', { exact: true }).inputValue(), '0');
  assert.equal(await page.getByRole('button', { name: 'Save and sync fields' }).isEnabled(), true);
  await page.getByRole('button', { name: 'Discard unsaved edits' }).click();
  conflict = true;
  await page.getByRole('button', { name: 'Synthetic company', exact: true }).click();
  await page.getByText('retained-file-id', { exact: false }).waitFor();
  await page.getByText('Retained evidence unavailable', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Use Attio version' }).isEnabled(), true);
  assert.equal(
    await page.getByRole('button', { name: 'Use accepted Fulcra version' }).isEnabled(),
    true
  );
  assert.equal(
    await page.getByRole('button', { name: 'Use intervening working-file version' }).isDisabled(),
    true
  );
  await page.getByRole('button', { name: 'Use Attio version' }).click();
  assert.equal(resolveInput.choice, 'provider');
  assert.equal(resolveInput.conflictId, 'conflict-1');
  assert.equal(resolveInput.expectedRevision, 'revision-1');
  assert.deepEqual(resolveInput.expectedProvider, { hash: 'provider-hash' });
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  conflict = false;
  unavailable = true;
  await page.getByRole('button', { name: 'Synthetic company', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Save and sync fields' }).isDisabled(), true);
  assert.equal(
    await page.getByRole('button', { name: 'Sync this document now' }).isDisabled(),
    true
  );
  assert.equal(await page.getByLabel('Score', { exact: true }).isDisabled(), true);
  assert.equal(
    await page.getByRole('button', { name: 'Sync now', exact: true }).isDisabled(),
    true
  );
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  unavailable = false;
  providerUnavailable = true;
  await page.getByRole('button', { name: 'Synthetic company', exact: true }).click();
  await page.getByLabel('Score', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Score', { exact: true }).inputValue(), '2');
  assert.equal(await page.getByLabel('Score', { exact: true }).isDisabled(), true);
  assert.equal(
    await page.getByRole('button', { name: 'Sync now', exact: true }).isDisabled(),
    true
  );
  await page
    .getByRole('alert')
    .filter({ hasText: 'The current Attio provider read is unavailable.' })
    .waitFor();
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  providerUnavailable = false;
  documentKind = 'note';
  failSave = false;
  await page.getByRole('button', { name: 'Source note', exact: true }).click();
  await page.getByRole('heading', { name: 'Source snapshot' }).waitFor();
  await page
    .getByText('API text projection, not a complete image or file backup.', { exact: false })
    .waitFor();
  assert.equal(await page.locator('img').count(), 0);
  await page.getByLabel('Note revision text').fill('é'.repeat(12289));
  assert.equal(
    await page.getByRole('button', { name: 'Publish linked note revision' }).isDisabled(),
    true
  );
  assert.equal((await page.getByLabel('Note revision text').inputValue()).length, 12289);
  await page.getByLabel('Note revision text').fill('A new linked note revision');
  await page.getByRole('button', { name: 'Publish linked note revision' }).click();
  await page.getByText('Saved to the durable queue.', { exact: false }).waitFor();
  assert.equal(savedDocument.document.text, 'A new linked note revision');
  assert.equal(savedDocument.document.binding.noteId, noteId);
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  sourceUnavailable = true;
  await page.getByRole('button', { name: 'Source note', exact: true }).click();
  await page.getByText('source-snapshot-immutable-id', { exact: true }).waitFor();
  await page.getByText('a'.repeat(64), { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Note revision text').isEnabled(), true);
  await page
    .getByLabel('Note revision text')
    .fill('Revision with retained original source reference');
  assert.equal(
    await page.getByRole('button', { name: 'Publish linked note revision' }).isEnabled(),
    true
  );

  // The chooser passes a reactive saved object, unlike an empty onboarding draft.
  // Opening it must retain the nested field selections without cloning a Proxy.
  connection = {
    ...connection,
    status: 'ready',
    config: {
      resources: [resourceId],
      attio: { twoWay: true, includeNotes: true, writableAttributes: { [objectId]: [aid.text] } },
      route: { mode: 'file', folder: '/fixture' },
      intervalSeconds: 300,
      backfillSince: '2026-01-01T00:00:00.000Z'
    }
  };
  await page.getByRole('button', { name: 'Test saved connection', exact: true }).click();
  await page.getByRole('heading', { name: 'Synthetic Attio', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Enable two-way Attio ↔ Fulcra sync').isChecked(), true);
  await page.getByText('1 approved writable fields.', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Attio production UI: setup, typed zero/false/clear/removal, stale draft, pagination, conflict evidence, unavailable-write guards and linked-note source/draft passed.'
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
