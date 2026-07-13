# Listen Together (Synchronized Shared Audio) Module

**Status:** TODO (designed; gated on Phase 1 capability spike)
**Owner:** NightSquawk Tech
**Last updated:** 2026-06-24
**Related:**
- Feasibility: `docs/feature-research/shared-audio-listening/shared-audio-listening.md`
- Module package: `nightsquawk-modules/listen-together/`
- Injection: `scripts/nightsquawk/inject-module.ts`
- Variant: `nightsquawk.tech/internal/{build.json,config.json}`
- CI: `.github/workflows/nightsquawk_module_ci.yaml`, `nightsquawk_build.yaml`, `nightsquawk_deploy_internal.yaml`
- Branding decisions (owns final variant values): `docs/todo/nightsquawk-desktop-roadmap.md`

---

## Why This Exists

We want two people in a NightSquawk/Element conversation to share an MP3/music file and listen to it **synchronized in real time** — same song, same position, like a call that carries music instead of a microphone.

The feasibility study (see Related) concluded:
1. This is **not** an `element-desktop` feature — the Electron shell has no call/media/WebRTC code. It lives in the **web client**.
2. The literal "stream it through the call" approach is blocked: Element's 1:1 calls now run through the **Element Call / LiveKit widget**, a sealed media pipeline we cannot inject a track into without forking Element Call.
3. The better design is **synchronized local playback** ("listen together" / watch-party): share the file once over Matrix, then sync `play/pause/seek` + a shared clock. Full fidelity, true sync, no call fork.
4. We can ship this **without forking element-web** by building an **Element Web Module** (`@element-hq/element-web-module-api`, runtime-loaded), injected into the prebuilt `webapp` we already fetch.

This doc is the development + CI/deploy plan for that module and for the pipeline that combines our Electron shell with it and produces unsigned internal builds.

## Locked Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Where the feature lives | Element Web **module**, not a fork | Module API supports runtime dynamic-import loading; far lower maintenance than a fork. |
| Where the module code lives | In **this** repo at `nightsquawk-modules/listen-together/` | Mirrors the existing `nightsquawk-native/` top-level pattern; versioned alongside the shell that injects it; one checkout for the combine CI. Can be extracted to its own repo later without API change. |
| Module API | `@element-hq/element-web-module-api` (currently `1.14.0`) | Official, dual AGPL/Commercial licensed (compatible with this fork). Exposes `customComponents`, `extras`, `rootNode`/`createRoot`, `client`. |
| Reverse-DNS namespace | `tech.nightsquawk.listen_together` | Module API requires config/event keys scoped in reverse-DNS; `nightsquawk.tech` is ours. |
| Sync transport | Matrix **custom timeline events** with an **anchor model** (send only on play/pause/seek), clock via **homeserver-time offset** | Avoids per-second heartbeat spam; homeserver `origin_server_ts` gives a shared reference, sidestepping P2P clock sync. (To-device avoids leaving control events in room history — Phase 2 trade-off.) |
| Audio fidelity | Local decode of the shared file (`<audio>` blob + drift correction) | Both ends hold the file, so playback is full-fidelity stereo, no voice-Opus re-encode. |
| Deploy target | **GitHub prerelease on this fork**, tagged `internal/<branch>-<sha>` | "Our own local repos" = our own GitHub, not Element's `packages.element.io` R2. Cloud, not literally local — see Open Questions; alternative backends (internal S3/MinIO, UNC/Syncthing share) are a one-line config swap. |
| Deploy branch policy | Auto-deploy from `feature/**` and `release/**` only — **never** `develop` or `master` | The user requires "never to the main branch". This repo's main branch is `develop` (default/PR branch); `master` is the release branch. Both are protected; only transient branches produce internal builds. |
| Build signing | **Unsigned** for internal builds | Internal distribution only; skips the eSigner/CKA flow entirely. |

## Architecture (target)

