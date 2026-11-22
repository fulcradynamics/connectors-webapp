import { expect, it } from 'vitest';
import { render } from 'svelte/server';
import Guide from '../../routes/guide/+page.svelte';

it('gives reference visitors account setup without reference workspace links', () => {
  const { body } = render(Guide, { props: { data: { personal: false, isOwner: false } } });
  expect(body).toContain('This public reference is a copyable template');
  expect(body).toContain('href="https://fulcra.ai/product/start-for-free"');
  expect(body).not.toMatch(/href="\/(?:app|login)"/);
});

it('keeps personal owners in their workspace with a reachable optional template prompt', () => {
  const { body } = render(Guide, { props: { data: { personal: true, isOwner: true } } });
  expect(body).toContain('href="/app"');
  expect(body).not.toContain('This public reference is a copyable template');
  expect(body).not.toContain('href="/#agent-setup"');
  expect(body).toContain('href="https://connectors.my.fulcra.ai/#agent-setup"');
});
