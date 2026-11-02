import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deepmerge-source-'));
const [packed] = JSON.parse(
  execFileSync('npm', ['pack', 'deepmerge@4.3.1', '--ignore-scripts', '--json'], {
    cwd: tmp,
    encoding: 'utf8'
  })
);
const upstreamLock = JSON.parse(fs.readFileSync(path.join(root, 'vendor/upstream-deepmerge.json')));
const bytes = fs.readFileSync(path.join(tmp, packed.filename));
if (
  `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}` !== upstreamLock.integrity
)
  throw new Error('Upstream deepmerge integrity mismatch');
execFileSync('tar', ['-xzf', packed.filename], { cwd: tmp });
const source = path.join(tmp, 'package');
const forbidden = `key === '__proto__' || key === 'constructor' || key === 'prototype'`;
for (const f of ['index.js', 'dist/cjs.js', 'dist/umd.js']) {
  let s = fs.readFileSync(path.join(source, f), 'utf8');
  const before = s;
  s = s.replace(
    /function propertyIsUnsafe\(target, key\) \{[\s\S]*?\n[ \t]*\}/,
    `function propertyIsUnsafe(target, key) {\n\tif (${forbidden}) return true;\n\tif (target === null || (typeof target !== 'object' && typeof target !== 'function')) return false;\n\ttry {\n\t\treturn key in target && !(Object.hasOwnProperty.call(target, key) && Object.propertyIsEnumerable.call(target, key));\n\t} catch (_) {\n\t\treturn true;\n\t}\n}`
  );
  s = s.replace(
    'function mergeObject(target, source, options) {',
    `function setOwn(object, key, value) {\n\tObject.defineProperty(object, key, {value: value, writable: true, enumerable: true, configurable: true});\n}\n\nfunction mergeObject(target, source, options) {`
  );
  s = s.replace(
    /getKeys\(target\)\.forEach\(function\(key\) \{/,
    `getKeys(target).forEach(function(key) {\n\t\t\tif (propertyIsUnsafe(target, key)) return;`
  );
  let assignments = 0;
  s = s.replace(/destination\[key\] = ([^\n]+)\n/g, (_, expression) => {
    assignments++;
    return `setOwn(destination, key, ${expression.replace(/;$/, '')})\n`;
  });
  if (assignments !== 3 || s === before || !s.includes('return true;'))
    throw new Error(`Unexpected upstream structure: ${f}`);
  fs.writeFileSync(path.join(source, f), s);
}
const pkgPath = path.join(source, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath));
pkg.name = '@fulcra-security/deepmerge';
pkg.version = '1.0.2';
pkg.description =
  'Reviewed local security backport of deepmerge 4.3.1; see security-review provenance';
pkg.fulcraUpstream = {
  name: 'deepmerge',
  version: '4.3.1',
  advisory: 'GHSA-gcqx-w48m-w2h4',
  integrity: upstreamLock.integrity
};
pkg.files = [
  'index.js',
  'index.d.ts',
  'dist/cjs.js',
  'dist/umd.js',
  'license.txt',
  'readme.md',
  'changelog.md'
];
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
fs.mkdirSync(path.join(root, 'vendor'), { recursive: true });
let [fork] = JSON.parse(
  execFileSync('npm', ['pack', source, '--ignore-scripts', '--json', '--pack-destination', tmp], {
    cwd: root,
    encoding: 'utf8'
  })
);
const artifact = path.join(root, 'vendor', fork.filename);
const rebuilt = path.join(tmp, fork.filename);
if (fs.existsSync(artifact)) {
  // Node/zlib versions can compress identical tar payloads differently. Preserve
  // the committed bytes and lock integrity when the package contents are equal.
  if (!gunzipSync(fs.readFileSync(artifact)).equals(gunzipSync(fs.readFileSync(rebuilt)))) {
    throw new Error('Changed fork contents require a new version and tarball filename');
  }
  fork = JSON.parse(fs.readFileSync(path.join(root, 'vendor/deepmerge-fork.json')));
} else {
  fs.copyFileSync(rebuilt, artifact);
}
fs.rmSync(path.join(root, 'vendor-src/deepmerge'), { recursive: true, force: true });
fs.mkdirSync(path.join(root, 'vendor-src'), { recursive: true });
fs.cpSync(source, path.join(root, 'vendor-src/deepmerge'), {
  recursive: true,
  filter: (file) =>
    !['.editorconfig', '.eslintcache', 'rollup.config.js'].includes(path.basename(file))
});
fs.writeFileSync(
  path.join(root, 'vendor/deepmerge-fork.json'),
  JSON.stringify(fork, null, 2) + '\n'
);
console.log(fork.filename, fork.integrity);
