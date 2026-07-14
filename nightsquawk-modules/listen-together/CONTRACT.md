# Listen Together — Implementation Contract (authoritative)

This is the **fixed interface contract** for the module. Every file implements EXACTLY
these exported signatures so the 6 files compose without a shared editor. Do not change a
signature; if one is genuinely unworkable, implement the closest thing and add a
`// CONTRACT-DEVIATION:` comment explaining why (the verify/fix pass will reconcile).

## Global conventions
- TypeScript **strict**; module uses `moduleResolution: "bundler"` → **extensionless relative
  imports** (`import { x } from "./events"`, NOT `"./events.js"`).
- React **19**, `jsx: "react-jsx"`. `react`/`react-dom` are **externalised** by vite — import
  them normally (`import React from "react"`), do NOT bundle them.
- Reverse-DNS namespace constant lives in `events.ts` and is imported everywhere.
- No new npm dependencies. No edits to `package.json`, `tsconfig.json`, `vite.config.ts`.
- Only types from `@element-hq/element-web-module-api` and the local files below are available.
- Runtime is a browser (Element Web renderer). No Node APIs.

## TWO distinct event shapes (do not conflate)
1. **Module-API `MatrixEvent`** (import from `@element-hq/element-web-module-api`): a plain
   interface with **properties** — `eventId: string`, `roomId: string`, `sender: string`,
   `content: Record<string, unknown>`. Used ONLY in the timeline tile render function
   (`registerMessageRenderer`). Access content via `mxEvent.content`.
