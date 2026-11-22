// SvelteKit 3 retains these runtime compatibility modules. Keep their types
// tied to the explicit manifest so public imports cannot acquire private names.
declare module '$env/dynamic/public' {
  export const env: typeof import('$app/env/public') & Partial<Record<`PUBLIC_${string}`, string>>;
}

declare module '$env/dynamic/private' {
  export const env: typeof import('$app/env/private') & Partial<Record<string, string>>;
}

declare module '$app/environment' {
  export { browser, dev, building, version } from '$app/env';
}
