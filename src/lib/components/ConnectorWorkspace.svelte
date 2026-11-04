<script lang="ts">
  import { connectorRequest } from '$lib/client/connector-api.js';
  import { onMount } from 'svelte';
  import { env } from '$env/dynamic/public';
  import ConnectorCatalog from './ConnectorCatalog.svelte';
  import ConnectionForm from './ConnectionForm.svelte';
  import ConnectionDetail from './ConnectionDetail.svelte';
  let setup = $state<any>(null);
  let connections = $state<any[]>([]);
  let selected = $state<any>(null);
  let adding = $state('');
  let message = $state('');
  let busy = $state(false);
  let refreshing = $state(false);
  let refreshFailed = $state(false);
  let enrollment = $state<any>(null);
  async function api(path: string, body?: any) {
    const result = await connectorRequest(
      path,
      {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      },
      path === '/api/background-auth/complete' ? { operationScope: body.enrollmentId } : {}
    );
    return result;
  }
  async function refresh() {
    if (refreshing) return false;
    refreshing = true;
    const previousRefreshError = refreshFailed ? message : null;
    refreshFailed = false;
    try {
      setup = await api('/api/setup');
      if (setup.ready) connections = (await api('/api/connections')).connections;
      if (previousRefreshError && message === previousRefreshError) message = '';
      return true;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Setup unavailable';
      refreshFailed = true;
      return false;
    } finally {
      refreshing = false;
    }
  }
  const enrollmentKey = 'fulcra.connector.background-enrollment';
  let popup: Window | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let checking = $state(false);
  let disposed = false;
  function rememberEnrollment(value: any) {
    enrollment = value;
    try {
      if (value) sessionStorage.setItem(enrollmentKey, JSON.stringify(value));
      else sessionStorage.removeItem(enrollmentKey);
    } catch {
      /* Storage may be unavailable; this page can still finish approval. */
    }
  }
  function closePopup() {
    if (popup && !popup.closed) popup.close();
    popup = null;
  }
  function stopEnrollment() {
    clearTimeout(timer);
    rememberEnrollment(null);
    closePopup();
  }
  function scheduleCheck() {
    clearTimeout(timer);
    if (!disposed && enrollment)
      timer = setTimeout(checkEnrollment, Math.max(1, enrollment.interval || 5) * 1000);
  }
  function trustedVerification(uri: string) {
    const target = new URL(uri);
    // Never navigate a popup to an arbitrary URL restored from browser storage.
    if (target.protocol !== 'https:' || target.hostname !== env.PUBLIC_AUTH0_DOMAIN)
      throw Error('Invalid Fulcra verification address');
    return target.href;
  }
  onMount(() => {
    disposed = false;
    (async () => {
      await refresh();
      if (disposed) return;
      if (setup?.backgroundStatus === 'ready') {
        rememberEnrollment(null);
        return;
      }
      try {
        const saved = JSON.parse(sessionStorage.getItem(enrollmentKey) || 'null');
        if (!saved) return;
        if (
          !/^[0-9a-f-]{36}$/i.test(saved.enrollmentId) ||
          !Number.isFinite(Date.parse(saved.expiresAt)) ||
          typeof saved.userCode !== 'string'
        )
          throw Error('Invalid saved enrollment');
        trustedVerification(saved.verificationUri);
        rememberEnrollment(saved);
        scheduleCheck();
      } catch {
        rememberEnrollment(null);
      }
    })();
    return () => {
      disposed = true;
      clearTimeout(timer);
      closePopup();
    };
  });
  async function background() {
    // Open within the click gesture; the native start operation may take seconds.
    popup = window.open('about:blank', 'fulcra-background-authorization', 'width=500,height=700');
    busy = true;
    message = '';
    try {
      const started = await api('/api/background-auth/start', {});
      const verificationUri = trustedVerification(started.verificationUri);
      if (disposed) {
        closePopup();
        return;
      }
      rememberEnrollment({
        enrollmentId: started.enrollmentId,
        userCode: started.userCode,
        verificationUri,
        interval: started.interval,
        expiresAt: started.expiresAt
      });
      if (popup && !popup.closed) popup.location.href = verificationUri;
      else
        message =
          'The authorization popup was blocked or closed. Open the verification link below; this page will check automatically.';
      scheduleCheck();
    } catch (error) {
      closePopup();
      message = error instanceof Error ? error.message : 'Enrollment unavailable';
    } finally {
      busy = false;
    }
  }
  async function checkEnrollment() {
    if (checking || !enrollment || disposed) return;
    clearTimeout(timer);
    checking = true;
    try {
      if (Date.parse(enrollment.expiresAt) <= Date.now()) {
        if (!(await refresh())) throw Error('Unable to confirm saved background access');
        const ready = setup?.backgroundStatus === 'ready';
        stopEnrollment();
        message = ready
          ? 'Background access is ready.'
          : 'Authorization expired. Allow automatic sync again to get a new code.';
        return;
      }
      const result = await api('/api/background-auth/complete', {
        enrollmentId: enrollment.enrollmentId
      });
      if (disposed) return;
      if (result.status === 'ready') {
        stopEnrollment();
        setup = { ...setup, backgroundStatus: 'ready' };
        message = 'Background access is ready. You can continue setting up your connectors.';
        await refresh();
      } else if (result.status === 'pending') {
        if (Number.isFinite(result.interval) && result.interval > 0)
          rememberEnrollment({ ...enrollment, interval: result.interval });
      } else {
        stopEnrollment();
        message =
          result.status === 'wrong_account'
            ? 'Approval used a different Fulcra account. Try again with this app’s owner account.'
            : 'Background access was not approved. Allow automatic sync again to retry.';
      }
    } catch (error) {
      message =
        (error instanceof Error ? error.message : 'Enrollment check failed') +
        '. The pending request is saved; checking will continue.';
    } finally {
      checking = false;
      scheduleCheck();
    }
  }
  async function disconnectBackground() {
    busy = true;
    try {
      const result = await api('/api/background-auth/disconnect', {});
      message = 'Background authorization: ' + result.status;
      await refresh();
    } catch (error) {
      message = error instanceof Error ? error.message : 'Disconnect failed';
    } finally {
      busy = false;
    }
  }
