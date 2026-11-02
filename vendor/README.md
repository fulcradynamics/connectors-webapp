# Dependency security backports

The application keeps Workflow 5.2.3 and uses narrowly scoped dependency overrides to remove current advisories. The lockfile records the exact selected releases. Run `npm audit --audit-level=low` and `npm run test:dependencies` after every dependency update. `npm run test:workflow-dependencies` additionally builds a minimal SvelteKit application and executes a Workflow and step through its loopback Node server without credentials.

## deepmerge

Upstream deepmerge 4.3.1 is the latest published release and has no upstream security fix for [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4). Its returned object can inherit attacker-controlled properties even when the global Object.prototype remains intact. The [source report](https://github.com/TehShrike/deepmerge/issues/273) describes the affected clone and target-copy paths.

The local `@fulcra-security/deepmerge@1.0.2` fork makes a source change while preserving the upstream MIT license:

- Reject `__proto__`, `constructor` and `prototype` keys in source and target loops, independently of the target shape.
- Use own data properties for all destination writes, avoiding inherited setters.
- Reject target keys whose membership inspection throws, while preserving null and primitive target cloning.

The same changes appear in index.js and both distributed builds. Source lives in `vendor-src/deepmerge`; `deepmerge-source.patch` shows the source delta. `upstream-deepmerge.json` pins the original registry tarball and SHA512. `deepmerge-fork.json` records the resulting package contents and integrity. The application installs the checked-in tarball through a direct `deepmerge` development dependency and the `$deepmerge` override, so every consumer resolves the patched code. Audit cannot inspect a local fork's code; the provenance and regression tests provide that evidence.

Rebuild the same package contents from the verified original with:

```sh
node scripts/security/rebuild-deepmerge.mjs
```

Compression can differ between Node/zlib versions even when the extracted tar payload is identical. The rebuild script preserves the committed tarball bytes and integrity when payloads match, and rejects changed contents under an existing version.

Do not reuse the same fork version and filename for changed contents. npm caches local tarballs by spec and may retain previous bytes and integrity. Increment both, regenerate the lockfile, run the regressions and review the source delta. Preserve the MIT license and original provenance.

The tests cover null-prototype targets, poisoned target copies, nested null and undefined clone paths, throwing target proxies, ordinary object and array merges, symbol keys, custom array merging and null target behavior. Tests also check actual consumer resolution and retained minimatch APIs for ESLint, config-array, oclif, Vercel queue, SWC and TypeScript ESTree, NFT dynamic asset tracing with glob, and Workflow public exports.

The Svelte TypeScript language parser is `@typescript-eslint/parser` 8.72.1, whose declared peers support TypeScript 6.0.3 and ESLint 10. Its ESTree consumer uses the same scoped fixed minimatch release. The parser is enabled only for TypeScript Svelte script blocks; a typed `$props()` regression verifies the configuration.

## Scoped registry fixes

- Zod 4.6.7 under its Workflow and Vercel consumers fixes [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5); the first patched release is 4.6.6.
- Undici 7.30.1 under the Workflow local and Vercel worlds replaces their exact 7.30.0 pin and fixes [the content-encoding denial of service](https://github.com/advisories/GHSA-xjj6-f33q-929c) and the associated 7.30.1 security fixes. No Undici major upgrade is needed.
- oclif/core 4.14.0 remains on major 4 and removes its old ejs/jake/filelist dependency chain.
- minimatch 11.0.4 is selected only under its specific consumers; [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) is first fixed in 11.0.1. Versions 9.0.9 and 10.2.6 remain affected. Version 11 removes makeRe, regexp, AST and some internal methods, so consumer contracts verify the retained named minimatch and Minimatch APIs instead of assuming major compatibility.
- glob 14.0.3 is selected only under NFT. [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) is first fixed in 14.0.2; 13.0.6 remains affected. NFT uses the retained public promise API, covered by a dynamic asset trace test.
- SvelteKit 3 fixes the [enhanced form redirect](https://github.com/sveltejs/kit/security/advisories/GHSA-pfhg-q3qv-9q6r) and [prerendered header XSS](https://github.com/sveltejs/kit/security/advisories/GHSA-27mw-82g8-phjj) advisories. Its supported Vite 8 and plugin 7 peers require a flat Vite plugin configuration. The obsolete Kit 2 cookie override has been removed.

No audit exception, vulnerable Workflow downgrade or blanket minimatch/glob override is used. Public registry metadata and advisory ranges were checked on 2026-11-02.
