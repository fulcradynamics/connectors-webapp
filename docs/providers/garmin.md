# Garmin Personal

Import selected data from **your own Garmin Connect account**. This uses Garmin’s official [Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api/), not a Garmin password or browser-login scraper. Personal API use is for one individual’s own data; commercial multi-user integrations use Garmin’s separate developer program.

## Connect your account

1. In your protected connector workspace, choose **Garmin**.
2. Open [Create or manage Garmin Personal API key](https://connect.garmin.com/app/settings/personalApiToken). Sign into Garmin Connect, select **Create Key**, accept the terms, choose an expiry, then **Create**.
3. Copy the key when Garmin displays it; it is shown only once. Paste it into **Garmin Personal API key** in your connector app, then choose **Verify and continue**. Do not put it in chat, a URL, an issue or source code.
4. Select datasets, destination and schedule. Save and inspect the preview. Confirm it and enable collection when the choices are right.

Verification reads Garmin settings and today’s daily summary to obtain a stable account ID and time zone. A display name or caller-supplied ID cannot establish ownership. If Garmin does not return that identity, enrollment fails without creating a connection; this needs investigation rather than an invented account ID.

The key grants access to your own account. Dataset choices restrict what this app imports; they do not reduce the key’s provider-side permissions. API availability depends on your devices and data uploaded to Garmin Connect.

## Choose what to import

| Dataset         | Included JSON                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------- |
| Activities      | Activity summaries, including `summaryDTO` measurements and metadata; parent multisport summaries |
| Daily summaries | Steps, calories, stress, Body Battery and other returned daily wellness fields                    |
| Sleep           | Daily sleep duration, stages, scores and other returned sleep fields                              |
| Heart rate      | Daily summary and timestamp/value readings, including provider nulls                              |
| HRV             | Daily HRV summary and returned readings                                                           |

No source is selected by default. This version does not download FIT/ZIP files, GPS tracks or separate multisport legs, or import workouts, women’s health or every Garmin endpoint. Empty/204 days are skipped; absence does not delete previously imported content.

## Destination, history and frequency

The proposed settings are **files in `/connectors/garmin`**, **seven days of initial history**, and **every five minutes** after a completed cycle. Change them before enabling. Frequency is per connection, configurable from 60 seconds to 24 hours.

Choose JSON files, connector-compatible **v1 Event records**, or both. The destination picker can create a named compatible type. Records use the common connector envelope; `payload` contains `dataset`, `calendarDate`, `timeZone` and original Garmin `data`. Provider values and units are preserved. This version does not translate them into existing Fulcra health metric types or provide a field-mapping editor.

The date picker’s YYYY-MM-DD is interpreted as that calendar date in the account time zone verified at enrollment, without shifting its UTC-midnight storage value into the previous day. Daily records use that local day’s start, accounting for daylight saving. Activity timestamps use Garmin’s explicit GMT fields; their original local date and time-zone metadata remain in the JSON. Replace the credential to reverify changed account time-zone settings.

A preview is a bounded sample, not a full historical scan. If its successful source pages are empty, the page explicitly says that some selected datasets or dates may remain unchecked; you can still confirm and enable the remaining history. Throttled or failed reads do not create a passing preview.

Reads start with the latest date and work backwards. Each bounded step reads one dataset/day or one activity page/detail and saves a resumable checkpoint. Later cycles recheck the latest seven calendar days for late uploads and corrections. Once a day, a full pass checks the configured history, bounded to the latest year as the initial date ages. Existing imported history is retained. Offset-based activity listings can shift during uploads; subsequent overlap/reconciliation passes recover changes rather than claiming an immutable snapshot. Old deletions and changes outside the reconciliation window are not guaranteed.

The interval is not an exact freshness promise: a backfill can span many native worker steps, Garmin must receive device uploads first, and rate limits can delay it. No numeric request quota was found in the inspected official docs. HTTP throttling uses the shared backoff; the native scheduler and shared runner perform delivery/readback before committing progress. This connector does not provision a database or scheduler.

## Keys, renewal and recovery

Your key, access token and token expiry are encrypted server-side in this deployment’s operational state, under its existing grant lock. The encryption key stays in server environment variables. Provider credentials are separate from Fulcra background authorization and are never returned in settings summaries.

Garmin access tokens last at most 24 hours or until the key expires. This app obtains another token using the same valid key; Garmin does not supply a refresh token. Keys expire after 30, 90 or 180 days, or one year. Check the expiry on the [Garmin key page](https://connect.garmin.com/app/settings/personalApiToken). An expired/revoked key requires **Replace credential**. Replacement retains selections/settings, pauses collection, and requires a fresh preview before enabling. A key for a different Garmin account requires a new connection.

**Pause**, **Retry queued work** and **Disconnect** use the shared controls. Disconnect removes the app’s local credential; delete the key in Garmin to revoke provider access too. Replacing or disconnecting does not erase Fulcra imports.

## Agent implementation and verification

Read [agent instructions](/guides/agent.md) and [the extension contract](/guides/adding-a-connector.md). Implementations are `garmin.js`, `garmin-auth.js` and `provider-enrollment.js` under `src/lib/server`. Keep token exchange/renewal server-side, account binding provider-verified, selected datasets fixed, checkpoints bounded and delivery in the shared runner. Do not infer an identity from a mutable display name, key hash or unverified token claims. Do not add password scraping as a fallback.

```sh
npx vitest run src/lib/server/connectors/garmin.test.js src/lib/server/connectors/garmin-auth.test.js src/lib/server/provider-enrollment.test.js
```

Synthetic tests cover account binding, expiry/renewal/encrypted persistence, selected datasets, pagination/resumption, corrections/revision identity, local dates/DST, empty days, throttling and errors. Browser fixtures cover inline setup and shared controls. They do not establish real Garmin acceptance. The first live account still needs an owner-entered key to verify the actual token/account responses, one import, an update and exact Fulcra v1/file readback with the browser closed. JSON pages over the native bound fail visibly rather than truncating data.

Official references: [setup](https://developer.garmin.com/gc-developer-program/personal/personal-api/), [expiry and personal-use FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq/), [endpoint/schema reference](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/). This adapter targets the Personal API’s published OpenAPI 1.0.0 schema.