```
nightsquawk-modules/listen-together/        # the module (React + TS, vite-built to a single ESM bundle)
  src/index.ts        # Module entry: implements Module, wires UI + sync controller
  src/events.ts       # tech.nightsquawk.listen_together.* event schema + (de)serialisation
  src/sync/clock.ts   # homeserver-time offset estimation
  src/sync/controller.ts  # anchor model: play/pause/seek -> control event; receive -> schedule playback w/ drift correction
  src/client.ts       # access to the matrix client (VERIFY: api.client vs window.mxMatrixClientPeg)
  src/ui/Player.tsx   # timeline tile (registerMessageRenderer) + persistent mini-player (createRoot)

scripts/nightsquawk/inject-module.ts        # combine step: drop built bundle into webapp.asar, repack
nightsquawk.tech/internal/                   # build variant (branding) + runtime config (declares the module)
```

**Runtime flow:** element-web boots → loads our module via config → module registers a timeline renderer for `tech.nightsquawk.listen_together.share` and a room-header "Listen together" button → sharer picks a file → uploads as Matrix media → emits a `share` event → both clients download+decrypt the file locally → control events drive synchronized `<audio>` playback with drift correction against a homeserver-time anchor.

## Phase 1 TODO — Capability Spike (GATING; do this first)

Everything below depends on facts we have **inferred, not verified**. The spike is a throwaway module + the real plumbing CI (Phase 2 builds the same harness), proving against the **fetched, packaged** webapp — not a dev server:

1. **Loader:** the module loads at runtime from inside the packaged webapp, and the **exact config key** element-web uses to reference it. *(See VERIFY list.)*
2. **UI surface:** `api.customComponents.registerMessageRenderer` fires for a custom event type, and/or `api.createRoot(api.rootNode)` renders a mini-player.
3. **Client access — the spine of the whole feature:** from inside the module, obtain a matrix client that can **(a) send a custom room event** and **(b) download + decrypt an `mxc://` media file** to an ArrayBuffer. The public `api.client` only exposes `accountData` + `getRoom`, so this likely needs `window.mxMatrixClientPeg.safeGet()` (the pattern the official opendesk module uses) — confirm it exposes a full client in our bundle.
4. **Receive path:** confirm how the peer **receives** the custom event (timeline listener on the client vs `registerMessageRenderer`; `registerMessageRenderer` as a receive hook for non-`m.room.message` types is unverified).
5. **Unsigned build:** electron-builder 26.x **skips** Windows signing when no cert/`CSC_LINK` is configured (rather than erroring), so the unsigned variant packages cleanly.

**Exit criteria:** the spike prints the real loader key + confirms send-event + media-decrypt work end-to-end between two accounts. If client access via the peg is unavailable in the packaged bundle, escalate: either (a) request the capability via the module API upstream, or (b) fall back to a fork (last resort). **Do not build Phase 3 until this is green.**

## Phase 2 TODO — Plumbing CI (build alongside the spike)

The CI the user asked for is independent of feature logic and doubles as the spike harness. Build it with a **no-op module** first:

- `nightsquawk_module_ci.yaml` — lint/typecheck/build the module bundle on PRs touching `nightsquawk-modules/**`.
- `nightsquawk_build.yaml` — reusable: `pnpm install` → `pnpm run fetch` (prebuilt webapp) → build module → **inject** (`scripts/nightsquawk/inject-module.ts`) → `build:ts`+`build:res` → `electron-builder` **unsigned** → upload artifact.
- `nightsquawk_deploy_internal.yaml` — caller on push to `develop`/`feature/**`/`release/**` + `workflow_dispatch`, with a hard `if` guard excluding `master`; calls the build, publishes the unsigned `.exe` to the internal target.

See "CI / Deploy design" below. Verifiable now; gives us the exact loader/inject mechanics the spike needs.

## Phase 3 TODO — Sync Protocol & Player (after spike is green)

- **Event schema** (`src/events.ts`): `…share` (timeline: mxc, filename, duration, mimetype), `…control` (action ∈ play|pause|seek, trackEventId, positionMs, anchor homeserver-ts), optional `…session` state event for late-join/current-track.
- **Clock** (`src/sync/clock.ts`): estimate each client's offset to homeserver time once; convert anchor ts ↔ local.
- **Controller** (`src/sync/controller.ts`): anchor model — emit control on local play/pause/seek; on receive, compute target position and schedule; drift-correct (nudge `currentTime` or adjust `playbackRate`) when |local − target| exceeds a threshold; late-joiner catch-up.
- **File path**: sharer uploads via Matrix media (reuse client upload); receiver downloads+decrypts to a blob URL for `<audio>`.
- **Player UI** (`src/ui/Player.tsx`): timeline tile + persistent mini-player (transport controls, scrubber, "you/them in sync" indicator).

