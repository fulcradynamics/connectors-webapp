import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { workflowPlugin } from 'workflow/sveltekit';
import { defineConfig } from 'vite';
export default defineConfig({ plugins: [sveltekit({ adapter: adapter() }), workflowPlugin()] });
