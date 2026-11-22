# Security

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/fulcradynamics/connectors-webapp/security/advisories/new). Do not include tokens, private records or meeting links in public issues or PRs.

Each copy belongs to one verified owner. Personal mode protects controls and data APIs. Provider credentials and unattended Fulcra grants are encrypted server-side; encryption keys remain in server environment variables. Public Auth0 client settings identify the login application and are not secrets.

The default native backend uses Fulcra-owned Vercel Workflow state and scheduling. Imported content lives in Fulcra. Source/staged content and provider payloads are untrusted data; they cannot authorize commands, sharing or destination changes. See [architecture](docs/design.md) for trust boundaries and limits.

Keep `.env`, `.private`, controller IDs, encryption keys, tokens and real account fixtures out of contributions. Run the release privacy check and Gitleaks before publication. CI has no deployment/provider credentials and does not deploy PR code. Maintainers review code and dependency changes before merging.

This is an extensible personal-app template. Test real source changes, destination readback, refresh and recovery on your instance. A source deletion or disconnect does not purge imported history.
