import { it, expect } from 'vitest';
import { copySetupPrompt, setupPrompt, accountUrl } from './template-onboarding.js';

it('reports clipboard denial or unavailability honestly for the readable fallback', async () => {
  expect(await copySetupPrompt(undefined)).toBe(false);
  expect(
    await copySetupPrompt({
      writeText: async () => {
        throw Error('denied');
      }
    })
  ).toBe(false);
});

it('copies the exact complete deployment instructions for an already-onboarded or new user', async () => {
  let written = '';
  expect(
    await copySetupPrompt({
      writeText: async (value) => {
        written = value;
      }
    })
  ).toBe(true);
  expect(written).toBe(setupPrompt);
  expect(setupPrompt).toContain(accountUrl);
  expect(setupPrompt).toContain('https://connectors.my.fulcra.ai/guides/agent.md');
  expect(setupPrompt).toContain('https://connectors.my.fulcra.ai/guides/setup.md');
});
