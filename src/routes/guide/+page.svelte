<script>
  const providers = [
    {
      id: 'attio',
      name: 'Attio',
      prepare: 'Admin-created workspace token with selected record/optional note scopes',
      select: 'Exact People/Companies records → approved fields and optional linked notes',
      pattern: 'Typed two-way edits, preserved rich notes and sharded indexes'
    },
    {
      id: 'granola',
      name: 'Granola',
      prepare: 'API key from an eligible account + stable source account ID',
      select: 'Folders → notes and transcript artifacts',
      pattern: 'API keys, delayed content and paginated transcripts'
    },
    {
      id: 'asana',
      name: 'Asana',
      prepare: 'Read-capable token + workspace ID',
      select: 'Projects → tasks and task changes',
      pattern: 'Snapshots, event cursors and reconciliation'
    },
    {
      id: 'github',
      name: 'GitHub',
      prepare: 'Read token, or your own App ID + installation ID + private key',
      select: 'Repositories → issues/PR metadata and issue comments',
      pattern: 'Link pagination, installation tokens and signed hints'
    },
    {
      id: 'notion',
      name: 'Notion',
      prepare: 'Read-capable integration token with selected pages connected',
      select: 'Root pages → nested page/block documents',
      pattern: 'Resumable nested traversal and complete documents'
    },
    {
      id: 'slack',
      name: 'Slack',
      prepare: 'Channel read token; suitable user token for threads; optional signing secret',
      select: 'Channels → messages and threads',
      pattern: 'Timestamp identity, rate limits and event-assisted updates'
    },
    {
      id: 'garmin',
      name: 'Garmin',
      prepare: 'A Garmin Personal API key for your own account',
      select: 'Datasets → activities, daily summaries, sleep, heart rate and HRV',
      pattern: 'Short-lived tokens, calendar dates and historical reconciliation'
    }
  ];
  const repo = 'https://github.com/fulcradynamics/connectors-webapp/blob/main';
</script>

<svelte:head
  ><title>User and agent guides — Fulcra Connectors</title><meta
    name="description"
    content="Use the seven implemented connector examples, hand an agent the build instructions, and contribute another connector for review."
  /></svelte:head
