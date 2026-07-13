# @nightsquawk/element-web-listen-together-module

Element Web module that adds **Listen Together** — two people share an MP3/music file
and listen synchronized in real time (same song, same position), built **without forking
element-web**. The module is a standalone ESM bundle that Element Web dynamic-imports at
runtime; our build injects it into the prebuilt `webapp.asar`.

> **Status:** Phase 1 capability spike. `src/index.ts` currently loads, registers nothing
> user-facing, and probes whether the matrix client (send-event + media-decrypt) is reachable
> from a module. No feature logic yet. See `docs/todo/listen-together-module.md` for the full plan.

## Build

```bash
pnpm --dir nightsquawk-modules/listen-together install
pnpm --dir nightsquawk-modules/listen-together build   # -> dist/listen-together.js
```

This package is intentionally **not** a member of the root `element-desktop` workspace;
it installs and builds standalone so it never perturbs the shell's lockfile.

## How it ships

1. `pnpm run fetch` pulls the prebuilt Element Web `webapp` and packs `webapp.asar`,
   copying in `nightsquawk.tech/internal/config.json` (which declares this module).
2. `scripts/nightsquawk/inject-module.ts` drops `dist/listen-together.js` into the webapp
   at `modules/listen-together.js` and repacks the asar.
3. The Electron shell packages as normal (unsigned for internal builds).

CI: `.github/workflows/nightsquawk_module_ci.yaml` (module build/lint) and
`nightsquawk_build.yaml` (combine + package).

## Namespace

All config/event keys are reverse-DNS scoped under `tech.nightsquawk.listen_together`
(`.share`, `.control`).

## VERIFY IN SPIKE

- The runtime module-loader key + whether a webapp-relative URL resolves.
- Matrix client access from a module (`api.client` vs `window.mxMatrixClientPeg`).
- Send custom event + download/decrypt mxc media.

See the plan doc for the gating exit criteria.
