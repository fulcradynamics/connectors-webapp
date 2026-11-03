import { it, expect } from 'vitest';
import { render } from 'svelte/server';
import ConnectionDetail from './ConnectionDetail.svelte';
it('keeps saved sources removable before or when discovery omits them', () => {
  const { body } = render(ConnectionDetail, {
    props: {
      connection: {
        id: 'connection',
        connector: 'github',
        label: 'Saved GitHub',
        account_id: 'account',
        status: 'paused',
        config: {
          resources: ['example/no-longer-discovered'],
          route: { mode: 'file', folder: '/connectors/github' },
          intervalSeconds: 300,
          backfillSince: '2026-10-01T00:00:00Z'
        }
      },
      onclose: () => {},
      onchanged: () => {}
    }
  });
  expect(body).toMatch(/type="checkbox"[^>]*checked/);
  expect(body).toContain('example/no-longer-discovered');
  expect(body).toContain('Not in current discovery');
});
