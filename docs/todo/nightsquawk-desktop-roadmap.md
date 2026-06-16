# NightSquawk Desktop Roadmap

**Status:** PHASED (local dev profile working; durable branding/package path TODO)
**Owner:** NightSquawk Tech
**Last updated:** 2026-06-16
**Related:** `docs/nightsquawk-dev-profile.md`, `electron-builder.ts`, `element.io/release/config.json`, `src/electron-main.ts`

---

## Why This Exists

This checkout can already run a separate development Element Desktop instance against `matrix.nasquack.studio` without touching the installed Element app profile. The next step is deciding which pieces should remain local developer convenience and which should become a durable branded NightSquawk desktop distribution.

## Phase 0 Done - Local Dev Profile

Working locally:

- Isolated profile directory: `.element-dev-profile`
- Default homeserver: `https://matrix.nasquack.studio`
- Local brand string: `Element - NightSquawk Tech`
- Launch command documented in `docs/nightsquawk-dev-profile.md`
- Auto-update disabled during dev launch via `--no-update`

This is intentionally local-only. It proves the client can run and log in, but it is not a packaged product.

## Phase 1 TODO - Durable Branding

Decide where branding should live for a committed build:

- Product name and executable identity in `electron-builder.ts`
- Build variant config under `element.io/` or a new NightSquawk config directory
- Window title, app display name, protocol name, installer display name, icons, and about text
- Whether to preserve upstream Element naming in source while only changing packaged metadata

Local `.element-dev-profile/config.json` is not enough for a distributable app; it only affects runtime web config in this dev profile.

## Phase 2 TODO - Default Homeserver And Client Config

Promote the dev-profile homeserver settings into a committed NightSquawk config source:

- `default_server_name`: `matrix.nasquack.studio`
- `default_server_config.m.homeserver.base_url`: `https://matrix.nasquack.studio`
- Room directory defaults for `matrix.nasquack.studio`
- Integration manager policy, if any
- Element Call / MatrixRTC expectations once the server-side transport and homeserver identity decisions are settled

Do not hardcode user credentials, access tokens, or session state. Login state belongs in the user's local profile after authentication.

## Phase 3 TODO - Native Modules Strategy

Decide whether NightSquawk builds optional native modules:

- `matrix-seshat` enables encrypted-room event indexing/search.
- Skipping it is acceptable for basic client testing.
- Building it on Windows requires the toolchain documented in `docs/windows-requirements.md`.
- Docker can build Linux packages/native modules, but not Windows packages from this Windows checkout.

## Phase 4 TODO - Packaging And Update Policy

Define how NightSquawk packages and distributes the app:

- Local dev command only
- Unsigned internal installer
- Signed Windows installer
- Auto-update disabled permanently
- NightSquawk-owned update feed
- Upstream Element update feed retained or explicitly removed

The current dev launch uses `--no-update`; that is a safe local default, not a release policy.

## Phase 5 PARKED - Upstream Repo Layout

The current `README.md` notes that standalone `element-desktop` has been merged into `element-web` under `apps/desktop`. Before long-lived product work, verify whether this fork should continue from this checkout or move to the current upstream monorepo layout.

## Open Questions

- Do we want a true branded app name or a lightly branded Element build?
- Should this be distributed only inside NightSquawk or to external customers?
- Should auto-update point to NightSquawk infrastructure, stay disabled, or follow upstream Element?
- Do we need native encrypted-room search in v1?
- What is the desired integration manager and widget policy for the NightSquawk homeserver?

## Reference

- Local setup: `docs/nightsquawk-dev-profile.md`
- Runtime config loading: `src/electron-main.ts`
- Packaging config: `electron-builder.ts`
- Upstream release config example: `element.io/release/config.json`
- Native modules: `docs/native-node-modules.md`
- Windows native build requirements: `docs/windows-requirements.md`
