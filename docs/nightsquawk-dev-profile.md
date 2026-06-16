# NightSquawk Dev Profile

This checkout can run a separate Element Desktop development instance without touching the installed Element app or its normal profile data.

## Local Profile

The dev instance uses this repo-local profile directory:

```text
D:\Syncthing\RemoteSync\GitHub\NightSquawk\element-desktop\.element-dev-profile
```

This directory is ignored via `.git/info/exclude`, so it is local-only and should not be committed.

Normal installed Element data remains separate:

```text
C:\Users\reyes\AppData\Roaming\Element
```

## Launch

From the repo root:

```powershell
$profileDir = "D:\Syncthing\RemoteSync\GitHub\NightSquawk\element-desktop\.element-dev-profile"
fnm exec --using=24.14.0 -- pnpm exec electron . --profile-dir $profileDir --no-update
```

This starts the Electron desktop shell from this checkout and loads the bundled Element Web client from `webapp.asar`.

## Setup Commands

The basic setup used for this checkout was:

```powershell
fnm install 24.14.0
fnm exec --using=24.14.0 -- pnpm install
fnm exec --using=24.14.0 -- pnpm run fetch --noverify --cfgdir ""
fnm exec --using=24.14.0 -- pnpm run build:ts
fnm exec --using=24.14.0 -- pnpm run build:res
```

## Dev Config

The dev profile has its own `config.json`:

```text
.element-dev-profile\config.json
```

Current local values:

- Brand: `Element - NightSquawk Tech`
- Default homeserver: `https://matrix.nasquack.studio`
- Server name: `matrix.nasquack.studio`
- Auto-update is disabled at launch with `--no-update`

Do not hardcode credentials in this config. Login state is stored by Element inside `.element-dev-profile` after logging in.

## Notes

- `matrix-seshat` is optional. If it is not built, encrypted-room search/event indexing is disabled.
- If the console logs an `EventStore` missing-directory warning, create `.element-dev-profile\EventStore`.
- Only stop/restart Electron processes from this checkout. Do not stop the installed `Element.exe` processes unless intentionally closing the normal app.
