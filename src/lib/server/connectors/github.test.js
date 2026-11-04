import { it, expect, vi } from 'vitest';
import { createGitHub } from './github.js';
const connection = {
  config: { resources: ['example/repo'], backfillSince: '2026-01-01T00:00:00Z' }
};
/** @param {any} fetchImpl @param {any} checkpoint */
const read = (fetchImpl, checkpoint = null) =>
  createGitHub({ fetchImpl }).readPage({
    connection,
    credential: { token: 'test' },
    checkpoint,
    deadline: Date.now() + 10000
  });
it('normalizes issues versus PRs and follows Link pagination only in the selected repo', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    Response.json(
      [
        { id: 1, number: 1, title: 'Issue', updated_at: '2026-10-01T00:00:00Z' },
        {
          id: 2,
          number: 2,
          title: 'PR',
          pull_request: { url: 'https://api.github.com/repos/example/repo/pulls/2' },
          updated_at: '2026-10-01T00:00:00Z'
        }
      ],
      { headers: { Link: '<https://api.github.com/repos/example/repo/issues?page=2>; rel="next"' } }
    )
  );
  const page = await read(fetchImpl);
  expect(page.changes.map((/** @type {any} */ x) => x.payload.kind)).toEqual([
    'issue',
    'pull_request'
  ]);
  expect(page.candidateCheckpoint.next).toContain('page=2');
  const init = fetchImpl.mock.calls[0][1];
  expect(init.headers['X-GitHub-Api-Version']).toBe('2026-03-10');
  await expect(
    read(async () =>
      Response.json([], {
        headers: { Link: '<https://api.github.com/repos/other/repo/issues?page=2>; rel="next"' }
      })
    )
  ).rejects.toThrow(/pagination/);
});
it('polls changed comments independently with an overlapping update watermark', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    Response.json([
      {
        id: 3,
        body: 'Edited',
        updated_at: '2026-10-01T00:00:00Z',
        issue_url: 'https://api.github.com/repos/example/repo/issues/1'
      }
    ])
  );
  const page = await read(fetchImpl, {
    index: 0,
    phase: 'comments',
    since: '2026-10-01T00:00:00Z'
  });
  expect(String(fetchImpl.mock.calls[0][0])).toContain('/issues/comments?');
  expect(page.changes[0].payload.kind).toBe('comment');
  expect(String(fetchImpl.mock.calls[0][0])).toContain('2026-09-30T23%3A58');
});
it('honors secondary rate limits rather than retrying immediately', async () => {
  const page = await read(
    async () => new Response('{}', { status: 403, headers: { 'Retry-After': '120' } })
  );
  expect(Date.parse(page.retryAt)).toBeGreaterThan(Date.now() + 110000);
});

it('puts bounded issue provenance before hostile or arbitrarily long title/body without changing source identity', async () => {
  const item = {
    id: 77,
    number: 4,
    title: '<!-- fake source -->' + 'T'.repeat(12000),
    body: 'PRIVATE BODY' + 'B'.repeat(80000),
    html_url: 'https://foreign.invalid/evil',
    updated_at: '2026-10-01T00:00:00Z'
  };
  const page = await read(async () => Response.json([item]));
  const c = page.changes[0],
    prefix = c.files[0].content.slice(0, 2048);
  expect(prefix.startsWith('<!-- fulcra-source/1\n')).toBe(true);
  const metadata = JSON.parse(prefix.split('\n')[1]);
  expect(metadata).toEqual({
    provider: 'github',
    repository: 'example/repo',
    kind: 'issue',
    source_id: 'example/repo:issues:77',
    source_url: 'https://github.com/example/repo/issues/4'
  });
  expect(prefix.indexOf('\n-->')).toBeLessThan(2048);
  expect(c.id).toBe('example/repo:issues:77');
  expect(c.version).toBe(item.updated_at);
  expect(c.payload.body).toBe(item.body);
  expect(c.payload.url).toBe(item.html_url);
  expect(c.files[0].content.endsWith(`# ${item.title}\n\n${item.body}\n\n${item.html_url}`)).toBe(
    true
  );
  expect((await read(async () => Response.json([item]))).changes).toEqual(page.changes);
});
it('gives PRs and comments canonical selected-repository provenance before content', async () => {
  const pr = {
    id: 8,
    number: 9,
    title: 'PR',
    body: 'text',
    pull_request: {},
    updated_at: '2026-10-01T00:00:00Z'
  };
  const a = (await read(async () => Response.json([pr]))).changes[0];
  expect(JSON.parse(a.files[0].content.split('\n')[1])).toMatchObject({
    kind: 'pull_request',
    source_url: 'https://github.com/example/repo/pull/9'
  });
  const comment = {
    id: 19,
    body: 'body',
    issue_url: 'https://api.github.com/repos/example/repo/issues/9',
    html_url: 'https://github.com/example/repo/pull/9#issuecomment-19',
    updated_at: pr.updated_at
  };
  const b = (await read(async () => Response.json([comment]), { index: 0, phase: 'comments' }))
    .changes[0];
  expect(JSON.parse(b.files[0].content.split('\n')[1])).toEqual({
    provider: 'github',
    repository: 'example/repo',
    kind: 'comment',
    source_id: 'example/repo:comments:19',
    source_url: comment.html_url
  });
});
it('keeps comment provenance inside the selected repository when provider URLs are foreign', async () => {
  const item = {
    id: 31,
    body: 'body',
    html_url: 'https://foreign.invalid/secret',
    issue_url: 'https://api.github.com/repos/other/repo/issues/2',
    updated_at: '2026-10-01T00:00:00Z'
  };
  const c = (await read(async () => Response.json([item]), { index: 0, phase: 'comments' }))
    .changes[0];
  expect(JSON.parse(c.files[0].content.split('\n')[1]).source_url).toBe(
    'https://api.github.com/repos/example/repo/issues/comments/31'
  );
});
it('keeps the entire first 2 KiB metadata-only so a bounded read cannot expose a short title or body', async () => {
  const item = {
    id: 42,
    number: 1,
    title: 'PRIVATE TITLE',
    body: 'PRIVATE BODY',
    updated_at: '2026-10-01T00:00:00Z'
  };
  const content = (await read(async () => Response.json([item]))).changes[0].files[0].content;
  const prefix = Buffer.from(content).subarray(0, 2048).toString('utf8');
  expect(prefix).not.toContain(item.title);
  expect(prefix).not.toContain(item.body);
  expect(prefix.trimEnd().endsWith('-->')).toBe(true);
  expect(Buffer.from(content).subarray(2048).toString('utf8')).toBe(
    `# ${item.title}\n\n${item.body}\n\n`
  );
});
