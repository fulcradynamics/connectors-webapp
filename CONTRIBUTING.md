# Contributing

Fork the repo, branch from `main`, make a focused change, and open a PR.

```sh
git clone https://github.com/YOUR-ACCOUNT/connectors-webapp.git
cd connectors-webapp
npm ci
cp .env.example .env # first setup only; preserve an existing .env
git switch -c connector/your-service
```

For a new service, follow [the adapter guide](docs/agent-guide.md) and [extension checklist](docs/adding-a-connector.md). Include direct credential-creation links and separate help on new/replacement/saved views, minimum permissions, source selection, destination/v1 type, schedule/history and preview/enable controls. Document native-only credential creation explicitly.

## Checks

```sh
npm test
npm run test:bootstrap
npm run check
npm run build
node scripts/check-release.mjs
```

Install Gitleaks 8.30.1+ and run `gitleaks git . --log-opts=--all --redact`. CI checks history, privacy, dependencies, types, build and tests with no production credentials.

For browser checks, install Playwright outside this repo or locally without changing the lockfile. Run `node scripts/check-walkthrough.mjs` and `node scripts/check-background-auth.mjs`. Set `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_EXECUTABLE_PATH` if using an existing installation. They start isolated app/identity servers and synthetic API responses. Do not build or edit watched files concurrently with a browser check.

Auth/routing changes should also run `node scripts/check-public.mjs` and `node scripts/check-personal.mjs`. PostgreSQL changes require `npm run test:db` with an explicitly isolated `TEST_DATABASE_URL`. Never point tests at production.

## PRs

Explain what changes for users, exact supported data, source boundaries, scopes/tier requirements, tests performed and remaining limits. Use synthetic or sanitized fixtures. Report actual selected-source/import/update/readback checks separately from fixture coverage. A passing fixture does not establish a live provider journey.

No secrets, private account data, meeting links, personal deployment IDs or build diaries in source, screenshots or PR text. Report vulnerabilities privately using [the security policy](SECURITY.md). Fulcra organization members review and merge PRs after required checks; users choose when to update their own deployments.

Contributions are under the project's MIT license.
