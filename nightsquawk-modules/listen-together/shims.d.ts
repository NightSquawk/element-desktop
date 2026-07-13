// vite-plugin-node-polyfills ships no type declarations; give it an `any` module
// shim so `tsc --noEmit` (module CI typecheck) does not fail with TS7016 on
// vite.config.ts. Build-time (vite) does not need this.
declare module "vite-plugin-node-polyfills";
