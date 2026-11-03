import maintenance from '../../../docs/knowledge-maintenance.md?raw';
import knowledge from '../../../docs/knowledge-sources.md?raw';
import security from '../../../SECURITY.md?raw';
import design from '../../../docs/design.md?raw';
import user from '../../../docs/user-guide.md?raw';
import agent from '../../../docs/agent-guide.md?raw';
import adding from '../../../docs/adding-a-connector.md?raw';
import operations from '../../../docs/operations.md?raw';
import setup from '../../../docs/setup.md?raw';
import hosting from '../../../docs/hosting-and-storage.md?raw';
import contributing from '../../../CONTRIBUTING.md?raw';
import granola from '../../../docs/providers/granola.md?raw';
import asana from '../../../docs/providers/asana.md?raw';
import github from '../../../docs/providers/github.md?raw';
import notion from '../../../docs/providers/notion.md?raw';
import attio from '../../../docs/providers/attio.md?raw';
import garmin from '../../../docs/providers/garmin.md?raw';
import slack from '../../../docs/providers/slack.md?raw';
// Deliberate public document allowlist. Never derive a filesystem path from a URL.
/** @type {Record<string,string>} */
const guides = {
  'knowledge-maintenance.md': maintenance,
  'knowledge-sources.md': knowledge,
  'security.md': security,
  'design.md': design,
  'operations.md': operations,
  'user.md': user,
  'agent.md': agent,
  'adding-a-connector.md': adding,
  'setup.md': setup,
  'hosting-and-storage.md': hosting,
  'contributing.md': contributing,
  'providers/granola.md': granola,
  'providers/asana.md': asana,
  'providers/github.md': github,
  'providers/notion.md': notion,
  'providers/attio.md': attio,
  'providers/slack.md': slack,
  'providers/garmin.md': garmin
};

// Keep repository-relative links useful in the explicitly published copies.
const guideLinks = {
  'docs/agent-guide.md': '/guides/agent.md',
  'agent-guide.md': '/guides/agent.md',
  'user-guide.md': '/guides/user.md',
  'docs/design.md': '/guides/design.md',
  'superpowers/specs/2026-11-02-notion-production-hardening.md':
    'https://github.com/fulcradynamics/connectors-webapp/blob/feat/knowledge-source-discovery/docs/superpowers/specs/2026-11-02-notion-production-hardening.md',
  'knowledge-maintenance.md': '/guides/knowledge-maintenance.md',
  'docs/knowledge-maintenance.md': '/guides/knowledge-maintenance.md',
  'knowledge-sources.md': '/guides/knowledge-sources.md',
  'docs/knowledge-sources.md': '/guides/knowledge-sources.md',
  'SECURITY.md': '/guides/security.md',
  '../SECURITY.md': '/guides/security.md',
  '../CONTRIBUTING.md': '/guides/contributing.md',
  'docs/setup.md': '/guides/setup.md',
  'docs/hosting-and-storage.md': '/guides/hosting-and-storage.md',
  'docs/adding-a-connector.md': '/guides/adding-a-connector.md'
};
export const publicGuides = Object.fromEntries(
  Object.entries(guides).map(([name, content]) => [
    name,
    content.replace(/\]\(([^)]+)\)/g, (match, target) => {
      const fragmentAt = target.indexOf('#');
      const path = fragmentAt < 0 ? target : target.slice(0, fragmentAt);
      const fragment = fragmentAt < 0 ? '' : target.slice(fragmentAt);
      return Object.hasOwn(guideLinks, path)
        ? `](${guideLinks[/** @type {keyof typeof guideLinks} */ (path)]}${fragment})`
        : match;
    })
  ])
);
