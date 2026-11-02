<script lang="ts">
  let { disabled = false, onselect }: { disabled?: boolean; onselect: (id: string) => void } =
    $props();
  const examples = [
    {
      id: 'attio',
      name: 'Attio',
      mark: 'A',
      pattern: 'Typed CRM fields & linked notes',
      description:
        'Selected People / Companies, approved two-way fields and preserved note revisions.',
      color: '#a9c6ff'
    },
    {
      id: 'granola',
      name: 'Granola',
      mark: 'G',
      pattern: 'Meetings & transcripts',
      description: 'Selected folders, delayed notes and paginated transcripts.',
      color: '#ffd39b'
    },
    {
      id: 'asana',
      name: 'Asana',
      mark: 'A',
      pattern: 'Tasks & event cursors',
      description: 'Project snapshots with incremental task events.',
      color: '#ffafb5'
    },
    {
      id: 'github',
      name: 'GitHub',
      mark: '⌘',
      pattern: 'Repositories & webhooks',
      description: 'Issues, pull requests and edited comments.',
      color: '#c6bfff'
    },
    {
      id: 'notion',
      name: 'Notion',
      mark: 'N',
      pattern: 'Nested documents',
      description: 'Selected pages and resumable block traversal.',
      color: '#c7d2d9'
    },
    {
      id: 'slack',
      name: 'Slack',
      mark: '#',
      pattern: 'Messages & threads',
      description: 'Selected channels, exact timestamps and signed hints.',
      color: '#9adccc'
    },
    {
      id: 'garmin',
      name: 'Garmin',
      mark: '△',
      pattern: 'Activities & health data',
      description: 'Your Personal API key, selected datasets and daily reconciliation.',
      color: '#b1d7ff'
    }
  ];
</script>

<section aria-labelledby="catalog-title">
  <div class="section-heading">
    <h2 id="catalog-title">Choose a connector</h2>
    <span>{examples.length} example patterns</span>
  </div>
  <div class="catalog">
    {#each examples as example}<button
        class="connector"
        {disabled}
        onclick={() => onselect(example.id)}
        ><span class="mark" style:color={example.color}>{example.mark}</span><span class="copy"
          ><strong>{example.name}</strong><small>{example.pattern}</small><span
            >{example.description}</span
          ></span
        ><span class="arrow">↗</span></button
      >{/each}
  </div>
  <p class="muted">
    Live account verification is pending for these examples. Google connectors are deferred.
  </p>
</section>

<style>
  .section-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 38px 0 18px;
  }
  .section-heading span {
    font-size: 12px;
    color: #8a929e;
  }
  h2 {
    font-size: 20px;
    font-weight: 550;
  }
  .catalog {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
  }
  .connector {
    display: flex;
    gap: 16px;
    text-align: left;
    border: 1px solid #313642;
    border-radius: 14px;
    padding: 22px;
    background: #181d27;
    color: #e8edf5;
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .connector:hover {
    border-color: #7ed9bf;
  }
  .connector:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .mark {
    font-size: 25px;
    font-weight: 650;
    width: 32px;
  }
  .copy {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 6px;
  }
  .copy strong {
    font-size: 17px;
  }
  .copy small {
    font-size: 11px;
    color: #98a3b4;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .copy > span {
    color: #9da7b7;
    font-size: 13px;
    line-height: 1.5;
  }
  .arrow {
    color: #6b7a8b;
  }
  .muted {
    font-size: 12px;
    color: #8994a5;
    margin-top: 14px;
  }
</style>
