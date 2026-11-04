# Deploy an account-owned connector app

Use your own Fulcra account and namespace. Each deployment has independent credentials, encryption keys and operational state. Native Workflow persistence/scheduling is bundled through Fulcra hosting; a separate database, cron or Vercel account is not required.

The owner can be a personal account or a new company-owned account. For a team, start with [company and member onboarding](company-onboarding.md) and verify which account will own the deployment before authenticating. Members read approved company outputs through Fulcra shares; the app currently has no multi-user administration. Set up member instances separately rather than copying company secrets.

## First deployment

Use Node.js 24 and an installed [Fulcra CLI](https://pypi.org/project/fulcra-api/).

```sh
npm ci
fulcra-api auth login
cp .env.example .env
node scripts/harness.mjs init
node scripts/init-env.mjs
FULCRA_PROJECT_NAME=your-name FULCRA_EXPECTED_DOMAIN=your-name.my.fulcra.ai node scripts/deploy.mjs
```

The scripts initialize fresh owner/deployment IDs, encryption/bootstrap secrets and an owned v1 harness type. Keep `.env` and `.private/` private and backed up. Never copy them from the reference app or another owner.

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