>
<div class="guide-page">
  <header><a href="/">← Fulcra Connectors</a><a href="/app">Open workspace ↗</a></header>
  <main>
    <p class="eyebrow">Use it. Extend it. Share it.</p>
    <h1>User guide</h1>
    <p class="lead">
      Seven implemented examples bring selected data into your Fulcra folders, v1 data types, or
      both. Each one includes an adapter, source discovery, preview support and runnable tests.
    </p>
    <div class="guide-actions">
      <a href="/guides/user.md">Full user instructions ↗</a><a href="/guides/agent.md"
        >Agent instructions (Markdown) ↗</a
      ><a href="/guides/adding-a-connector.md">Adapter contract ↗</a>
    </div>
    <aside>
      <strong>Developer preview</strong>
      <p>
        Provider fixtures pass; live account verification is pending. The deployment script
        initializes native backing and scheduling without a separate database account. If your
        workspace says “Setup required,” follow the <a href="/guides/setup.md"
          >current setup guide</a
        >. Use the copyable commands in that guide to create or reuse your namespace, initialize
        fresh private state, and deploy at your own subdomain. The repository is public; anyone can
        fork it and propose a connector.
      </p>
    </aside>
    <section aria-labelledby="use">
      <h2 id="use">Use an example connector</h2>
      <ol>
        <li>
          <strong>Start with your own instance.</strong>
          <a href="/guides/contributing.md">Fork or clone</a>, follow
          <a href="/guides/setup.md">deployment setup</a>, and open <code>/app</code> on your own
          <code>[subdomain].my.fulcra.ai</code>. Sign in as its owner.
        </li>
        <li>
          <strong>Authorize background access.</strong> Under Background sync, choose
          <strong>Authorize Fulcra</strong>, finish verification and check enrollment. Browser
          sign-in and background access are separate.
        </li>
        <li>
          <strong>Connect a service.</strong> Use a provider guide below to prepare its read
          credential. Enter it in your instance’s protected form and choose
          <strong>Verify and continue →</strong>. Never paste credentials into chat or Git.
        </li>
        <li>
          <strong>Select a small source and destination.</strong> Discover sources and choose one
          folder/project/repository/page/channel. Choose a Fulcra folder, a compatible v1 data type,
          or both. Use <strong>Create or reuse connector record type</strong> if you need the shared schema.
        </li>
        <li>
          <strong>Preview before enabling.</strong> Start with a small recent backfill and suitable
          interval. Choose <strong>Save and preview output</strong>, inspect the result, confirm it,
          then choose <strong>Enable background collection</strong>. Preview performs no destination
          writes.
        </li>
        <li>
          <strong>Verify and control it.</strong> Check an imported item and subsequent source update
          in Fulcra, then a scheduled cycle with the browser closed. Use Pause, Retry queued work, Replace
          credentials or Disconnect when needed. Imported history remains; signing out does not disconnect
          background collection.
        </li>
      </ol>
    </section>
    <section aria-labelledby="examples">
      <h2 id="examples">The five implemented connectors</h2>
      <p>
        Each setup guide explains exact supported data and limits. Code and test links require the
        public repository.
      </p>
      <div class="provider-grid">
        {#each providers as provider}<article>
            <h3>{provider.name}</h3>
            <p><strong>Prepare</strong><br />{provider.prepare}</p>
            <p><strong>Select and import</strong><br />{provider.select}</p>
            <p class="pattern">Pattern: {provider.pattern}</p>
            <div class="provider-links">
              <a href={`/guides/providers/${provider.id}.md`}>Setup & limits ↗</a><a
                href={`${repo}/src/lib/server/connectors/${provider.id}.js`}>Adapter code ↗</a
              ><a href={`${repo}/src/lib/server/connectors/${provider.id}.test.js`}>Tests ↗</a>
            </div>
          </article>{/each}
      </div>
      <p>
        Notion database rows/comments and GitHub review comments/files are outside these examples.
        Slack polling alone cannot guarantee old edits/deletions; signed events are needed for those
        guarantees. Read the provider guides before relying on coverage.
      </p>
    </section>
    <section aria-labelledby="build">
      <h2 id="build">Build additional connectors</h2>
      <p>
        Choose the closest example, then follow the <a href="/guides/adding-a-connector.md"
          >extension contract</a
        >
        and <a href="/guides/agent.md">step-by-step agent instructions</a>. The agent guide names
        the actual adapter interface, registration files, credential form, tests, shared runner and
        contribution steps.
      </p>
      <h3>Give your agent a concrete brief</h3>
      <pre><code
          >Add a connector for SERVICE in my connectors-webapp clone.
Read https://connectors.my.fulcra.ai/guides/agent.md and AGENTS.md.
Limit it to SOURCE SCOPE. Use my selected Fulcra v1 type/folder.
Add adapter tests, UI registration and setup instructions.
Keep credentials out of chat/Git. Report live checks separately.
Prepare a contribution for review; leave collection disabled
until I select sources and confirm the preview.</code
        ></pre>
      <p>
        Replace SERVICE and SOURCE SCOPE before sending. You can also follow the same guide yourself
        in your fork.
      </p>
      <h3>Run the example implementations locally</h3>
      <pre><code
          >npm ci
npm run test:examples
npm test
npm run test:bootstrap
npm run check
npm run build</code
        ></pre>
      <p>
        Use Node 24+. Example tests run the real adapters against synthetic responses without
        accounts or a database. They do not establish a verified live integration.
      </p>
    </section>
    <section aria-labelledby="deploy">
      <h2 id="deploy">Deployment is included</h2>
      <p>
        Follow the <a href="/guides/setup.md">copyable setup commands</a> to deploy at your own
        Fulcra namespace. The app initializes native state and background scheduling; no separate
        database or cron account is required. The same hosting helper is submitted to the
        <a href="https://github.com/fulcradynamics/agent-skills/pull/245">base skill</a>
        and
        <a href="https://github.com/fulcradynamics/app-template-svelte/pull/9">Svelte starter</a> for
        upstream review.
      </p>
    </section>
    <section aria-labelledby="contribute">
      <h2 id="contribute">Contribute for review</h2>
      <p>
        Keep your changes on a branch in your fork. Add fixtures and a provider guide, run the
        checks, and open a pull request to the main project. During the preview target <code
          >feat/connector-template</code
        >
        for implementation-dependent changes; after release target <code>main</code>.
      </p>
      <p>
        Include actual test results, setup steps, supported data, known limits and live checks
        performed or still missing. Maintainers review connectors before inclusion. Existing
        personal deployments choose when to adopt updates.
      </p>
      <a href="/guides/contributing.md">Read the contribution checklist ↗</a>
    </section>
  </main>
  <footer>
    <a href="/">Template home</a><a href="/guides/user.md">User Markdown</a><a
      href="/guides/agent.md">Agent Markdown</a
    >
  </footer>
</div>

<style>
  .guide-page {
    margin: -12px;
    background: #14171a;
    color: #edf2ef;
    font-family: Inter, system-ui, sans-serif;
    line-height: 1.7;
    min-height: 100vh;
  }
  header,
  main,
  footer {
    max-width: 1100px;
    margin: auto;
    padding: 28px 36px;
  }
  header,
  footer {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    font-size: 13px;
  }
  header {
    border-bottom: 1px solid #ffffff20;
  }
  main {
    padding-top: 65px;
  }
  a {
    color: #9ce6ca;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  a:focus-visible {
    outline: 2px solid #9ce6ca;
    outline-offset: 4px;
  }
  .eyebrow {
    font:
      11px ui-monospace,
      monospace;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: #9ce6ca;
  }
  h1 {
    font-size: 52px;
    letter-spacing: -0.05em;
    font-weight: 550;
    line-height: 1.2;
    margin: 18px 0;
  }
  h2 {
    font-size: 28px;
    line-height: 1.3;
    letter-spacing: -0.025em;
    font-weight: 550;
    margin: 0 0 22px;
  }
  h3 {
    font-size: 19px;
    font-weight: 600;
    margin: 20px 0 12px;
  }
  p,
  li {
    color: #bdc8c6;
    font-size: 15px;
  }
  p {
    margin: 0 0 18px;
  }
  .lead {
    font-size: 19px;
    max-width: 750px;
  }
  .guide-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 14px 26px;
    margin: 28px 0;
    font-size: 14px;
  }
  aside {
    border: 1px solid #9ce6ca50;
    border-radius: 8px;
    padding: 22px;
    background: #9ce6ca08;
  }
  aside p {
    font-size: 13px;
    margin: 8px 0 0;
  }
  section {
    padding: 46px 0;
    border-bottom: 1px solid #ffffff20;
  }
  ol {
    list-style: decimal;
    padding-left: 24px;
  }
  li {
    padding-left: 8px;
    margin-bottom: 20px;
  }
  strong {
    color: #eef5f1;
  }
  code {
    font:
      12px/1.7 ui-monospace,
      monospace;
    overflow-wrap: anywhere;
  }
  pre {
    background: #0c1012;
    border: 1px solid #ffffff20;
    border-radius: 8px;
    padding: 20px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 18px 0;
  }
  .provider-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    margin: 24px 0;
  }
  .provider-grid article {
    border: 1px solid #ffffff25;
    border-radius: 8px;
    padding: 22px;
  }
  .provider-grid h3 {
    margin-top: 0;
  }
  .provider-grid p {
    font-size: 13px;
  }
  .pattern {
    color: #9ce6ca;
  }
  .provider-links {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    font-size: 12px;
  }
  footer {
    flex-wrap: wrap;
    justify-content: start;
    gap: 24px;
    padding-bottom: 40px;
  }
  @media (max-width: 650px) {
    header,
    main,
    footer {
      padding-left: 20px;
      padding-right: 20px;
    }
    main {
      padding-top: 40px;
    }
    h1 {
      font-size: 40px;
    }
    .provider-grid {
      grid-template-columns: 1fr;
    }
    .lead {
      font-size: 17px;
    }
    header {
      font-size: 12px;
    }
    h2 {
      font-size: 25px;
    }
  }
</style>
