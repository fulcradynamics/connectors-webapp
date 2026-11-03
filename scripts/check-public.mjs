// Real HTTP regression: public documentation must survive every session state
// without consulting identity or requiring an operational database.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { open, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
let identityCalls = 0;
const authority = createServer((req, res) => {
  identityCalls++;
  const bearer = req.headers.authorization;
  res.setHeader('Content-Type', 'application/json');
  if (bearer === 'Bearer owner') res.end(JSON.stringify({ userid: 'test-owner' }));
  else if (bearer === 'Bearer other') res.end(JSON.stringify({ userid: 'another-user' }));
  else {
    res.statusCode = bearer === 'Bearer down' ? 503 : 401;
    res.end('{}');
  }
});
await new Promise((resolve) => authority.listen(0, '127.0.0.1', resolve));
const identityPort = authority.address().port;
await mkdir('.private', { recursive: true, mode: 0o700 });
const portProbe = createServer();
await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
const appPort = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const log = await open(`.private/public-http-server-${appPort}.log`, 'w', 0o600);
const child = spawn(
  'npm',
  ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'],
  {
    env: {
      ...process.env,
      CONNECTORS_MODE: 'public-template',
      PUBLIC_FULCRA_API_ENDPOINT: `http://127.0.0.1:${identityPort}/`,
      OWNER_USER_ID: 'test-owner',
      DATABASE_URL: ''
    },
    stdio: ['ignore', log.fd, log.fd],
    detached: true
  }
);
const base = `http://127.0.0.1:${appPort}`;
const evidence = { time: new Date().toISOString(), public: [], private: [] };
try {
  let ready = false;
  for (let n = 0; n < 70; n++) {
    assert.equal(child.exitCode, null, 'test server exited before readiness');
    try {
      if ((await fetch(base + '/api/health')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'local test server ready');
  for (const value of ['', 'forged', 'other', 'down', 'owner']) {
    const before = identityCalls;
    const headers = value ? { Cookie: `fulcra_access_token=${value}` } : {};
    const response = await fetch(base + '/', { headers });
    assert.equal(response.status, 200, `public landing with ${value || 'no cookie'}`);
    const html = await response.text();
    for (const text of [
      'Fork or clone',
      'Use your instance',
      'Build a connector',
      'Contribute for review',
      'Granola',
      'Asana',
      'GitHub',
      'Notion',
      'Slack',
      'Garmin',
      '/app'
    ])
      assert.ok(html.includes(text), text);
    for (const text of ['Authorize Fulcra', 'ciphertext', 'test-owner'])
      assert.ok(!html.includes(text), `no private state: ${text}`);
    assert.equal(identityCalls, before, 'public rendering never queries identity');
    evidence.public.push({ session: value || 'absent', status: response.status, identityCalls: 0 });
  }
  for (const value of ['', 'forged', 'other', 'down']) {
    const before = identityCalls;
    const headers = value ? { Cookie: `fulcra_access_token=${value}` } : {};
    const guide = await fetch(base + '/guide', { headers });
    assert.equal(guide.status, 200, 'public user guide');
    const html = await guide.text();
    for (const text of [
      'User guide',
      'Agent instructions',
      'Granola',
      'Asana',
      'GitHub',
      'Notion',
      'Slack',
      'Garmin'
    ])
      assert.ok(html.includes(text), text);
    for (const name of [
      'user',
      'agent',
      'adding-a-connector',
      'setup',
      'contributing',
      'operations',
      ...['granola', 'asana', 'github', 'notion', 'slack', 'garmin'].map((x) => 'providers/' + x)
    ]) {
      const response = await fetch(`${base}/guides/${name}.md`, { headers });
      assert.equal(response.status, 200, name);
      assert.match(response.headers.get('content-type'), /^text\/markdown/);
      const markdown = await response.text();
      assert.ok(markdown.length > 300, name + ' has instructions');
      for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
        if (match[1].startsWith('http') || match[1].startsWith('#')) continue;
        const link = new URL(match[1], response.url);
        assert.equal((await fetch(link)).status, 200, name + ' guide cross-link ' + match[1]);
      }
    }
    assert.equal(identityCalls, before, 'public guides do not verify identity');
  }
  for (const name of ['.env', '../.env', 'progress.md', 'unknown.md', 'providers/unknown.md']) {
    const response = await fetch(base + '/guides/' + name);
    assert.ok([403, 404].includes(response.status), 'no arbitrary files: ' + name);
  }
  for (const path of ['/app', '/harness']) {
    for (const value of ['', 'forged', 'other', 'down', 'owner']) {
      // Harness owner requires actual Fulcra records: don't mock its successful load.
      if (path === '/harness' && value === 'owner') continue;
      const response = await fetch(base + path, {
        redirect: 'manual',
        headers: value ? { Cookie: `fulcra_access_token=${value}` } : {}
      });
      const expected =
        !value || value === 'forged' ? 303 : value === 'other' ? 403 : value === 'down' ? 503 : 200;
      assert.equal(response.status, expected, `${path} session ${value}`);
      if (expected === 303) assert.equal(response.headers.get('location'), '/login');
      evidence.private.push({ path, session: value || 'absent', status: response.status });
    }
  }
  for (const path of ['/api/setup', '/api/connections', '/api/harness/runs']) {
    assert.equal((await fetch(base + path)).status, 401, path);
    assert.equal(
      (await fetch(base + path, { headers: { Cookie: 'fulcra_access_token=other' } })).status,
      403,
      path
    );
  }
  assert.equal((await fetch(base + '/login')).status, 200);
  assert.ok(identityCalls > 0, 'private checks exercised this run’s identity authority');
  await writeFile('.private/public-http-evaluation.json', JSON.stringify(evidence, null, 2), {
    mode: 0o600
  });
  console.log(
    'Public/private HTTP checks passed: 5 public session states, no identity calls/database; private routes and APIs denied appropriately.'
  );
} finally {
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    process.kill(-child.pid, 'SIGTERM');
    await exited;
  }
  await log.close();
  await new Promise((resolve) => authority.close(resolve));
}
