import adapter from '@sveltejs/adapter-auto';
import { workflowPlugin } from 'workflow/sveltekit';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

// The checker loads Vite config to read Svelte options. Starting a Workflow
// builder there recursively reloads that config and leaves the checker pending.
const checking = process.argv.some((argument) =>
  /(?:^|[\\/])svelte-check(?:[\\/]|$)/.test(argument)
);

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({ adapter: adapter(), alias: { $lib: 'src/lib' } }),
    ...(checking ? [] : [workflowPlugin()])
  ],

  server: {
    port: 6173
  },

  test: {
    expect: { requireAssertions: true },

    projects: [
      {
        extends: './vite.config.js',

        test: {
          name: 'server',
          environment: 'node',
          include: ['src/**/*.{test,spec}.{js,ts}'],
          exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
        }
      }
    ]
  }
});
