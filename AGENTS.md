# AGENTS.md

This file provides guidance to coding agents (Codex and others that read AGENTS.md) when working in this repository. It mirrors `CLAUDE.md`; keep the two in sync.

## What this repo is

Element Desktop is the **Electron wrapper** around Element Web. It contains **none** of the web client code — the React app is fetched as a prebuilt bundle and packaged into `webapp.asar` at build time. Code here is the Electron *main* process: window management, native menus, tray, auto-update, deep links, native module integration, and an IPC bridge that the bundled web client calls into.

> Note: upstream merged this repo into `element-web` under `apps/desktop/`. This checkout is a NightSquawk fork that still operates standalone.

## Rules

Detailed working agreements live in `.codex/rules/` (mirrored under `.claude/rules/`). Read the relevant rule before acting; subagents do **not** inherit these, so paste the relevant rule text into their prompts (see Core Instructions).

| # | Rule | File |
|---|---|---|
| 1 | Core Instructions (behavior, fork scope, subagent briefing) | `.codex/rules/core-instructions.mdc` |
| 2 | Context7 Auto-Use (current library docs) | `.codex/rules/context7.mdc` |
| 3 | Git Workflow (fork/upstream, branches, commits) | `.codex/rules/git-workflow.mdc` |
| 4 | Pre-Stash Build Gate | `.codex/rules/stash-build-gate.mdc` |

These were transposed from the NightSquawk Kaleidoscope ruleset — only the project-agnostic ones apply here. Kaleidoscope's SaaS-specific rules (RLS/tenancy, Fastify routes, services, BullMQ workers, DB migrations, feature flags, shadcn, audit/permissions) were intentionally **not** carried over: this is a single-package Electron wrapper with none of that machinery.

## Setup (required before build/run)

Package manager is **pnpm** (see `packageManager` in `package.json`); the project is **ESM** (`"type": "module"`). Node >= 18.

```bash
pnpm install
# Fetch the prebuilt Element Web bundle into ./webapp — nothing runs without this:
pnpm run fetch --noverify --cfgdir ""
```

`pnpm run fetch` downloads the Element Web release matching the local `version`, optionally GPG-verifying it (`--importkey` once, then drop `--noverify`). Alternatively symlink a local build: `ln -s ../element-web/webapp ./` (start works, `pnpm build` does not).

This fork uses **fnm** to pin Node; see `docs/nightsquawk-dev-profile.md` for running an isolated dev instance against the repo-local `.element-dev-profile` directory (git-excluded) with its own `config.json` and homeserver, without touching the installed Element app.

## Common commands

```bash
pnpm start              # build:ts + build:res, then `electron .`
pnpm run build:ts       # tsc -> lib/ (compiled main process; package `main` is lib/electron-main.js)
pnpm run build:res      # copy non-TS resources into lib/ via scripts/copy-res.ts
pnpm run build          # full electron-builder package for the host OS -> dist/

pnpm run lint           # lint:types + lint:js + lint:workflows (all must pass)
pnpm run lint:types     # tsc --noEmit across src / playwright / scripts / hak tsconfigs
pnpm run lint:js        # eslint (max-warnings 0) over src hak playwright scripts + prettier --check
pnpm run lint:js-fix    # eslint --fix + prettier --write

pnpm test               # Playwright e2e (launches the built Electron app)
pnpm test -- <file>     # run a single spec, e.g. playwright/e2e/launch/launch.spec.ts
pnpm run test:open      # Playwright UI mode

pnpm run i18n           # regenerate + sort + lint src/i18n/strings (run after adding _t() strings)
pnpm run clean          # remove webapp.asar, dist, packages, deploys, lib
```

There is no unit-test runner; `pnpm test` is Playwright end-to-end only. Tests build/launch the real Electron binary, so `pnpm run build:ts && pnpm run build:res` (and a fetched `webapp`) must be current first.

## Architecture

**Entry point** is `src/electron-main.ts`. It resolves the user-data/profile path (supporting `--profile`, `--profile-dir`, `ELEMENT_PROFILE_DIR`, deep-link SSO callbacks, and legacy `Riot` migration), reads the build config, creates the `BrowserWindow`, and wires up the modules below. Side-effect imports at the top (`./ipc.js`, `./seshat.js`, `./settings.js`, `./badge.js`) register their `ipcMain` handlers as a side effect of being imported.

Key modules in `src/`:
- `ipc.ts` — the bridge between the bundled web client (renderer) and main. Handles `ipcCall` (a name+args RPC switch covering settings, updates, language, store, seshat, etc.), plus `loudNotification`, `app_onAction` (power-save blocking during calls), and media. This is the main surface the web app interacts with.
- `updater.ts` — Electron `autoUpdater` / Squirrel integration; `squirrelhooks.ts` handles Windows install/uninstall hooks (imported first in main).
- `protocol.ts` — custom `element://`-style protocol + deep-link / SSO callback handling, including extracting the profile from a deeplink.
- `seshat.ts` — optional encrypted-room search backed by the `matrix-seshat` native module; degrades gracefully when the module isn't built.
- `store.ts` / `settings.ts` — `electron-store`-backed persistence and settings IPC; `tray.ts`, `vectormenu.ts`, `macos-titlebar.ts`, `badge.ts` — desktop chrome.
- `build-config.ts` — reads packaged build config; `language-helper.ts` — `_t()` localization via `counterpart` against `src/i18n/strings/`.

**Native modules (`hak/` + `scripts/hak/`)** — `pnpm run hak` (alias `build:native`) drives a custom build system ("hak") that fetches, compiles, links, and architecture-switches native Node modules per platform. The only hak dependency is `matrix-seshat` (encrypted search, written in Rust, needs Rust + SQLCipher). Active modules live in `.hak/hakModules`; macOS supports universal builds and `hak copy --target ...` swaps architectures. See `docs/native-node-modules.md`. Native builds are skippable — the app just loses encrypted-room search.

**Config layering** — there are two distinct config concepts: the *build* config baked into the package (`build-config.ts`, branding/protocol/update URL) vs. the *user* `config.json` at runtime, located per-OS under the profile dir or overridable via `--config` / `ELEMENT_DESKTOP_CONFIG_JSON`. See `docs/config.md`.

**Scripts (`scripts/`)** are run via `tsx` (no compile step) and have their own tsconfig: `fetch-package.ts` (fetch+verify webapp), `copy-res.ts`, `set-version.ts` / `get-version.ts` (sync local version to the fetched Element Web), `generate-nightly-version.ts`.

## Conventions

- Internal ESM imports use **`.js` extensions on `.ts` source** (e.g. `import "./ipc.js"`) — required by the module resolution config; eslint enforces this (`n/file-extension-in-import`).
- Four separate tsconfigs (`src`, `playwright`, `scripts`, `hak`); `lint:types` type-checks all four. When adding files, place them under the right tree so the matching tsconfig picks them up.
- Lint runs with `--max-warnings 0` and prettier is enforced in CI; run `pnpm run lint:js-fix` before finishing.
- User-facing strings go through `_t(...)`; after adding any, run `pnpm run i18n` to regenerate `src/i18n/strings/en_EN.json`.
- Docker (`pnpm run docker:*`) is the supported path for reproducible Linux builds and native modules.