2. **SDK timeline event** (from the peg client's `Room.timeline` listener): the real
   matrix-js-sdk event with **methods**. We model it locally as `MatrixEventLike` in
   `client.ts` (`getId()`, `getType()`, `getRoomId()`, `getSender()`, `getContent()`,
   `getTs()`). Used for the RECEIVE path.

---

## File: `src/events.ts` — schema + validation (transport-agnostic; safe file)
```ts
export const NS = "tech.nightsquawk.listen_together";
export const EVENT_SHARE = `${NS}.share`;      // "tech.nightsquawk.listen_together.share"
export const EVENT_CONTROL = `${NS}.control`;  // "tech.nightsquawk.listen_together.control"

/** matrix EncryptedFile info (present when the room is E2EE). */
export interface EncryptedFileInfo {
    url: string;               // mxc:// uri
    key: JsonWebKey;
    iv: string;
    hashes: Record<string, string>;
    v: string;
}

/** Content of a `${NS}.share` timeline event: the shared audio track. */
export interface ShareEventContent {
    mxc: string;               // mxc:// uri (also present inside `file` when encrypted)
    filename: string;
    mimetype: string;
    durationMs: number;
    size?: number;
    file?: EncryptedFileInfo;  // set iff the room is encrypted
}

export type ControlAction = "play" | "pause" | "seek";

/** Content of a `${NS}.control` timeline event: an anchor-model playback command. */
export interface ControlEventContent {
    action: ControlAction;
    trackEventId: string;      // event id of the share event this controls
    positionMs: number;        // intended playback position at `anchorTs`
    anchorTs: number;          // homeserver time (ms since epoch) the position is anchored to
}

export function isShareContent(c: unknown): c is ShareEventContent;
export function isControlContent(c: unknown): c is ControlEventContent;

/** Parse+validate raw event content into a typed object, or null if malformed. */
export function parseShare(content: Record<string, unknown>): ShareEventContent | null;
export function parseControl(content: Record<string, unknown>): ControlEventContent | null;

/** Normalise a typed object into the wire content to send (drops undefined). */
export function serializeShare(input: ShareEventContent): Record<string, unknown>;
export function serializeControl(input: ControlEventContent): Record<string, unknown>;
```

---

## File: `src/client.ts` — peg-backed matrix client facade (PROVISIONAL; the spike may change this)
Wraps `window.mxMatrixClientPeg?.safeGet?.() ?? window.mxMatrixClientPeg?.get?.()`.
The real client is untyped; model only what we use. This is the single file exposed to the
unverified peg assumption — keep it self-contained.
```ts
import type { ShareEventContent, EncryptedFileInfo } from "./events";

/** Minimal shape of an SDK timeline event delivered to the receive path. */
export interface MatrixEventLike {
    getId(): string | undefined;
    getType(): string;
    getRoomId(): string | undefined;
    getSender(): string | undefined;
    getContent(): Record<string, unknown>;
    getTs(): number; // origin_server_ts in ms
}

/** The capabilities Listen Together needs from the host matrix client. */
export interface ListenTogetherClient {
    getUserId(): string | null;
    /** Send a custom room event; resolves with the new event id. */
    sendEvent(roomId: string, eventType: string, content: Record<string, unknown>): Promise<string>;
    /** Upload an audio file as matrix media; returns the share content fields (mxc [+ file if E2EE]). */
    uploadAudio(roomId: string, file: File): Promise<{ mxc: string; file?: EncryptedFileInfo }>;
    /** Resolve a shared track to raw decoded bytes (handles mxc->http and E2EE decryption). */
    downloadTrack(share: ShareEventContent): Promise<ArrayBuffer>;
    /**
     * Subscribe to timeline events across rooms. `handler` is called for each live event.
     * Returns an unsubscribe function.
     */
    onTimelineEvent(handler: (ev: MatrixEventLike) => void): () => void;
}

/**
 * Obtain the facade, or null if the peg/full client is unavailable in the packaged bundle
 * (the Phase-1 spike verifies this at runtime). Callers must degrade gracefully on null.
 */
export function getListenTogetherClient(): ListenTogetherClient | null;
```

---

## File: `src/sync/clock.ts` — homeserver-time offset (transport-agnostic; safe file)
```ts
/**
 * Estimates the offset between local wall clock and homeserver time from observed
 * (localReceiptMs, serverTsMs) samples (e.g. each received event's arrival vs its
 * origin_server_ts). Uses a robust min-latency style estimate so occasional network
 * spikes don't skew it.
 */
export interface HomeserverClock {
    /** Feed a sample: local Date.now() when an event arrived, and its origin_server_ts. */
    addSample(localReceiptMs: number, serverTsMs: number): void;
    /** offsetMs such that estimatedServerNow ≈ Date.now() + offsetMs. */
    readonly offsetMs: number;
    /** true once at least one sample has been recorded. */
    readonly hasEstimate: boolean;
    /** Convert a homeserver timestamp to the equivalent local Date.now()-domain ms. */
    serverToLocal(serverTsMs: number): number;
    /** Convert a local Date.now()-domain ms to the homeserver-time domain. */
    localToServer(localMs: number): number;
}

export function createHomeserverClock(): HomeserverClock;
```

---

## File: `src/sync/controller.ts` — anchor model + drift correction (transport-agnostic; safe file)
```ts
import type { ControlEventContent } from "./events";
import type { ListenTogetherClient } from "./client";
import type { HomeserverClock } from "./clock";

export interface SyncControllerOptions {
    client: ListenTogetherClient;
    clock: HomeserverClock;
    audio: HTMLAudioElement;   // the <audio> element this controller drives
    roomId: string;
    trackEventId: string;      // the share event id being listened to
    /** Called after local state changes so the UI can re-render. */
    onStateChange?: (state: PlaybackState) => void;
}

export interface PlaybackState {
    playing: boolean;
    positionMs: number;
    /** |local - target| within threshold, i.e. we believe we are in sync. */
    inSync: boolean;
}

export interface SyncController {
    /** Local user actions → send a control event AND apply locally. */
    play(): Promise<void>;
    pause(): Promise<void>;
    seek(positionMs: number): Promise<void>;
    /** Apply a control event received from a peer: schedule playback against the anchor. */
    applyControl(content: ControlEventContent): void;
    /** Current local view of playback. */
    getState(): PlaybackState;
    /** Begin the drift-correction loop (nudge currentTime / playbackRate toward target). */
    start(): void;
    /** Stop loops and listeners. */
    dispose(): void;
}

export function createSyncController(opts: SyncControllerOptions): SyncController;
```
Drift rule: compute target position from the latest control anchor + elapsed homeserver
time; if |audio.currentTime*1000 − target| exceeds ~250 ms, hard-seek; if within a smaller
band, nudge `playbackRate` (e.g. 0.98–1.02) to converge smoothly. Ignore self-sent echoes
(compare sender to `client.getUserId()`).

---

## File: `src/ui/Player.tsx` — presentational React components (pure; no matrix calls)
```tsx
import React from "react";
import type { MatrixEvent } from "@element-hq/element-web-module-api";
import type { ShareEventContent } from "../events";

/** Timeline tile for a `${NS}.share` event. `mxEvent` is the module-API MatrixEvent (props). */
export interface ShareTileProps {
    mxEvent: MatrixEvent;              // read the track via mxEvent.content
    onListen: (share: ShareEventContent, trackEventId: string) => void;
}
export const ShareTile: React.FC<ShareTileProps>;

/** State the mini-player renders. Provided by index.ts; the component is stateless. */
export interface PlayerViewState {
    filename: string;
    durationMs: number;
    positionMs: number;
    playing: boolean;
    inSync: boolean;
}
export interface PlayerHandlers {
    onPlay(): void;
    onPause(): void;
    onSeek(positionMs: number): void;
    onPickFile(file: File): void;   // sharer picks a local audio file to share
}
/** Persistent transport UI rendered into api.rootNode. `state` null = idle/hidden. */
export interface MiniPlayerProps {
    state: PlayerViewState | null;
    handlers: PlayerHandlers;
}
export const MiniPlayer: React.FC<MiniPlayerProps>;
```
Keep components pure and dumb: render from props, call handlers on interaction. No direct
matrix or audio access here.

---

## File: `src/index.ts` — module bootstrap + wiring (PROVISIONAL; owns lifecycle)
Implements the module and wires everything. Keep the existing capability probe (it is the
Phase-1 spike output). Responsibilities:
```ts
import type { Api, Module, ModuleFactory } from "@element-hq/element-web-module-api";
export default class ListenTogetherModule implements Module { /* moduleApiVersion, ctor(api), load() */ }
// export default satisfies ModuleFactory
```
In `load()`:
- keep/keep-calling the read-only capability probe already present in the current stub.
- `const client = getListenTogetherClient();` — if null, log and stop (degrade gracefully).
- `const clock = createHomeserverClock();`
- `api.customComponents.registerMessageRenderer(EVENT_SHARE, (props) => <ShareTile mxEvent={props.mxEvent} onListen={startSession} />)`.
- subscribe `client.onTimelineEvent(ev => { feed clock.addSample(Date.now(), ev.getTs()); if ev type is EVENT_CONTROL → parseControl → activeController?.applyControl })`.
- `startSession(share, trackEventId)`: create a hidden `<audio>`, `downloadTrack` → blob URL →
  `audio.src`; `createSyncController({...})`; render `<MiniPlayer>` into `api.rootNode` via
  `api.createRoot`, wiring handlers to controller.play/pause/seek and onPickFile→client.uploadAudio+sendEvent(EVENT_SHARE).
- Check `api.extras` for a room-header button hook and use it to launch sharing if present;
  otherwise the mini-player's file-pick control is the entry point. (Read the module-API d.ts
  to see what `extras` actually exposes in this version before relying on it.)

Reference d.ts (read for exact signatures):
`node_modules/.pnpm/@element-hq+element-web-mod_*/node_modules/@element-hq/element-web-module-api/lib/element-web-module-api.d.ts`