</script>

<main class="workspace">
  <div class="hero">
    <div>
      <p class="eyebrow">YOUR FULCRA, CONNECTED</p>
      <p><a href="/guide">User guide</a> · <a href="/guides/agent.md">Agent instructions</a></p>
      <h1>Connect your services to Fulcra</h1>
      <p class="intro">
        Choose a service, follow its setup steps, select what to import and where it goes. Review
        the preview before automatic syncing begins.
      </p>
    </div>
    <div class="badge">
      <span class:ready={setup?.ready}></span>{refreshFailed
        ? 'Setup check unavailable'
        : !setup
          ? 'Checking setup…'
          : setup.ready
            ? 'Owner-protected deployment'
            : 'Setup required'}
    </div>
  </div>
  <section class="setup" id="background-access">
    <div>
      <h2>1. Allow this app to sync in the background</h2>
      <p>
        Your sign-in opens this page. Automatic sync needs its own server-held Fulcra authorization
        to keep writing after you close the browser or sign out.
      </p>
      <p>
        Approve once for this personal app; all your connectors share it. A later approval is needed
        only if access expires, is revoked or is disconnected. Each service still needs its own
        credential.
      </p>
    </div>
    <div class="setup-state">
      <span
        >{setup?.backgroundStatus === 'ready'
          ? 'Background access ready for all connectors'
          : setup?.backgroundStatus === 'reauthorize'
            ? 'Background access needs renewal'
            : setup
              ? 'One-time background access needed'
              : 'Checking access…'}</span
      >{#if setup?.ready && setup.backgroundStatus !== 'ready'}<button
          class="primary"
          disabled={busy || !!enrollment}
          onclick={background}>Allow automatic sync</button
        >{:else if setup?.backgroundStatus === 'ready'}<button
          class="subtle"
          disabled={busy}
          onclick={disconnectBackground}>Disconnect background access</button
        >{/if}
    </div>
  </section>
  {#if setup && !setup.ready}<aside class="setup-notice">
      <strong>Finish deployment setup</strong>
      <p>
        This deployment is not ready. Follow the setup/recovery instructions without resetting its
        saved state. Still needed: {setup.missing.join(', ')}.
      </p>
      <a href="/guides/setup.md" target="_blank" rel="noreferrer">Open setup guide ↗</a><button
        class="subtle"
        onclick={refresh}>Check again</button
      >
    </aside>{/if}
  {#if enrollment}<aside class="enrollment">
      <h2>Approve this app’s background access</h2>
      <p>
        Confirm the code and approve Fulcra access in the verification window. This page checks
        automatically and updates when approval is saved. This one authorization is shared by all
        connectors in this app.
      </p>
      <strong>{enrollment.userCode}</strong><a
        href={enrollment.verificationUri}
        target="_blank"
        rel="noreferrer">Open Fulcra verification ↗</a
      ><button class="primary" disabled={busy || checking} onclick={checkEnrollment}
        >Check status now</button
      ><small
        >Expires {new Date(enrollment.expiresAt).toLocaleTimeString()}. This is separate from
        browser sign-in.</small
      >
    </aside>{/if}
  {#if message}<p role="status" class="message">{message}</p>{/if}
  {#if refreshFailed}<button class="subtle" disabled={refreshing} onclick={refresh}
      >Retry workspace status</button
    >{/if}
  {#if connections.length}<section class="connections">
      <div class="section-heading">
        <h2>Your connections</h2>
        <span>{connections.length} configured</span>
      </div>
      {#each connections as connection}<button
          class="connection-row"
          onclick={() => {
            selected = connection;
            adding = '';
          }}
          ><span class="connection-icon">{connection.connector.slice(0, 1).toUpperCase()}</span
          ><span
            ><strong>{connection.label}</strong><small
              >{connection.config.resources?.length ?? 0} selected sources · {connection.connector}</small
            ></span
          ><span class="connection-status">{connection.status}</span><span>→</span></button
        >{/each}
    </section>{/if}
  {#if selected}{#key selected.id}<ConnectionDetail
        connection={selected}
        backgroundReady={setup?.backgroundStatus === 'ready'}
        onclose={() => (selected = null)}
        onchanged={refresh}
      />{/key}{:else if adding}<ConnectionForm
      connector={adding}
      oncancel={() => (adding = '')}
      oncreated={(connection) => {
        adding = '';
        selected = connection;
        refresh();
      }}
    />{:else}<ConnectorCatalog
      disabled={!setup?.ready}
      onselect={(connector) => {
        adding = connector;
        selected = null;
      }}
    />{/if}
  <footer>
    Separate deployment for each user <span>·</span> Fulcra v1 data types <span>·</span> Schedules
    and destinations are configured per connection.
    <p>Each connection starts collecting only after you review its preview and enable it.</p>
  </footer>
</main>

<style>
  .workspace {
    max-width: 1120px;
    width: 100%;
    margin: auto;
    padding: 58px 26px 30px;
    color: #e8edf5;
  }
  .hero {
    display: flex;
    justify-content: space-between;
    gap: 30px;
    align-items: start;
  }
  .eyebrow {
    font-size: 11px;
    letter-spacing: 0.17em;
    color: #8cdbbf;
    margin: 0 0 18px;
  }
  h1 {
    font-size: clamp(34px, 4.5vw, 54px);
    line-height: 1.1;
    font-weight: 550;
    letter-spacing: -0.035em;
  }
  .intro {
    font-size: 16px;
    color: #9ba9ba;
    line-height: 1.7;
    margin: 20px 0 34px;
  }
  .badge {
    display: flex;
    gap: 9px;
    align-items: center;
    border: 1px solid #354151;
    border-radius: 20px;
    padding: 9px 13px;
    font-size: 11px;
    color: #a9b9cb;
    white-space: nowrap;
  }
  .badge span {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #d5ae6b;
  }
  .badge span.ready {
    background: #8cdbbf;
  }
  .setup {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    align-items: center;
    border: 1px solid #344254;
    border-radius: 13px;
    padding: 21px 24px;
    background: #192330;
  }
  .setup h2 {
    font-size: 16px;
    font-weight: 600;
  }
  .setup p {
    font-size: 12px;
    color: #96a8bd;
    margin-top: 7px;
  }
  .setup-state {
    display: flex;
    gap: 15px;
    align-items: center;
    font-size: 11px;
    color: #9fb2c9;
  }
  .primary {
    padding: 10px 15px;
    border-radius: 8px;
    background: #93e3c9;
    color: #122b21;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.45;
  }
  .subtle {
    font-size: 12px;
    color: #a5b9cf;
    cursor: pointer;
  }
  .setup-notice,
  .enrollment {
    margin-top: 16px;
    padding: 22px;
    border: 1px solid #594c37;
    border-radius: 12px;
    background: #29251f;
  }
  .setup-notice strong {
    color: #e0c994;
    font-size: 14px;
  }
  .setup-notice p,
  .enrollment p {
    font-size: 12px;
    color: #b0a99a;
    line-height: 1.7;
    margin: 8px 0 14px;
  }
  .setup-notice a,
  .enrollment a {
    font-size: 12px;
    color: #c6bda7;
    margin-right: 25px;
    text-decoration: underline;
  }
  .enrollment strong {
    display: block;
    font-size: 26px;
    letter-spacing: 0.2em;
    margin: 15px 0;
  }
  .enrollment small {
    display: block;
    color: #b0a99a;
    font-size: 11px;
    margin-top: 18px;
  }
  .message {
    color: #e8c08b;
    font-size: 13px;
    padding: 16px 0;
  }
  .section-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 34px 0 15px;
  }
  .section-heading h2 {
    font-size: 20px;
  }
  .section-heading span {
    font-size: 11px;
    color: #8ea1b9;
  }
  .connection-row {
    display: flex;
    gap: 17px;
    align-items: center;
    border: 1px solid #354151;
    border-radius: 12px;
    padding: 19px 22px;
    margin-top: 10px;
    width: 100%;
    text-align: left;
    cursor: pointer;
  }
  .connection-row > span:nth-child(2) {
    flex: 1;
  }
  .connection-row strong {
    display: block;
    font-size: 15px;
  }
  .connection-row small {
    display: block;
    font-size: 11px;
    color: #8da2bd;
    margin-top: 5px;
  }
  .connection-icon {
    color: #a4ddce;
    font-size: 22px;
  }
  .connection-status {
    font-size: 11px;
    color: #a9bed5;
    text-transform: capitalize;
  }
  footer {
    margin: 36px 0 15px;
    color: #8093aa;
    font-size: 11px;
  }
  footer span {
    margin: 0 9px;
  }
  footer p {
    margin-top: 10px;
    color: #6f839c;
  }
  @media (max-width: 700px) {
    .workspace {
      padding: 30px 13px;
    }
    .hero {
      flex-direction: column;
    }
    .badge {
      margin-bottom: 20px;
    }
    .setup {
      flex-direction: column;
      align-items: start;
    }
    .setup-state {
      flex-wrap: wrap;
    }
    .intro {
      margin-bottom: 20px;
    }
  }
</style>
