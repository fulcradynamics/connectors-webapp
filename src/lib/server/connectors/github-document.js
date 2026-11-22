/** A bounded source envelope precedes all untrusted provider title/body text. */
const integer = (/** @type {any} */ value) =>
  (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) ||
  (typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value));
/** @param {string} repository @param {string} phase @param {any} item */
export function githubProvenance(repository, phase, item) {
  if (
    repository.length > 200 ||
    repository.split('/').some((x) => x === '.' || x === '..') ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    !['issues', 'comments'].includes(phase) ||
    !integer(item.id)
  )
    throw Error('Invalid GitHub source identity');
  const kind = phase === 'comments' ? 'comment' : item.pull_request ? 'pull_request' : 'issue';
  let source;
  if (phase === 'issues') {
    if (!integer(item.number)) throw Error('Invalid GitHub issue number');
    source = `https://github.com/${repository}/${kind === 'pull_request' ? 'pull' : 'issues'}/${item.number}`;
  } else {
    // A REST comment ID always identifies one canonical API resource, even when
    // an older projection lacks its parent issue URL. Never use a foreign URL.
    source = `https://api.github.com/repos/${repository}/issues/comments/${item.id}`;
    let parent;
    try {
      const api = new URL(item.issue_url);
      const base = `/repos/${repository}/issues/`;
      if (
        api.origin === 'https://api.github.com' &&
        !api.username &&
        !api.password &&
        !api.search &&
        !api.hash &&
        api.pathname.startsWith(base) &&
        integer(api.pathname.slice(base.length))
      )
        parent = api.pathname.slice(base.length);
    } catch {
      /* Canonical API resource remains sufficient provenance. */
    }
    if (parent) {
      source = `https://github.com/${repository}/issues/${parent}#issuecomment-${item.id}`;
      try {
        const html = new URL(item.html_url);
        if (
          html.origin === 'https://github.com' &&
          !html.username &&
          !html.password &&
          !html.search &&
          [`/${repository}/issues/${parent}`, `/${repository}/pull/${parent}`].includes(
            html.pathname
          ) &&
          html.hash === `#issuecomment-${item.id}`
        )
          source = html.href;
      } catch {
        /* Use the independently bound selected-parent URL. */
      }
    }
  }
  const metadata = {
    provider: 'github',
    repository,
    kind,
    source_id: `${repository}:${phase}:${item.id}`,
    source_url: source
  };
  if (Buffer.byteLength(JSON.stringify(metadata)) > 1024)
    throw Error('GitHub provenance exceeds bound');
  return metadata;
}
/** Kept byte-for-byte for guarded historical repair; never infer source from body text.
 * @param {any} item */
export function legacyGitHubDocument(item) {
  return `# ${item.title ?? 'Comment'}\n\n${item.body ?? ''}\n\n${item.html_url ?? ''}`;
}
/** @param {string} repository @param {string} phase @param {any} item */
export function renderGitHubDocument(repository, phase, item) {
  const start = `<!-- fulcra-source/1\n${JSON.stringify(githubProvenance(repository, phase, item))}\n`;
  const end = '\n-->\n\n';
  // The complete first 2 KiB contains metadata only, even for an empty body.
  // A bounded consumer must never receive title/body bytes just to identify scope.
  const padding = 2048 - Buffer.byteLength(start + end);
  if (padding < 0) throw Error('GitHub provenance prefix exceeds bound');
  return start + ' '.repeat(padding) + end + legacyGitHubDocument(item);
}
