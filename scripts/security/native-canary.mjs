import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-dependency-canary-'));
fs.cpSync(path.join(import.meta.dirname, 'native-fixture'), dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}\n');
// Kit 3 writes generated $app types into node_modules. Give the fixture its own
// generated namespace instead of changing the application's installed types.
const modules = path.join(dir, 'node_modules');
fs.mkdirSync(modules);
for (const name of fs.readdirSync(path.join(root, 'node_modules'))) {
  if (name === '$app' || name === '.cache') continue;
  const source = path.join(root, 'node_modules', name);
  fs.symlinkSync(
    source,
    path.join(modules, name),
    fs.statSync(source).isDirectory() ? 'dir' : 'file'
  );
}
execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], {
  cwd: dir,
  stdio: 'inherit'
});
const probe = net.createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['build/index.js'], {
  cwd: dir,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    WORKFLOW_TARGET_WORLD: 'local',
    WORKFLOW_LOCAL_BASE_URL: base,
    WORKFLOW_LOCAL_DATA_DIR: path.join(dir, 'workflow-data')
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '';
child.stdout.on('data', (b) => (logs += b));
child.stderr.on('data', (b) => (logs += b));
try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const r = await fetch(base);
      if (r.ok) break;
    } catch {
      // The child server may not have opened its listener yet.
    }
    if (Date.now() > deadline) throw new Error('Server startup timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
  const start = await fetch(base + '/api/canary', {
    method: 'POST',
    headers: { origin: base, 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(start.status, 200);
  const { runId } = await start.json();
  assert.match(runId, /^wrun_/);
  let result;
  do {
    const response = await fetch(base + '/api/canary?runId=' + encodeURIComponent(runId));
    assert.equal(response.status, 200);
    result = await response.json();
    if (result.status === 'completed') break;
    if (Date.now() > deadline) throw new Error('Workflow did not complete');
    await new Promise((r) => setTimeout(r, 50));
  } while (result?.status !== 'completed');
  assert.deepEqual(result, { status: 'completed', output: 'dependency-fixture' });
  console.log(JSON.stringify({ node: process.version, runId, ...result, fixture: dir }));
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  child.kill('SIGTERM');
}
