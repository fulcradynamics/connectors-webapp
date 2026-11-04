# Fulcra Connectors

Connect third-party tools and services directly to your Fulcra data store. Work with that data using your agents, and share selected data through Fulcra with other users and their agents.

Services you enable here feed your store automatically. You choose the sources, destination, history window and sync frequency. Each copy runs in its owner's Fulcra namespace with its own authentication, credentials and state.

Collection and generated indexes run without an agent. Each instance also publishes a bounded source-discovery manifest so separately installed knowledge tools can find its existing outputs. Read [storage, discovery and knowledge ownership](docs/knowledge-sources.md).

Source: [fulcradynamics/connectors-webapp](https://github.com/fulcradynamics/connectors-webapp). Anyone can fork and submit a PR; Fulcra organization members maintain and merge reviewed changes.

Start with the [reference app](https://connectors.my.fulcra.ai), or fork this repo and deploy at `your-name.my.fulcra.ai`.

For a team, use a new company-owned Fulcra account for company imports and the knowledge map; members can keep independent personal connectors and share selected contributions back. Follow [company and member onboarding](docs/company-onboarding.md) for copyable prompts, provider permissions and output audiences, alongside [Fulcra Tools first-time setup](https://github.com/ashfulcra/fulcra-tools/blob/main/docs/team-knowledge-setup.md). Each deployment still has one verified owner; sharing output does not grant app administration or provider writeback.

## What it connects

| Connector | Imported data                             | Example pattern                                      |
| --------- | ----------------------------------------- | ---------------------------------------------------- |
| Garmin    | Selected activities and daily health JSON | Personal key renewal, local dates and reconciliation |
| Granola   | Selected meeting notes and transcripts    | API keys, delayed content, transcript pagination     |
| Asana     | Selected projects' tasks and changes      | Event cursors and periodic reconciliation            |
| GitHub    | Issues, PR metadata and issue comments    | Repository selection, pagination, token/App auth     |
| Notion    | Selected pages and nested blocks          | Resumable document traversal                         |
| Attio     | Exact People/Companies fields and notes   | Approved typed edits and linked note revisions       |
| Slack     | Selected messages and threads             | History cursors, rate limits, signed event hints     |

These are working example adapters with synthetic tests, not promises to mirror every feature of each service. Read each [provider guide](docs/user-guide.md#connect-a-service) for supported data, permissions and limits. Google connectors are outside the current examples.

## Deploy your copy

Use Node.js 24 and the [Fulcra CLI](https://pypi.org/project/fulcra-api/).

The hosted template currently previews [PR #5](https://github.com/fulcradynamics/connectors-webapp/pull/5) on `feat/knowledge-source-discovery`, including source discovery and the Attio/Notion/runtime changes from PR #4. Attio is not yet on `main`; `main` remains the reviewed baseline. The command below reproduces the hosted preview. Fork the repository or set your own fork as the push destination to keep and contribute your changes. A fork containing only `main` must fetch this preview branch from upstream first.

```sh
git clone --branch feat/knowledge-source-discovery https://github.com/fulcradynamics/connectors-webapp.git
cd connectors-webapp
npm ci
fulcra-api auth login
cp .env.example .env
node scripts/harness.mjs init
node scripts/init-env.mjs
FULCRA_PROJECT_NAME=your-name FULCRA_EXPECTED_DOMAIN=your-name.my.fulcra.ai node scripts/deploy.mjs
```

Fork on GitHub first, then use your fork's URL. The deploy command handles native background state and scheduling through Fulcra's hosting. You do not need a separate database, cron service or Vercel account. Read [setup and recovery](docs/setup.md) before deploying or updating an existing app.

Sign in at `/login`, open `/app`, allow background access, and connect a service. Each connector has direct credential-creation links and setup steps. Select sources, choose a folder and/or v1 data type, set the schedule, and review the preview before enabling it. Default proposals are every 5 minutes, seven days of initial history (30 days for Attio notes) and files under `/connectors/SERVICE`; nothing starts automatically.

## Use it, change it, contribute

- [User guide](docs/user-guide.md): credentials, destinations, schedules and controls.
- [Agent instructions](docs/agent-guide.md) and [AGENTS.md](AGENTS.md): how to work on this code safely.
- [Add a connector](docs/adding-a-connector.md): the adapter and onboarding contract.
- [Contribute](CONTRIBUTING.md): send a PR for review.
- [Operations](docs/operations.md) and [architecture](docs/design.md): state, recovery and limits.
- [Security](SECURITY.md): storage boundaries and private vulnerability reports.

New connectors should follow the examples, including the user controls and credential links. Agents should read the instructions before making changes. Contributions are reviewed before inclusion; updates do not silently deploy to personal copies.

## Check your changes

For a fresh local checkout, first copy `.env.example` to `.env`. Keep an existing instance environment intact; tests need no real provider credentials.

```sh
npm test
npm run test:bootstrap
npm run check
npm run build
```

`npm run test:examples` runs only the seven adapters. Tests use synthetic data; they do not require provider credentials. Browser checks and the optional PostgreSQL test path are documented in [contributing](CONTRIBUTING.md).

MIT licensed. Based on the [Fulcra Svelte app starter](https://github.com/fulcradynamics/app-template-svelte) and [Fulcra app-building skill](https://github.com/fulcradynamics/agent-skills).

Use the optional [scheduled knowledge-maintenance recipe](docs/knowledge-maintenance.md) to run the skill in Codex or Claude. It is a per-installation setup pattern; it creates no personal automation or model service.