## Phase 4 TODO — Packaging polish & native helpers (optional)

- Optional native file-pick / drag-drop polish from the Electron shell (not required for MVP).
- Decide whether the module ships in **all** NightSquawk builds or behind a config/labs flag.
- Fold final branding/appId/protocol into the variant once `docs/todo/nightsquawk-desktop-roadmap.md` Phase 1 lands (this doc uses interim internal values).

## CI / Deploy design

Mirrors upstream's `build_prepare` → `build_windows` → `deploy` shape, but NightSquawk-owned, unsigned, and internal-only.

**Combine mechanism ("our shell + the module"):** the module is a standalone vite-built ESM bundle. `pnpm run fetch` extracts element-web, copies our variant `config.json` (which **declares the module** under element-web's loader key), and packs `webapp.asar`. `scripts/nightsquawk/inject-module.ts` then extracts the asar, drops the built bundle at `modules/listen-together.js`, and repacks — exactly mirroring upstream's existing "Insert config snippet" extract/edit/repack step in `build_windows.yaml`.

**Unsigned build:** the NightSquawk build path does **not** run the eSigner/CKA steps, sets no `ED_SIGNTOOL_*`/`CSC_LINK`, and does **not** assert signatures (upstream `build_windows.yaml` always signs and asserts — we fork that logic rather than reuse it).

**Branch policy (never the main branch):** in this repo the **main branch is `develop`** (default/PR branch per repo context); `master` is the release branch. The user's "never to the main branch" therefore excludes `develop`. Deploy triggers on `feature/**` and `release/**` (+ `workflow_dispatch`) only, with a `guard` job and a deploy-job `if` that both refuse `develop` and `master`. Transient branches produce internal builds; develop and master stay clean.

**Deploy default:** publish the unsigned `.exe` (+ squirrel `nupkg`/`RELEASES`) as a **GitHub prerelease** on this fork, tag `internal/<branch>-<shortsha>`, marked prerelease. Swappable backend — see Open Questions.

## Open Questions / Decisions Needed

- **Deploy backend (confirm):** GitHub prerelease on the fork (default, implemented) vs internal S3/MinIO (`aws s3 cp` to our endpoint) vs a UNC/Syncthing share via a self-hosted runner. Default is defensible for a 2-person tool; swap is ~10 lines in `nightsquawk_deploy_internal.yaml`.
- **Final variant branding:** owned by `nightsquawk-desktop-roadmap.md` Phase 1 (appId, productName, protocol, icons). Interim internal values are in `nightsquawk.tech/internal/build.json`.
- **Ship scope:** module on for all builds vs labs/config-gated.
- **Control-event history:** timeline control events persist in room history; to-device messaging avoids this but needs full client (peg) access — revisit in Phase 3 once the spike confirms peg.

## VERIFY IN SPIKE (do not bake these in as known)

1. **Module loader config key** in the fetched element-web version (the value referenced by `nightsquawk.tech/internal/config.json` and dropped path in `inject-module.ts`). Current guess: a `modules` array of relative URLs — **unconfirmed**. The new plugin engine may require build-time bundling instead of runtime config; if so, the combine step changes from "inject into prebuilt webapp" to "build element-web with the module" (a heavier, fork-adjacent path).
2. **Matrix client access** from the module: `api.client` (limited) vs `window.mxMatrixClientPeg.safeGet()` (full) — and whether the latter exists in the packaged bundle.
3. **Send-event + media-decrypt** capability via whichever client we get.
4. **Receive path** for custom (non-`m.room.message`) event types.
5. **electron-builder unsigned** behavior (skip vs error) at version `26.8.2`.

## Reference

- Feasibility & call-architecture findings: `docs/feature-research/shared-audio-listening/shared-audio-listening.md`
- Fetch/pack mechanics: `scripts/fetch-package.ts`, `package.json` (`fetch`, `asar-webapp`)
- Variant mechanism: `electron-builder.ts`, `element.io/release/build.json`
- Existing config-injection-into-asar pattern: `.github/workflows/build_windows.yaml` ("Insert config snippet")
- Module API surface: `@element-hq/element-web-module-api` (npm), example: `element-hq/element-modules` (`modules/opendesk`)
