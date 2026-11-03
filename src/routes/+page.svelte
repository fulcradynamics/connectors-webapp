<script>
  const repo = 'https://github.com/fulcradynamics/connectors-webapp';
  const examples = [
    {
      name: 'Attio',
      mark: 'At',
      file: 'attio',
      pattern: 'Typed fields and linked notes',
      detail:
        'Exact People/Companies records with optional approved two-way fields and preserved note revisions.'
    },
    {
      name: 'Granola',
      mark: 'Gr',
      pattern: 'Meetings → context',
      detail: 'Selected meeting notes and transcripts. Learn API-key setup and document imports.',
      file: 'granola'
    },
    {
      name: 'Asana',
      mark: 'As',
      pattern: 'Tasks → changes',
      detail: 'Selected projects and tasks. Learn event cursors and reconciliation.',
      file: 'asana'
    },
    {
      name: 'GitHub',
      mark: 'GH',
      pattern: 'Repositories → activity',
      detail:
        'Issue and pull-request metadata and issue comments. Learn pagination and signed event hints.',
      file: 'github'
    },
    {
      name: 'Notion',
      mark: 'N',
      pattern: 'Pages → documents',
      detail: 'Selected pages and nested blocks. Learn bounded traversal and document assembly.',
      file: 'notion'
    },
    {
      name: 'Slack',
      mark: '#',
      pattern: 'Conversations → history',
      detail:
        'Selected channels and threads. Learn rate limits, replies, and event-assisted updates.',
      file: 'slack'
    },
    {
      name: 'Garmin',
      mark: 'Ga',
      pattern: 'Activities & health → your store',
      detail:
        'Personal API access to selected activities, daily summaries, sleep, heart rate and HRV.',
      file: 'garmin'
    }
  ];
</script>

<svelte:head>
  <title>Fulcra Connectors — automatic data imports</title>
  <meta
    name="description"
    content="Connect tools and services to your Fulcra data store. Automatically import selected data, work with it using your agents, and share it through Fulcra."
  />
</svelte:head>

