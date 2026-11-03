import { it, expect } from 'vitest';
import { render } from 'svelte/server';
import ConnectionForm from './ConnectionForm.svelte';
it('keeps the saved name read-only while replacing a credential', () => {
  const { body } = render(ConnectionForm, {
    props: {
      connector: 'github',
      existing: { id: 'one', label: 'Saved name', config: {} },
      oncreated: () => {},
      oncancel: () => {}
    }
  });
  const name = /Connection name<input([^>]+)>/.exec(body)?.[1];
  expect(name).toBeDefined();
  expect(name).toMatch(/readonly/);
});
