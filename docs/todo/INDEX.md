# TODO / Roadmap Index

Roadmaps, parked designs, and partial migrations for this Element Desktop fork.
Use one doc per topic so future work can be picked up without reconstructing
conversation history from chat logs.

| Status legend |
|---|
| **TODO** - designed, not started |
| **WIP** - partial, ongoing |
| **PARKED** - designed and explicitly deferred |
| **PHASED** - multi-phase; some shipped, more to do |

---

## Index

| Area | File | Status | Last touched |
|---|---|---|---|
| NightSquawk branded client | [nightsquawk-desktop-roadmap.md](./nightsquawk-desktop-roadmap.md) | PHASED (local dev profile working; durable branding/package path TODO) | 2026-06-16 |
| Listen Together (synced shared audio) | [listen-together-module.md](./listen-together-module.md) | TODO (designed; gated on Phase 1 capability spike) | 2026-06-24 |

---

## Per-doc Summary

### NightSquawk Desktop Roadmap

- **File:** `docs/todo/nightsquawk-desktop-roadmap.md`
- **Feature:** Tracks the path from a local development profile to a branded NightSquawk desktop Matrix client.
- **Status:** PHASED - local dev launch and homeserver default are working; committed branding, package metadata, native module strategy, installer/update policy, and release packaging remain TODO.
- **Key files when picking this up:**
  - `docs/nightsquawk-dev-profile.md`
  - `.element-dev-profile/config.json` (local-only; not committed)
  - `README.md`
  - `electron-builder.ts`
  - `element.io/release/config.json`
  - `src/electron-main.ts`
  - `docs/native-node-modules.md`
  - `docs/windows-requirements.md`
- **Related commits:** none yet.

### Listen Together (Synced Shared Audio)

- **File:** `docs/todo/listen-together-module.md`
- **Feature:** Two people share an MP3 and listen synchronized in real time, built as an Element Web module (no element-web fork) injected into our shell, with unsigned internal CI builds.
- **Status:** TODO - designed; gated on a Phase 1 capability spike (confirm module loader key + in-module matrix client access for send-event/media-decrypt).
- **Key files when picking this up:**
  - `docs/feature-research/shared-audio-listening/shared-audio-listening.md`
  - `nightsquawk-modules/listen-together/`
  - `scripts/nightsquawk/inject-module.ts`
  - `nightsquawk.tech/internal/build.json`, `nightsquawk.tech/internal/config.json`
  - `.github/workflows/nightsquawk_module_ci.yaml`, `nightsquawk_build.yaml`, `nightsquawk_deploy_internal.yaml`
- **Related commits:** none yet.

---

## Conventions

- **Filename:** kebab-case, stable over time. Do not put dates or status in filenames.
- **Status header:** mirror the INDEX status at the top of each doc.
- **One topic per file.** If two roadmaps merge, link them instead of concatenating.
- **Cross-references:** use repo-relative paths so IDE search can jump straight to the owner.
- **Commit references:** include short SHA plus subject once work ships.
- **Local-only paths:** call out local profile/config paths explicitly when they should not be committed.
