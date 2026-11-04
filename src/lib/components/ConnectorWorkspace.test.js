import { it, expect } from 'vitest';
import { render } from 'svelte/server';
import ConnectorWorkspace from './ConnectorWorkspace.svelte';
it('shows pending setup while access is being checked instead of declaring a broken setup', () => {
  const { body } = render(ConnectorWorkspace);
  expect(body).toContain('Checking setup');
  expect(body).not.toContain('Setup required');
});
