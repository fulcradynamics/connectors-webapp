// Local synthetic UI acceptance. Optional driver: npm install --no-save --package-lock=false playwright
// No provider, Fulcra, production credentials, or production writes are used.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, open, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const authority = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ userid: 'walkthrough-owner' }));
});
await new Promise((r) => authority.listen(0, '127.0.0.1', r));
const probe = createServer();
await new Promise((r) => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
await mkdir('.private', { recursive: true, mode: 0o700 });
const log = await open('.private/walkthrough-server.log', 'w', 0o600);
const child = spawn(
  'npm',
  ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  {
    env: {
      ...process.env,
      CONNECTORS_MODE: 'personal',
      CONNECTORS_BACKEND: 'postgres',
      DATABASE_URL: '',
      OWNER_USER_ID: 'walkthrough-owner',
      PUBLIC_FULCRA_API_ENDPOINT: `http://127.0.0.1:${authority.address().port}/`
    },
    stdio: ['ignore', log.fd, log.fd],
    detached: true
  }
);
let browser;
const base = `http://127.0.0.1:${port}`,
  evidence = { providerInstructions: [], configuration: null };
try {
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(base + '/api/health')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, 'test app starts');
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {})
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addCookies([{ name: 'fulcra_access_token', value: 'synthetic-owner', url: base }]);
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let connections = [],
    saved,
    enabled = false,
    backgroundReady = true;
  let putCount = 0;
  const types = [{ id: 'Event/synthetic', name: 'Meeting records' }];
  const connectionId = '11111111-1111-4111-8111-111111111111';
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    let body = {},
      status = 200;
    if (path === '/api/auth/check') body = { authenticated: true };
    else if (path === '/api/auth/user') body = { 'fulcradynamics.com/userid': 'walkthrough-owner' };
    else if (path === '/api/harness/owner') body = { isOwner: true };
    else if (path === '/api/user/info') body = { userid: 'walkthrough-owner' };
    else if (path === '/api/setup')
      body = {
        ready: true,
        backgroundStatus: backgroundReady ? 'ready' : 'required_configuration'
      };
    else if (path === '/api/connections' && req.method() === 'GET') body = { connections };
    else if (path === '/api/connections' && req.method() === 'POST') {
      const input = req.postDataJSON();
      connections = [
        {
          id: connectionId,
          connector: input.connector,
          account_id: 'synthetic-account',
          label: input.label,
          status: 'draft',
          config: {}
        }
      ];
      body = { connection: connections[0] };
      status = 201;
    } else if (path === `/api/connections/${connectionId}/resources`)
      body = {
        resources: [{ id: 'folder-one', name: 'Marketing meetings', kind: 'folder' }],
        nextCursor: null
      };
    else if (path === '/api/destinations/types' && req.method() === 'POST') {
      const input = req.postData() ? req.postDataJSON() : {};
      const type = {
        id: input.name ? 'Event/named' : 'Event/created',
        name: input.name || 'Connector records'
      };
      types.push(type);
      body = { type };
    } else if (path === '/api/destinations/types') body = { types };
    else if (path === `/api/connections/${connectionId}` && req.method() === 'PUT') {
      if (++putCount === 1) await new Promise((r) => setTimeout(r, 1200));
      saved = req.postDataJSON();
      connections[0].config = saved;
      body = { connection: connections[0] };
    } else if (path === `/api/connections/${connectionId}`)
      body = { connection: connections[0], status: {} };
    else if (path === '/api/preview')
      body = {
        complete: true,
        writesPerformed: false,
        outputs: [
          {
            record: { payload: { title: 'Synthetic marketing meeting' } },
            files: [{ path: 'sample/meeting.md' }]
          }
        ]
      };
    else if (path === `/api/connections/${connectionId}/action`) {
      const input = req.postDataJSON();
      assert.equal(input.confirmed, true);
      enabled = input.action === 'enable';
      connections[0].status = 'ready';
      body = { status: 'ready' };
    } else {
      errors.push('Unexpected browser API request: ' + path);
      status = 500;
      body = { message: 'Unexpected synthetic request' };
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(base + '/app');
  for (const [id, name, link] of [
    ['granola', 'Granola', 'Granola API key instructions'],
    ['asana', 'Asana', 'Asana token setup instructions'],
    ['github', 'GitHub', 'GitHub token setup instructions'],
    ['notion', 'Notion', 'Notion connection setup instructions'],
    ['slack', 'Slack', 'Slack token setup instructions']
  ]) {
    await page.getByRole('button', { name: new RegExp(name) }).click();
    assert.equal(await page.getByRole('link', { name: new RegExp(link) }).count(), 1);
    const actionLinks = {
      asana: ['Open Asana token console', 'https://app.asana.com/0/my-apps'],
      github: [
        'Create GitHub fine-grained token',
        'https://github.com/settings/personal-access-tokens/new?name=Fulcra%20Connectors&metadata=read&issues=read&pull_requests=read'
      ],
      notion: ['Open Notion connection console', 'https://app.notion.com/developers/connections'],
      slack: ['Open Slack app and token settings', 'https://api.slack.com/apps']
    };
    if (id === 'granola') {
      await page
        .getByText('Granola keys are created in the desktop app.', { exact: true })
        .waitFor();
    } else {
      const [action, href] = actionLinks[id];
      assert.equal(
        await page.getByRole('link', { name: action + ' ↗', exact: true }).getAttribute('href'),
        href
      );
    }
    if (id === 'github')
      assert.equal(
        await page
          .getByRole('link', { name: 'Create a GitHub App instead ↗', exact: true })
          .getAttribute('href'),
        'https://github.com/settings/apps/new'
      );
    assert.ok((await page.locator('form').innerText()).includes('What happens next'));
    evidence.providerInstructions.push(id);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await page.getByRole('button', { name: /Granola/ }).click();
  await page.getByLabel('Read token / API key').fill('synthetic-api-key');
  await page.getByLabel('Stable source account ID').fill('synthetic-granola');
  await page.getByRole('button', { name: 'Verify and continue →' }).click();
  await page.getByRole('navigation', { name: 'Connection setup' }).waitFor();
  await page.getByText('Granola keys are created in the desktop app.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Back to all connectors', exact: true }).click();
  await page.locator('.catalog').waitFor();
  await page.locator('.connection-row').first().click();
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await page.locator('.catalog').waitFor();
  await page.locator('.connection-row').first().click();
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  await page.locator('.catalog').waitFor();
  assert.equal(putCount, 0, 'navigation does not save or mutate a connection');
  assert.equal(enabled, false, 'navigation never enables collection');
  await page.locator('.connection-row').first().click();
  await page.getByRole('button', { name: 'Discover available folders' }).click();
  await page.getByRole('checkbox', { name: /Marketing meetings/ }).check();
  await page.getByRole('button', { name: 'Continue to destination' }).click();
  await page.getByLabel('Write format').selectOption('both');
  assert.equal(await page.getByRole('button', { name: 'Continue to schedule' }).isDisabled(), true);
  await page.getByLabel('Folder path').fill('/work/meetings');
  await page.getByLabel('Recordable v1 data type').selectOption('Event/synthetic');
  await page.getByLabel('Recordable v1 data type').selectOption('');
  await page.getByRole('button', { name: 'Create or reuse connector record type' }).click();
  await page.getByLabel('Recordable v1 data type').selectOption('Event/created');
  await page.getByRole('button', { name: '+ Create new v1 data type…', exact: true }).click();
  await page.getByLabel('Data type name', { exact: true }).fill('Research updates');
  await page.getByLabel('Description (optional)', { exact: true }).fill('Selected source records');
  await page.getByRole('button', { name: 'Create v1 data type', exact: true }).click();
  await page
    .getByText('Research updates — Event/named', { exact: true })
    .waitFor({ state: 'attached' });
  assert.equal(await page.getByLabel('Recordable v1 data type').inputValue(), 'Event/named');

  await page.getByRole('button', { name: 'Continue to schedule' }).click();
  await page.getByLabel('Polling interval (seconds)').fill('900');
  await page.getByRole('button', { name: 'Save and preview output' }).click();
  assert.equal(
    await page.getByLabel('Polling interval (seconds)').isDisabled(),
    true,
    'pending save locks the choices represented by its preview'
  );
  await page.getByRole('heading', { name: '6. Review and enable' }).waitFor();
  assert.equal(enabled, false);
  assert.equal(saved.intervalSeconds, 900);
  assert.equal(saved.route.mode, 'both');
  assert.equal(saved.route.folder, '/work/meetings');
  assert.equal(saved.route.recordType, 'Event/named');
  assert.equal(
    await page.getByRole('button', { name: 'Enable background collection' }).isDisabled(),
    true
  );
  await page.getByRole('checkbox', { name: /I reviewed/ }).check();
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  await page.getByLabel('Polling interval (seconds)').fill('600');
  assert.equal(
    await page.getByRole('button', { name: 'Enable background collection' }).count(),
    0,
    'editing invalidates the old preview'
  );
  await page.getByRole('button', { name: 'Save and preview output' }).click();
  await page.getByRole('checkbox', { name: /I reviewed/ }).check();
  await page.getByRole('button', { name: 'Enable background collection' }).click();
  await page.waitForTimeout(200);
  assert.equal(enabled, true);
  assert.equal(saved.intervalSeconds, 600);
  evidence.configuration = {
    ...saved,
    enabledAfterConfirmation: true,
    stalePreviewInvalidated: true
  };
  await page.getByRole('button', { name: 'Replace credential' }).click();
  assert.ok((await page.locator('form').innerText()).includes('Retained settings'));
  assert.ok((await page.locator('form').innerText()).includes('/work/meetings'));
  assert.ok((await page.locator('form').innerText()).includes('Every 10 minutes'));
  assert.equal(await page.getByLabel('Stable source account ID').inputValue(), 'synthetic-account');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  evidence.replacementRetainsSettings = true;
  backgroundReady = false;
  connections[0].status = 'paused';
  await page.reload();
  await page.locator('.connection-row').first().click();
  await page.getByRole('button', { name: 'Continue to destination' }).click();
  await page.getByRole('button', { name: 'Continue to schedule' }).click();
  await page.getByRole('button', { name: 'Save and preview output' }).click();
  await page.getByRole('heading', { name: '6. Review and enable' }).waitFor();
  await page.getByRole('checkbox', { name: /I reviewed/ }).check();
  assert.equal(
    await page.getByRole('button', { name: 'Enable background collection' }).isDisabled(),
    true,
    'missing app-wide grant blocks enable'
  );
  evidence.backgroundGrantGate = true;
  await page.screenshot({ path: '.private/walkthrough-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.private/walkthrough-mobile.png', fullPage: true });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'mobile page has no horizontal overflow'
  );
  // Saved views and replacement forms must retain credential actions for every provider.
  evidence.credentialActions = [];
  for (const [id, action, href] of [
    ['asana', 'Open Asana token console', 'https://app.asana.com/0/my-apps'],
    [
      'github',
      'Create GitHub fine-grained token',
      'https://github.com/settings/personal-access-tokens/new?name=Fulcra%20Connectors&metadata=read&issues=read&pull_requests=read'
    ],
    ['notion', 'Open Notion connection console', 'https://app.notion.com/developers/connections'],
    ['slack', 'Open Slack app and token settings', 'https://api.slack.com/apps']
  ]) {
    connections[0].connector = id;
    await page.reload();
    await page.locator('.connection-row').first().click();
    assert.equal(
      await page.getByRole('link', { name: action + ' ↗', exact: true }).getAttribute('href'),
      href
    );
    await page.getByRole('button', { name: 'Replace credential', exact: true }).click();
    assert.equal(
      await page
        .locator('form')
        .getByRole('link', { name: action + ' ↗', exact: true })
        .getAttribute('href'),
      href
    );
    await page.locator('form').getByRole('button', { name: 'Cancel', exact: true }).click();
    evidence.credentialActions.push({ id, href, savedAndReplacement: true });
  }
  assert.deepEqual(errors, []);
  await writeFile('.private/walkthrough-browser.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally {
  await browser?.close();
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {}
  await new Promise((r) => authority.close(r));
  await log.close();
}
