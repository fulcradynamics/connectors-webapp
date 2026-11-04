# Deploy an account-owned connector app

Use your own Fulcra account and namespace. Each deployment has independent credentials, encryption keys and operational state. Native Workflow persistence/scheduling is bundled through Fulcra hosting; a separate database, cron or Vercel account is not required.

The owner can be a personal account or a new company-owned account. For a team, start with [company and member onboarding](company-onboarding.md) and verify which account will own the deployment before authenticating. Members read approved company outputs through Fulcra shares; the app currently has no multi-user administration. Set up member instances separately rather than copying company secrets.

## Install the tools first

Use [Git](https://git-scm.com/downloads/), [Node.js 24 with npm](https://nodejs.org/en/download), and the [Fulcra CLI](https://pypi.org/project/fulcra-api/), which requires Python 3.11 or newer. A Fulcra MCP connection or an installed agent skill does not install these shell tools.

If the CLI is not installed, install [uv](https://docs.astral.sh/uv/getting-started/installation/) and use its [tool installer](https://docs.astral.sh/uv/guides/tools/):

```sh
uv tool install fulcra-api
uv tool update-shell
```

Open a new terminal if the installer updated your PATH. Check the prerequisites before creating any deployment state:

```sh
git --version
node --version
npm --version
fulcra-api --help
```

Use Node 24 for these commands. Stop if a prerequisite is missing; finish installation before running the bootstrap. `fulcra-api` and `fulcra` are aliases in the current CLI package; these scripts invoke `fulcra-api` by default. An existing custom CLI executable can be selected with `FULCRA_CLI` (a path to one executable, not a shell command containing spaces).

## First deployment

Start in a fresh checkout of your fork using the [current preview checkout instructions](https://github.com/fulcradynamics/connectors-webapp/blob/feat/knowledge-source-discovery/README.md#deploy-your-copy). Copy `.env.example` only on this first setup. Sign into the intended personal or company owner account and inspect `user-info` before continuing:

```sh
npm ci
fulcra-api auth login
fulcra-api user-info
cp .env.example .env
node scripts/harness.mjs init
node scripts/init-env.mjs
FULCRA_PROJECT_NAME=your-name FULCRA_EXPECTED_DOMAIN=your-name.my.fulcra.ai node scripts/deploy.mjs
```

The scripts initialize fresh owner/deployment IDs, encryption/bootstrap secrets and an owned v1 harness type. Keep `.env` and `.private/` private and backed up. Never copy them from the reference app or another owner.

Initialization and harness setup compare the authenticated account with any configured/saved owner before writing identity or making setup changes. Deployment also verifies the exact deployment token's account before namespace/platform effects. A mismatch or unreadable identity stops setup. Sign back into the existing owner and retry; do not edit the owner ID, erase state or regenerate keys to get past the error. This check does not transfer an existing instance to a company account.

The deploy helper creates/reuses your owned namespace, obtains a short-lived scoped hosting token, checks the Svelte/Node 24 runtime and retains a rollback checkpoint. Server secrets are runtime-only; only `PUBLIC_` values are exposed to the browser/build.

First deployment initializes the native controller, verifies its owner-bound Fulcra marker, pins the root run ID and deploys again with bootstrap disabled. Later updates reuse that identity. A parked namespace is reused only after ownership verification.

Open `/login` in your normal browser, sign in, then visit `/app`. As the owner, `/api/setup` should report `ready:true`, `backend:workflow`, `schedulerStatus:native_workflow`. This means infrastructure is configured; source collection still requires background consent, a provider credential, selected sources and preview confirmation.

## Updates and recovery

Keep the existing `.env` and `.private/`, pull reviewed code, run the checks, then rerun the deploy command. Do not repeat `cp .env.example .env` over a configured instance. Preserve the controller root, Fulcra marker and encryption key. Missing state is an error to investigate, not permission to initialize an empty instance.

Controllers carry state across epochs and move to the latest deployment. Pause before incompatible state/adapter changes. Preserve pending operation references after a timeout; uncertain actions must be reconciled rather than repeated with fresh IDs. See [operations](operations.md).

## Server settings

| Setting                                                                   | Purpose                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `OWNER_USER_ID`, `CONNECTORS_DEPLOYMENT_ID`                               | Verified owner and fresh instance identity                         |
| `HARNESS_DATA_TYPE`, `WORKSPACE_PATH`                                     | Your owned v1 development records and private workspace            |
| `CREDENTIAL_ENCRYPTION_KEY`, `CREDENTIAL_KEY_ID`                          | Server-only AES256 key and version                                 |
| `CREDENTIAL_PREVIOUS_KEYS`                                                | Optional rotation keyring                                          |
| `CONNECTORS_BACKEND`                                                      | `workflow` by default; optional `postgres`                         |
| `CONNECTORS_NATIVE_ROOT_RUN_ID`                                           | Pinned by initial deployment; retain during recovery               |
| `CONNECTORS_NATIVE_ALLOW_BOOTSTRAP`, `CONNECTORS_NATIVE_BOOTSTRAP_SECRET` | Explicit first-deploy authorization; disabled after initialization |
| `PUBLIC_AUTH0_*`, `PUBLIC_FULCRA_API_ENDPOINT`                            | Official public login configuration                                |
| `DATABASE_URL`, `CRON_SECRET`                                             | Optional independently managed PostgreSQL/cron backend only        |

New clones default to `CONNECTORS_MODE=personal`: minimal login and verified-owner controls/guides/APIs, including when that owner is a company account. The setting names a private deployment mode, not individual-only ownership. Only a deliberate public documentation/reference deployment uses `public-template` mode; it does not enable shared administration. An owner may explicitly supply public HTML/agent text in `personal-landing.js`; keep it separate from private controls.
