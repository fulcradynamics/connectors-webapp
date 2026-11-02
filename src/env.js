import { defineEnvVars } from '@sveltejs/kit/env';

// Deployments validate required values at the existing owner/runtime boundaries.
// Keeping optional values empty also allows the public template to build safely.
/** @param {string | undefined} value */
const optionalString = (value) => value ?? '';

export const variables = defineEnvVars({
  PUBLIC_AUTH0_DOMAIN: { public: true, schema: optionalString },
  PUBLIC_AUTH0_CLIENT_ID: { public: true, schema: optionalString },
  PUBLIC_FULCRA_API_ENDPOINT: { public: true, schema: optionalString },
  OWNER_USER_ID: { schema: optionalString },
  HARNESS_DATA_TYPE: { schema: optionalString },
  WORKSPACE_PATH: { schema: optionalString },
  CONNECTORS_DEPLOYMENT_ID: { schema: optionalString },
  DATABASE_URL: { schema: optionalString },
  CREDENTIAL_ENCRYPTION_KEY: { schema: optionalString },
  CREDENTIAL_KEY_ID: { schema: optionalString },
  CRON_SECRET: { schema: optionalString },
  CREDENTIAL_PREVIOUS_KEYS: { schema: optionalString },
  CONNECTORS_MODE: { schema: optionalString },
  CONNECTORS_BACKEND: { schema: optionalString },
  CONNECTORS_NATIVE_ROOT_RUN_ID: { schema: optionalString },
  CONNECTORS_NATIVE_ALLOW_BOOTSTRAP: { schema: optionalString },
  CONNECTORS_NATIVE_BOOTSTRAP_SECRET: { schema: optionalString }
});