<div class="landing">
  <a class="skip" href="#main">Skip to content</a>
  <header>
    <a class="brand" href="/" aria-label="Fulcra Connectors home"
      ><span class="symbol">✳</span> Fulcra <span>Connectors</span></a
    >
    <nav aria-label="Main navigation">
      <a href="#examples">Examples</a><a href="/guide">User guide</a><a href="#build"
        >Build & contribute</a
      ><a class="workspace" href="/app">Open workspace ↗</a>
    </nav>
  </header>
  <main id="main">
    <section class="intro-section">
      <h1>Connect tools and services to your <span>Fulcra data store.</span></h1>
      <p class="intro">
        Once you enable a connector, it automatically imports selected data from that service into
        Fulcra. Work with the imported data using any of your agents. Share selected data through
        Fulcra with other users and their agents.
      </p>
      <div class="actions">
        <a class="button primary" href="#get-started">Get the template <span>↓</span></a><a
          class="button secondary"
          href={repo}>Explore the source ↗</a
        >
      </div>
      <p class="quiet">
        Choose the sources, destination folders or data types, and polling interval.
      </p>
      <div
        class="flow"
        aria-label="Selected sources flow through your personal connector app into Fulcra"
      >
        <div>
          <span class="flow-label">01 / Select</span><strong>Your services</strong><small
            >Only the sources you choose</small
          >
        </div>
        <span class="arrow" aria-hidden="true">→</span>
        <div class="personal">
          <span class="flow-label">02 / Connect</span><strong>Your connector app</strong><code
            >your-name.my.fulcra.ai</code
          >
        </div>
        <span class="arrow" aria-hidden="true">→</span>
        <div>
          <span class="flow-label">03 / Keep</span><strong>Your Fulcra</strong><small
            >Folders · v1 data types · or both</small
          >
        </div>
      </div>
    </section>

    <section id="examples">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Learn by example</p>
          <h2>{examples.length} connectors, with setup and source controls.</h2>
        </div>
        <p>Start with one. Reuse the pieces for the next.</p>
      </div>
      <div class="examples">
        {#each examples as example}
          <a class="example" href={`/guides/providers/${example.file}.md`}>
            <div class="example-top">
              <span class="mark" aria-hidden="true">{example.mark}</span><span aria-hidden="true"
                >↗</span
              >
            </div>
            <h3>{example.name}</h3>
            <p class="pattern">{example.pattern}</p>
            <p>{example.detail}</p>
          </a>
        {/each}
      </div>
      <p class="preview-note">
        <span class="dot"></span> Connect the services you use. Each guide covers setup, supported data
        and sync controls.
      </p>
    </section>

    <section id="get-started" class="start">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Make it yours</p>
          <h2>Fork or clone. Then connect.</h2>
        </div>
        <p>The intended home for your instance is your own Fulcra subdomain.</p>
      </div>
      <div class="setup-steps">
        <article>
          <span class="step-number">01</span>
          <h3>Fork or clone</h3>
          <p>
            Fork <a href={repo}>fulcradynamics/connectors-webapp</a> to keep your changes and contribute
            them back. Or clone it for a local checkout.
          </p>
          <p class="notice">
            The source is public and MIT licensed. This site previews
            <a href={`${repo}/pull/5`}
              >Source discovery, Attio and related changes awaiting review</a
            >
            from
            <code>feat/knowledge-source-discovery</code>. Use the command below to reproduce this
            preview;
            <code>main</code> remains the reviewed baseline.
          </p>
          <pre aria-label="Clone and run the preview"><code
              >git clone --branch feat/knowledge-source-discovery \
  https://github.com/fulcradynamics/connectors-webapp.git
cd connectors-webapp
npm ci
npm run dev</code
            ></pre>
          <p class="small">
            Use Node 24 or later. New clones use a minimal login; connecting accounts needs your own
            instance setup.
          </p>
        </article>
        <article>
          <span class="step-number">02</span>
          <h3>Set up your Fulcra home</h3>
          <p>
            Choose your own <code>[subdomain].my.fulcra.ai</code> and deploy through Fulcra using
            the <a href="/guides/setup.md">setup guide</a>. Each instance gets its own owner,
            credentials and configuration.
          </p>
          <p>
            Fulcra stores your imported records and files. The deploy script initializes native
            operational state and background scheduling with your app. It also reuses an
            already-parked namespace and checks its build/runtime settings.
          </p>
          <pre aria-label="Deploy your own instance"><code
              >cp .env.example .env
fulcra-api auth login
node scripts/harness.mjs init
node scripts/init-env.mjs
FULCRA_PROJECT_NAME=your-name \
FULCRA_EXPECTED_DOMAIN=your-name.my.fulcra.ai \
node scripts/deploy.mjs</code
            ></pre>
          <p class="small">
            Install the Fulcra CLI first. Replace <code>your-name</code> with your namespace.
            Preserve private configuration on future deploys; see the
            <a href="/guides/setup.md">full setup and recovery instructions</a>.
          </p>
          <p class="notice">
            No separate database account or cron setup is needed for the native backend. See the <a
              href="/guides/hosting-and-storage.md">hosting guide</a
            > for deployment and recovery instructions.
          </p>
        </article>
        <article>
          <span class="step-number">03</span>
          <h3>Use your instance</h3>
          <p>
            Open <code>/app</code> on your deployment and sign in as its owner. Authorize background access,
            connect a service, and select a small set of sources.
          </p>
          <p>
            Choose a Fulcra folder, a compatible v1 data type, or both. Review a bounded preview
            before enabling collection.
          </p>
          <p>
            Check the first import and an update in Fulcra. Use the workspace to pause, retry, or
            disconnect. Nothing starts collecting just because you cloned the app.
          </p>
          <a class="text-link" href="/app">Open this instance’s workspace ↗</a>
        </article>
      </div>
    </section>

    <section id="knowledge" class="build">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Optional add-on</p>
          <h2>Turn connected sources into company knowledge.</h2>
        </div>
      </div>
      <p class="guide-entry">
        The Company Knowledge Skill helps your agent find the right source, understand who maintains
        it, and check gaps or stale information. It works with accounts already connected to Fulcra,
        and can also discover this app’s folders and verified indexes. Each works on its own;
        together they use associated source pointers.
      </p>
      <div class="build-grid">
        <article>
          <h3>Add the knowledge skill</h3>
          <p>
            Install <a
              href="https://github.com/ashfulcra/fulcra-tools/tree/main/skills/map-our-team"
              >map-our-team from Fulcra Tools</a
            > in your agent, then ask it to map your authorized company sources.
          </p>
          <pre aria-label="Install the optional Company Knowledge Skill"><code
              >npx skills add ashfulcra/fulcra-tools --skill map-our-team</code
            ></pre>
          <p>
            It adopts verified source pointers into a steward-owned team map. You can use it without
            deploying this connector app; no duplicate import or new access grant is implied.
          </p>
          <a class="text-link" href="/guides/knowledge-sources.md"
            >How storage and source discovery work ↗</a
          >
        </article>
        <article>
          <h3>Automatic sync, optional reasoning</h3>
          <p>
            Connectors keep collecting and updating their navigation indexes without an agent. The
            skill adds source-aware research and synthesis; it does not edit connector state or
            write summaries back into two-way working documents.
          </p>
          <p>
            Consolidating useful knowledge is sometimes called “dreaming.” Use a scheduled task in
            Codex or Claude with the knowledge skill. Each installer chooses the sources, output,
            one writer and cadence; installing the skill starts no schedule.
          </p>
          <a class="text-link" href="/guides/knowledge-maintenance.md"
            >Set up scheduled knowledge maintenance ↗</a
          >
        </article>
      </div>
    </section>

    <section id="build" class="build">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Extend the collection</p>
          <h2>Build a connector.<br />Give the next person a head start.</h2>
        </div>
      </div>
      <p class="guide-entry">
        Start with the <a href="/guide">user guide</a> or give your coding agent the
        <a href="/guides/agent.md">agent instructions (Markdown)</a>. All seven adapters are
        implemented in the template; run their synthetic fixtures with
        <code>npm run test:examples</code>.
      </p>
      <div class="build-grid">
        <article>
          <h3>Build a connector</h3>
          <ol>
            <li>
              Pick the closest example and read the <a href="/guides/adding-a-connector.md"
                >adapter contract</a
              >.
            </li>
            <li>
              Implement credential validation, source discovery, and bounded reads. Register the
              adapter in <code>src/lib/server/connectors/index.js</code>.
            </li>
            <li>
              Add fixtures for pagination, changes, rate limits and revoked access. The shared
              runner handles destination writes and checkpoints.
            </li>
            <li>
              Document permissions and limitations, then verify a small real import and update in
              your own Fulcra.
            </li>
          </ol>
          <a class="text-link" href="/guides/adding-a-connector.md">Read the extension guide ↗</a>
        </article>
        <article>
          <h3>Contribute for review</h3>
          <ol>
            <li>
              Keep your connector on a branch in your fork. Leave credentials and private source
              data out of Git.
            </li>
            <li>
              Run <code>npm test</code>, <code>npm run test:bootstrap</code>,
              <code>npm run check</code>
              and <code>npm run build</code>. Run isolated database tests if you change the runner.
            </li>
            <li>
              Open a pull request to the main project’s <code>main</code> branch for review.
            </li>
            <li>
              Include setup instructions, test evidence and known limits. Fulcra organization
              members review and merge connectors before they join the template.
            </li>
          </ol>
          <a class="text-link" href="/guides/contributing.md">Read the contribution guide ↗</a>
        </article>
      </div>
    </section>
    <section class="closing">
      <h2>Your data should be yours.</h2>
      <p>
        Fulcra is the home for all of your data, under your control, accessible to the agents and
        collaborators you choose.
      </p>
      <p>
        Structured imports go into v1 data types. Documents go into folders. Your connector app
        brings them together, under your account, on a schedule you control.
      </p>
      <a class="button primary" href="#get-started">Start with the template ↑</a>
    </section>
  </main>
  <footer>
    <a class="brand" href="/">Fulcra <span>Connectors</span></a>
    <div>
      <a href={repo}>Source ↗</a><a href="/guides/contributing.md">Contribute ↗</a><a
        href="https://docs.fulcradynamics.com">Fulcra docs ↗</a
      ><a href="/login">Owner sign in</a>
    </div>
  </footer>
</div>

<style>
  .landing {
    margin: -12px;
    background: #14171a;
    color: #f2f4f1;
    font-family: Inter, system-ui, sans-serif;
    line-height: 1.6;
    --muted: #acb6b8;
    --teal: #9ce6ca;
  }
  a {
    color: inherit;
    text-decoration: none;
  }
  a:focus-visible {
    outline: 2px solid var(--teal);
    outline-offset: 5px;
  }
  a:hover {
    color: var(--teal);
  }
  header,
  main,
  footer {
    max-width: 1240px;
    margin: auto;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 24px;
    padding: 28px 40px;
    border-bottom: 1px solid #ffffff15;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 18px;
    font-weight: 700;
    white-space: nowrap;
  }
  .brand > span:not(.symbol) {
    font-weight: 400;
    color: var(--muted);
  }
  .symbol {
    color: var(--teal);
    font-size: 30px;
    margin-right: 5px;
  }
  nav {
    display: flex;
    gap: 28px;
    align-items: center;
    font-size: 13px;
  }
  .workspace {
    border: 1px solid #ffffff40;
    border-radius: 6px;
    padding: 9px 14px;
  }
  .skip {
    position: absolute;
    top: -80px;
    background: #14171a;
    padding: 10px;
    z-index: 30;
  }
  .skip:focus {
    top: 0;
  }
  section {
    padding: 76px 40px;
    border-bottom: 1px solid #ffffff15;
    scroll-margin-top: 20px;
  }
  .intro-section {
    padding-top: 90px;
  }
  .eyebrow {
    font:
      600 11px/1.5 ui-monospace,
      monospace;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--teal);
    margin: 0 0 22px;
  }
  h1 {
    font-size: clamp(40px, 5.5vw, 68px);
    max-width: 950px;
    font-weight: 550;
    letter-spacing: -0.055em;
    line-height: 1.05;
    margin: 0 0 28px;
  }
  h1 > span {
    color: var(--teal);
  }
  .intro {
    max-width: 720px;
    font-size: 19px;
    line-height: 1.65;
    color: #c1cbcc;
    margin-bottom: 28px;
  }
  .actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 28px;
    padding: 13px 20px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
  }
  .primary {
    background: var(--teal);
    color: #142b23;
  }
  .primary:hover {
    background: #bcf4de;
    color: #142b23;
  }
  .secondary {
    border: 1px solid #ffffff35;
  }
  .quiet {
    font-size: 12px;
    color: var(--muted);
    margin: 20px 0 0;
  }
  .flow {
    display: grid;
    grid-template-columns: 1fr 36px 1.2fr 36px 1fr;
    align-items: center;
    margin-top: 66px;
    gap: 14px;
  }
  .flow > div {
    display: flex;
    flex-direction: column;
    padding: 24px;
    border: 1px solid #ffffff20;
    border-radius: 8px;
    gap: 7px;
  }
  .flow .personal {
    border-color: #9ce6ca65;
    background: #9ce6ca08;
  }
  .flow-label {
    color: var(--teal);
    font:
      10px ui-monospace,
      monospace;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .flow strong {
    font-size: 18px;
    font-weight: 550;
  }
  .flow small,
  .flow code {
    font-size: 12px;
    color: var(--muted);
  }
  .arrow {
    text-align: center;
    color: #778783;
  }
  .section-heading {
    display: flex;
    justify-content: space-between;
    gap: 32px;
    align-items: end;
    margin-bottom: 30px;
  }
  h2 {
    font-size: clamp(27px, 3vw, 37px);
    font-weight: 500;
    line-height: 1.2;
    letter-spacing: -0.035em;
    margin: 0;
  }
  .section-heading > p {
    color: var(--muted);
    font-size: 14px;
    max-width: 230px;
  }
  .examples {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 12px;
  }
  .example {
    border: 1px solid #ffffff20;
    border-radius: 8px;
    padding: 20px 16px;
    transition: border-color 0.2s;
  }
  .example:hover {
    border-color: var(--teal);
    color: inherit;
  }
  .example-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--muted);
    margin-bottom: 28px;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    background: #ffffff0c;
    border: 1px solid #ffffff18;
    border-radius: 9px;
    color: #e4eee9;
    font-size: 16px;
    font-weight: 600;
  }
  h3 {
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.02em;
    margin: 0 0 12px;
  }
  .example h3 {
    margin-bottom: 6px;
  }
  .example .pattern {
    font-size: 11px;
    color: var(--teal);
    margin-bottom: 12px;
  }
  .example p {
    font-size: 12px;
    color: var(--muted);
  }
  .preview-note {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-size: 12px;
    color: var(--muted);
    margin-top: 20px;
  }
  .dot {
    display: inline-block;
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #e5bf83;
  }
  .setup-steps {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 30px;
  }
  .setup-steps article {
    min-width: 0;
  }
  .step-number {
    display: block;
    color: var(--teal);
    font:
      12px ui-monospace,
      monospace;
    border-top: 1px solid #ffffff28;
    padding-top: 20px;
    margin-bottom: 18px;
  }
  .setup-steps p,
  .build-grid li {
    font-size: 14px;
    color: #b9c3c4;
    margin: 0 0 16px;
  }
  .setup-steps a,
  .build-grid li a {
    color: var(--teal);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  code {
    font:
      12px/1.6 ui-monospace,
      monospace;
    overflow-wrap: anywhere;
  }
  pre {
    font-size: 11px;
    overflow: auto;
    background: #0d1012;
    padding: 16px;
    border: 1px solid #ffffff15;
    border-radius: 6px;
    margin: 18px 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  pre code {
    font-size: 11px;
  }
  .setup-steps .notice {
    border-left: 2px solid #a9c0b8;
    padding-left: 12px;
    font-size: 12px;
    color: #a9b8b3;
  }
  .setup-steps .small {
    font-size: 12px;
    color: var(--muted);
  }
  .text-link {
    display: inline-block;
    margin-top: 10px;
    color: var(--teal);
    font-size: 13px;
  }
  .guide-entry {
    margin: 24px 0;
    color: var(--muted);
    font-size: 14px;
  }
  .guide-entry a {
    color: var(--teal);
    text-decoration: underline;
  }
  .build-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 70px;
  }
  .build-grid article {
    border-top: 1px solid #ffffff28;
    padding-top: 26px;
  }
  .build-grid ol {
    padding-left: 20px;
    list-style: decimal;
  }
  .build-grid li {
    padding-left: 8px;
    margin-bottom: 18px;
  }
  .closing {
    text-align: center;
    background: radial-gradient(ellipse at bottom, #9ce6ca12, transparent 70%);
  }
  .closing p:not(.eyebrow) {
    max-width: 560px;
    margin: 22px auto 28px;
    color: var(--muted);
    font-size: 16px;
  }
  footer {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    padding: 32px 40px;
  }
  footer > div {
    display: flex;
    gap: 22px;
    align-items: center;
    font-size: 12px;
    color: var(--muted);
  }
  @media (max-width: 1000px) {
    .examples {
      grid-template-columns: repeat(3, 1fr);
    }
    .setup-steps {
      grid-template-columns: 1fr;
      gap: 30px;
    }
    .setup-steps article {
      display: block;
    }
    .flow {
      gap: 8px;
    }
    .flow > div {
      padding: 18px;
    }
    .flow strong {
      font-size: 15px;
    }
    nav {
      gap: 16px;
    }
  }
  @media (max-width: 650px) {
    header {
      padding: 18px 20px;
      align-items: start;
      gap: 20px;
      flex-direction: column;
    }
    nav {
      width: 100%;
      justify-content: space-between;
      gap: 8px;
      font-size: 11px;
    }
    .workspace {
      padding: 6px 10px;
    }
    .brand {
      font-size: 16px;
    }
    section {
      padding: 48px 20px;
    }
    .intro-section {
      padding-top: 48px;
    }
    .intro {
      font-size: 17px;
    }
    .flow {
      grid-template-columns: 1fr;
      margin-top: 40px;
      gap: 8px;
    }
    .flow > div {
      padding: 16px;
    }
    .arrow {
      transform: rotate(90deg);
      line-height: 1;
    }
    .section-heading {
      display: block;
    }
    .section-heading > p {
      max-width: none;
      margin-top: 16px;
    }
    .examples {
      grid-template-columns: 1fr 1fr;
    }
    .example {
      padding: 16px;
    }
    .example-top {
      margin-bottom: 20px;
    }
    .build-grid {
      grid-template-columns: 1fr;
      gap: 35px;
    }
    footer {
      padding: 28px 20px;
      flex-direction: column;
    }
    footer > div {
      flex-wrap: wrap;
      gap: 16px;
    }
    .preview-note {
      line-height: 1.7;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .example {
      transition: none;
    }
  }
</style>
