import { renderGitHubDocument } from './github-document.js';
import { providerHTTP, rateAware, selectedResources } from './http.js';
const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' };
/** @param {{fetchImpl?:typeof fetch}} options */
export function createGitHub({ fetchImpl = fetch } = {}) {
  /** @param {any} credential @param {number} deadline */
  const http = (credential, deadline) =>
    providerHTTP({ base: 'https://api.github.com/', credential, headers, fetchImpl, deadline });
  /** @param {any} input */
  async function listResources({ credential, cursor = null, deadline = Date.now() + 10000 }) {
    const path = credential.kind === 'github_app' ? 'installation/repositories' : 'user/repos';
    const page = cursor ?? '1';
    if (!/^\d+$/.test(page)) throw new Error('Invalid page');
    const r = await http(credential, deadline)(`${path}?per_page=100&page=${page}`);
    const repos = r.data.repositories ?? r.data;
    return {
      resources: repos.map((/** @type {any} */ r) => ({
        id: r.full_name,
        name: r.full_name,
        kind: 'repository'
      })),
      nextCursor: r.headers.get('link')?.includes('rel="next"') ? String(Number(page) + 1) : null
    };
  }
  /** @param {any} input */
  async function readPage({ connection, credential, checkpoint, deadline }) {
    return rateAware(async () => {
      const resources = selectedResources(connection),
        cp = checkpoint ?? {},
        index = cp.index ?? 0,
        repo = resources[index % resources.length];
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))
        throw new Error('Invalid selected repository');
      const phase = cp.phase ?? 'issues',
        path = `/repos/${repo}/${phase === 'comments' ? 'issues/comments' : 'issues'}`;
      const since = new Date(
        Date.parse(cp.since ?? connection.config.backfillSince) - 120000
      ).toISOString();
      const cycleStart = cp.cycleStart ?? new Date().toISOString();
      const q = new URLSearchParams({
        since,
        per_page: '30',
        sort: 'updated',
        direction: 'asc',
        ...(phase === 'issues' ? { state: 'all' } : {})
      });
      const url = new URL(cp.next ?? path + '?' + q, 'https://api.github.com');
      if (url.origin !== 'https://api.github.com' || url.pathname !== path)
        throw new Error('Unselected pagination target');
      const r = await http(credential, deadline)(url.href);
      const match = r.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/);
      const next = match?.[1] ?? null;
      if (next) {
        const target = new URL(next);
        if (target.origin !== url.origin || target.pathname !== path)
          throw new Error('Unselected pagination target');
      }
      const changes = r.data.map((/** @type {any} */ item) => ({
        id: `${repo}:${phase}:${item.id}`,
        version: item.updated_at,
        timestamp: item.updated_at,
        operation: 'upsert',
        payload: {
          kind: phase === 'comments' ? 'comment' : item.pull_request ? 'pull_request' : 'issue',
          repository: repo,
          id: item.id,
          number: item.number,
          title: item.title,
          body: item.body,
          state: item.state,
          url: item.html_url,
          issue_url: item.issue_url,
          user: item.user?.login
        },
        files: [
          {
            name: phase === 'comments' ? 'comment.md' : 'issue.md',
            content: renderGitHubDocument(repo, phase, item),
            contentType: 'text/markdown'
          }
        ]
      }));
      const nextPhase = next ? phase : phase === 'issues' ? 'comments' : 'issues';
      const nextIndex = next || phase === 'issues' ? index : (index + 1) % resources.length;
      const final = !next && phase === 'comments' && nextIndex === 0;
      return {
        changes,
        candidateCheckpoint: {
          index: nextIndex,
          phase: nextPhase,
          next,
          since: final ? cycleStart : cp.since,
          cycleStart: final ? null : cycleStart
        },
        continuation: !final
      };
    });
  }
  return {
    listResources,
    readPage,
    validate: async (/** @type {any} */ credential) => {
      if (credential.kind === 'github_app') {
        await listResources({ credential });
        return { accountId: 'installation:' + credential.installationId };
      }
      const { data } = await http(credential, Date.now() + 10000)('user');
      return { accountId: String(data.id) };
    }
  };
}
export const github = createGitHub();
