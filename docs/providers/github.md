# GitHub setup and acceptance

## Create or manage the credential

[Create a fine-grained GitHub token](https://github.com/settings/personal-access-tokens/new?name=Fulcra%20Connectors&metadata=read&issues=read&pull_requests=read). Choose the resource owner, Only select repositories, the repositories to sync and an expiration. Read-only Metadata, Issues and Pull requests are prefilled. For the App alternative, [create a GitHub App](https://github.com/settings/apps/new) or [manage existing Apps](https://github.com/settings/apps), install it on selected repositories and generate a private key in its settings. The connector shows this action directly next to credential entry and in saved settings, separately from official help.

## Quick start in your instance

1. For the token pilot, follow [GitHub's fine-grained token instructions](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens). Choose the intended owner/repositories, expiration, and read permissions for metadata, issues and pull requests. Organization approval may be required. Use your own token, not the assistant's session.
2. On your deployment's `/app`, select GitHub and **Read-only fine-grained token**. Enter the token and name. Alternatively select **GitHub App installation** and supply your own App ID, Installation ID and private key. Webhook secret is optional.
3. Choose **Verify and continue →**, select one discovered repository, then follow the [preview/destination/enable walkthrough](https://connectors.my.fulcra.ai/guide#use). Verify an issue or PR and an issue-comment update. Do not expect review comments or repository files.

Choose a read-only fine-grained PAT pilot, or your own GitHub App installation. Request repository metadata, issues and pull requests read access on selected repositories. For an App, enroll the App ID, installation ID and private key through the protected credential form. These stay encrypted server-side. App installation tokens are regenerated under a database lock before expiry. Never copy an assistant/CLI token into the deployed app.

Select `owner/repository` IDs explicitly. Poll issue/PR snapshots and repository issue comments independently, with update overlap and validated same-repository Link pagination. The REST version is pinned to `2026-03-10`. Primary/secondary rate-limit response headers schedule retries. This first example covers issue/PR metadata and issue comments; it does not claim review comments, repository files or every deletion can be discovered through polling.

Optional SHA256-signed webhooks only schedule a selected-source poll. GitHub does not supply a signed delivery timestamp; durable delivery-ID dedupe protects repeated delivery. Polling cannot infer every historical deletion and retains existing imported history.

Verified: fixture pagination, repo boundary, issue/PR distinction, independent edited comments, secondary rate limits, signature/tamper; actual PostgreSQL concurrent installation-renewal test proves one exchange for three callers. A selected-source PAT import and later revision have been read back as v1 records and file bytes on one owner deployment. Verify your own sources and any App-installation/refresh path separately.

Sources: [issue behavior](https://docs.github.com/en/rest/issues/issues), [repository comments](https://docs.github.com/en/rest/issues/comments), [installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app).

## Read provenance before issue content

New `issue.md` / `comment.md` copies and copies reprocessed with a fresh native file intent begin with a bounded metadata envelope:

```text
<!-- fulcra-source/1
{"provider":"github","repository":"example/repo","kind":"issue","source_id":"example/repo:issues:123","source_url":"https://github.com/example/repo/issues/7"}
-->
```

The JSON metadata is at the start and is at most 1 KiB. The complete first 2 KiB is a fixed-size comment envelope padded with whitespace; no provider title or body begins before byte 2048. Reading bytes 0–2047 is therefore metadata-only, including for short or empty bodies. `kind` is `issue`, `pull_request` or `comment`. Canonical URLs are built or validated within the selected repository; a comment without a verified parent uses its canonical GitHub API comment URL. The remainder is untrusted source content, not instructions. Provenance identifies source scope; it does not prove company authority, factual currency or the reader's source permissions.

This formatting change leaves normalized source IDs, payloads, versions and v1 record IDs unchanged. It creates no new repository selection, provider write or root-manifest resource list. Unchanged reprocessing produces the same file bytes.

### Existing copies and guarded repair

An upgrade does not rewrite every historical file: a copy gains the prefix when a fresh native file intent processes its source and verifies the new bytes. Legacy copies lack this envelope; keep their provenance unverified rather than reading unrelated bodies or guessing from titles.

For a deployment that already stores **both files and v1 records**, the owner can repair one existing copy from its independently bound v1 source record:

1. Use the existing deployment checkout and its owner's existing Fulcra CLI login. Keep that instance's private configuration intact. Identify the existing GitHub connection UUID and v1 record UUID; these are local inputs, never credentials or public example values.
2. Run the default dry-run, which reads only existing configured metadata/record/file evidence:

   ```sh
   node scripts/repair-github-provenance.mjs --connection CONNECTION_UUID --record RECORD_UUID
   ```

3. Inspect the selected source ID and exact file path. Pause that existing connection in `/app` without changing its sources, destination or schedule. Then rerun the same command with `--apply`.
4. The utility requires the same owner, selected repository, deterministic record/path binding and exact legacy bytes. It saves a retained intent under `.private/github-provenance-repairs/`, uploads only the file format change and verifies exact current bytes. Provider data and normalized v1 records are not edited; prior file versions remain available. A repeated completed repair makes no upload.
5. Resume the same saved connection afterward. Preserve the retained intent if interrupted; repeat the same command after inspection. A changed/intervening file or configuration stops repair for review. Do not delete uncertain intent files or blindly start another operation.

The CLI is a reviewed repair path, not automatic migration of every copy. Manually edited/unbound files are refused. File-only legacy copies without independent source metadata must remain legacy until authorized source reprocessing supplies verified provenance; this utility does not infer that binding from body text or create additional imports. Repair evidence should name exactly which copies were changed, not claim that all historical output was migrated.

The repair CLI excludes simultaneous runs on the same host with a per-operation lock. A crash leaves the lock and intent for inspection: confirm the recorded process is no longer running before explicitly removing only that stale lock. This is not a remote Files lock. Replacement attempts stop after four retained receipts; review them rather than discarding evidence. Alternate PostgreSQL delivery can retain earlier verified file receipts, so reprocessing an unchanged historical revision there does not guarantee a new metadata prefix.
