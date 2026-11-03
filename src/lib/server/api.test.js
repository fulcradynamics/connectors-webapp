import { it, expect } from 'vitest';
import { error } from '@sveltejs/kit';
import { configurationAction, bodyJSON } from './api.js';
it('preserves authorization and same-origin errors through the configuration wrapper', async () => {
  await expect(
    configurationAction(async () => {
      error(401, 'Owner authentication required');
    })
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    configurationAction(async () => {
      error(403, 'Origin denied');
    })
  ).rejects.toMatchObject({ status: 403 });
});
it('keeps ordinary config bounded while allowing the explicit document route budget', async () => {
  const body = JSON.stringify({ markdown: 'a'.repeat(40000) });
  await expect(
    bodyJSON(new Request('https://app.test', { method: 'POST', body }))
  ).rejects.toMatchObject({ status: 413 });
  expect(
    (await bodyJSON(new Request('https://app.test', { method: 'POST', body }), { maxBytes: 64000 }))
      .markdown.length
  ).toBe(40000);
});
