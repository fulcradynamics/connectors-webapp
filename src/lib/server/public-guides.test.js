import { it, expect } from 'vitest';
import { publicGuides } from './public-guides.js';
it('routes published architecture and provider-limit links to readable guides while preserving anchors', () => {
  const security = publicGuides['security.md'];
  const design = publicGuides['design.md'];
  const architecture = /\[architecture\]\(([^)]+)\)/.exec(security)?.[1];
  const limits = /\[provider limits\]\(([^)]+)\)/.exec(design)?.[1];
  const spec = /\[production hardening design\]\(([^)]+)\)/.exec(design)?.[1];
  if (!architecture || !limits) throw Error('Published guide links missing');
  expect(new URL(architecture, 'https://example.invalid/guides/security.md').pathname).toBe(
    '/guides/design.md'
  );
  expect(new URL(limits, 'https://example.invalid/guides/design.md').href).toBe(
    'https://example.invalid/guides/user.md#connect-a-service'
  );
  expect(spec).toBe(
    'https://github.com/fulcradynamics/connectors-webapp/blob/feat/knowledge-source-discovery/docs/superpowers/specs/2026-11-02-notion-production-hardening.md'
  );
});
