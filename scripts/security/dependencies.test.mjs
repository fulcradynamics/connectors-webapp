import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const merge = require('deepmerge');
test('deepmerge rejects dangerous source and target keys at all clone/merge boundaries', () => {
  const payload = () =>
    JSON.parse(
      '{"__proto__":{"admin":true},"constructor":{"prototype":{"admin":true}},"prototype":{"admin":true}}'
    );
  for (const result of [
    merge(Object.create(null), payload()),
    merge(payload(), {}),
    merge({ session: null }, { session: payload() }).session,
    merge({ session: undefined }, { session: payload() }).session,
    merge({ session: payload() }, { session: {} }).session
  ]) {
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(result.admin, undefined);
    for (const key of ['__proto__', 'constructor', 'prototype'])
      assert.equal(Object.hasOwn(result, key), false);
  }
  assert.equal({}.admin, undefined);
});
test('deepmerge preserves consumer configuration merge contracts', () => {
  assert.deepEqual(merge(null, { a: 1 }), { a: 1 });
  const symbol = Symbol('config');
  const out = merge(
    { nested: { left: 1 }, array: [1], [symbol]: { left: 1 } },
    { nested: { right: 2 }, array: [2], [symbol]: { right: 2 } }
  );
  assert.deepEqual(out.nested, { left: 1, right: 2 });
  assert.deepEqual(out.array, [1, 2]);
  assert.deepEqual(out[symbol], { left: 1, right: 2 });
  assert.deepEqual(merge({ array: [1] }, { array: [2] }, { arrayMerge: (_a, b) => b }), {
    array: [2]
  });
  const proxy = new Proxy(
    {},
    {
      has() {
        throw new Error('blocked');
      }
    }
  );
  assert.deepEqual(merge(proxy, { admin: true }), {});
});
for (const owner of [
  'eslint',
  '@eslint/config-array',
  '@oclif/core',
  '@vercel/queue',
  '@typescript-eslint/typescript-estree'
]) {
  test(`${owner} resolves minimatch 11 and retained matching/class contracts`, () => {
    const from = createRequire(require.resolve(owner));
    const mm = from('minimatch');
    assert.equal(from('minimatch/package.json').version, '11.0.4');
    for (const [filename, pattern, expected] of [
      ['src/a.js', '**/*.js', true],
      ['src/a.ts', '**/*.js', false],
      ['@workflow/core', '@workflow/*', true],
      ['.hidden/a.js', '**/*.js', false]
    ])
      assert.equal(mm.minimatch(filename, pattern), expected);
    assert.equal(new mm.Minimatch('**/*.js', { dot: true }).match('.hidden/a.js'), true);
    assert.equal(new mm.Minimatch('**/*.js', { partial: true }).match('src'), true);
  });
}
test('SWC CLI resolves fixed named minimatch API', () => {
  const workflowRequire = createRequire(require.resolve('workflow'));
  const swcRequire = createRequire(workflowRequire.resolve('@swc/cli'));
  assert.equal(swcRequire('minimatch/package.json').version, '11.0.4');
  assert.equal(swcRequire('minimatch').minimatch('src/a.ts', '**/*.ts'), true);
});
test('ESLint 10 scans ignored and included paths through updated config-array', async () => {
  const { ESLint } = await import('eslint');
  const lint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      { files: ['**/*.js'], ignores: ['**/ignored/**'], rules: { 'no-undef': 'error' } }
    ]
  });
  const [result] = await lint.lintText('unknownVariable();', { filePath: 'src/fixture.js' });
  assert.equal(result.errorCount, 1);
  assert.equal(result.messages[0].ruleId, 'no-undef');
  assert.equal(await lint.isPathIgnored('node_modules/ignored.js'), true);
});
test('NFT preserves public glob tracing with glob 14', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nft-contract-'));
  try {
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets/en.json'), '{}');
    fs.writeFileSync(path.join(dir, 'assets/fr.json'), '{}');
    fs.writeFileSync(
      path.join(dir, 'entry.cjs'),
      `const fs=require('fs'); const path=require('path'); module.exports=name=>fs.readFileSync(path.join(__dirname,'assets',name+'.json'),'utf8');`
    );
    const { nodeFileTrace } = require('@vercel/nft');
    const { fileList } = await nodeFileTrace([path.join(dir, 'entry.cjs')], {
      base: dir,
      processCwd: dir
    });
    assert.equal(fileList.has('assets/en.json'), true);
    assert.equal(fileList.has('assets/fr.json'), true);
    const nftRequire = createRequire(require.resolve('@vercel/nft'));
    assert.equal(nftRequire('glob/package.json').version, '14.0.3');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('Workflow native public APIs and SvelteKit integration load without credentials', async () => {
  const api = await import('workflow/api');
  const plugin = await import('workflow/sveltekit');
  assert.equal(typeof api.start, 'function');
  assert.equal(typeof api.getRun, 'function');
  assert.equal(typeof api.getHookByToken, 'function');
  assert.equal(typeof plugin.workflowPlugin, 'function');
});

test('explicit environment manifest preserves public and private boundaries', async () => {
  const { variables } = await import('../../src/env.js');
  const example = fs.readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  const expected = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]).sort();
  assert.deepEqual(Object.keys(variables).sort(), expected);
  for (const [name, config] of Object.entries(variables)) {
    assert.equal(Boolean(config.public), name.startsWith('PUBLIC_'));
    assert.deepEqual(config.schema['~standard'].validate(undefined), { value: '' });
  }
});

test('Svelte TypeScript props parse through the configured language parser', async () => {
  const { ESLint } = await import('eslint');
  const lint = new ESLint({ cwd: path.resolve(import.meta.dirname, '../..') });
  const [result] = await lint.lintText(
    '<script lang="ts">let { label }: { label: string } = $props();</script><p>{label}</p>',
    { filePath: 'src/lib/components/DependencyParserFixture.svelte' }
  );
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
});
