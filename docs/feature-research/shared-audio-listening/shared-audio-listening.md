> Status: [DONE] = this checkout already has it | [PLANNED] = on roadmap | [GAP] = not planned or not available

# Shared Audio Listening ("Listen Together") - Technical Feasibility

Proposed feature: let two people in a NightSquawk/Element conversation share an MP3/music file and listen to it **synchronized in real time** — the same song, same position, like a voice call but carrying a music stream instead of microphone audio. This document assesses where the feature would actually have to be built, the two viable architectures, the hard problems (codec quality and clock synchronization), what *this* repo (`element-desktop`) can contribute, and a recommendation. The headline finding: **almost none of this feature lives in `element-desktop`** — it is an Element Web / matrix-js-sdk / Element Call concern — and the current call architecture makes the intuitive "stream it through the call" approach the *harder* of the two options.

## Where the code actually lives

- [GAP] **There is no call/VoIP/WebRTC/media-pipeline code in this repo.** `element-desktop` is the Electron wrapper only. A grep for `voip|call|rtc|webrtc|getUserMedia` across `src/**` returns only `callback`-style false positives plus screen-share and authenticated-media plumbing — never a peer connection or audio track. Evidence: `src/ipc.ts`, `src/electron-main.ts:575` (`setDisplayMediaRequestHandler`), `src/media-auth.ts`, `src/displayMediaCallback.ts`.
- [GAP] **The web client is not in this checkout.** Per `CLAUDE.md`, the React app is fetched as a prebuilt bundle (`webapp.asar`); there is no sibling `../element-web` on disk (verified). All call UI, signaling, and media handling are upstream code we package, not code we own here.
- [DONE] **What desktop *does* own around media** is narrow: a screen-capture source picker (`src/electron-main.ts:575-596`), authenticated-media URL rewriting/header injection (`src/media-auth.ts`), the screen-share display-media callback (`src/displayMediaCallback.ts`), a `loudNotification` IPC hook (`src/ipc.ts:16`), and Chromium media-key flags (`src/electron-main.ts:332-333`). None of this is an audio pipeline.

**Implication:** this feature is built in **element-web + matrix-js-sdk** (and possibly a fork of **Element Call**), upstream of this repo. `element-desktop`'s role is supporting at most (native file picking, optional system-audio capture) — see "What element-desktop can contribute" below.

## The load-bearing fact: how 1:1 calls work today

The feasibility of the obvious approach hinges entirely on whether a 1:1 audio call is a directly-controllable `RTCPeerConnection` or a sealed third-party media app.

- [GAP] **Element has moved calling into the Element Call widget (MatrixRTC + LiveKit SFU).** As of ~March 2025 the Element Call frontend is bundled into Element Web and embedded as a **widget/iframe**; it talks to a LiveKit SFU over WebRTC. The media pipeline lives inside that separate application, reached only through the widget postMessage API — not through a `RTCRtpSender` we can call `replaceTrack()` on.
- [GAP] **Legacy `MatrixCall` (matrix-js-sdk, direct `RTCPeerConnection`) still exists but is the deprecated path.** The js-sdk VoIP guide still documents `placeVoiceCall()`/`MediaHandler`, but `GroupCall` is already marked legacy and the product is consolidating *all* calling — including 1:1 — onto MatrixRTC/Element Call.

Why this matters:
- **If the active path were legacy PeerConnection:** injecting decoded file audio is a small renderer patch — build a track with Web Audio and `sender.replaceTrack()`/`addTrack()`. Feasible.
- **Because the active path is the Element Call/LiveKit widget:** injecting an arbitrary track means **forking Element Call itself**, not patching element-web. That is a materially larger, harder-to-maintain effort and pushes the recommendation away from the stream-through-the-call design.

Sources: [Exploring MatrixRTC](https://element.io/blog/exploring-matrixrtc-real-time-communication-in-rooms/), [Element Call (LiveKit) README](https://github.com/element-hq/element-call/blob/livekit/README.md), [matrix-js-sdk VoIP guide](https://matrix-org-matrix-js-sdk.mintlify.app/guides/voip-calling), [Element Call repo](https://github.com/element-hq/element-call).

## Approach A - Stream the file through the call (what the request literally describes)

One peer decodes the MP3 locally and feeds it into the call as an audio track in place of (or mixed with) the microphone; sync is automatic because it is a live stream.

- [GAP] **Track injection is gated by the call architecture above.** Clean form (`AudioContext` → `decodeAudioData` → `MediaStreamAudioDestinationNode` → MediaStreamTrack → `replaceTrack`) is straightforward against a raw PeerConnection but **not reachable inside the Element Call/LiveKit widget without forking it**. This is the central blocker for Approach A.
- [GAP] **Music quality is codec-limited even if injection works.** Call audio uses Opus tuned for *voice*: low bitrate, mono, and DTX (discontinuous transmission) that clips quiet passages. Music sounds poor. Web Audio injection does bypass the mic DSP chain (AEC/NS/AGC are `getUserMedia` constraints, not properties of a synthesized track), so that part is fine — but escaping voice-Opus requires control over codec params (stereo, raised `maxaveragebitrate`, DTX off via SDP munging or sender encodings). That control again lives inside the SFU/widget, not in our hands.
- [GAP] **The two listeners are not truly in sync.** The receiver hears the stream offset by network + jitter buffering (~150-400 ms) behind the sharer. Acceptable for "roughly together," not for frame-accurate shared listening.
- [GAP] **One-directional and bandwidth-hungry.** Only the sharer's file is streamed; it re-uploads continuously for the whole song instead of transferring once.

Verdict: matches the user's mental model but is the **worse engineering answer** and is blocked by the widget-sealed media pipeline.

## Approach B - Synchronized local playback ("watch party" model) [recommended]

Both clients hold the same audio file locally and play it from local storage; only **playback control + a shared clock** travel over Matrix. This is the Spotify/Discord "listen along" pattern.

- [PLANNED] **File distribution:** sharer uploads the MP3 once as a normal Matrix media event (encrypted); the peer downloads it before playback. Reuses existing media upload/download — no new transport. (Desktop already handles authenticated media: `src/media-auth.ts`.)
- [PLANNED] **Control channel:** `play`/`pause`/`seek` plus a periodic position heartbeat sent as custom Matrix room events (a `m.room.message`-adjacent custom event type, or to-device messages for a 1:1 session). No SFU, no WebRTC.
- [PLANNED] **Clock synchronization:** exchange an NTP-style offset (round-trip timestamps) so each client maps "song position P at wall-clock T" identically; each plays from its own decoded file at the agreed offset and **drift-corrects** (nudge `currentTime`/playbackRate) when local position diverges from predicted. This yields genuinely tight, full-fidelity sync — far better than Approach A.
- [PLANNED] **Quality:** full original fidelity (local decode), stereo, no Opus re-encode, no per-second re-upload.
- [GAP] **Cost:** requires the file on both ends (a few seconds of pre-buffer before "play"), and the sync/drift logic is new code. It is an element-web feature, still upstream of this repo.

Verdict: more moving parts in signaling, but **higher quality, true sync, no dependency on the sealed call pipeline**, and it does not require forking Element Call.

## What element-desktop can contribute

- [GAP] **For Approach A: essentially nothing required.** Audio decode/inject is pure renderer Web Audio; the blocker is upstream, not native.
- [PLANNED] **Optional native helpers (either approach):** a native "pick a music file" dialog, drag-and-drop of local files, or — if a system-loopback "share whatever is playing" mode is ever wanted — OS audio capture (`getDisplayMedia` audio / WASAPI loopback / desktopCapturer). The screen-share scaffolding at `src/electron-main.ts:575` and `src/displayMediaCallback.ts` is the closest existing hook, but none of this is needed for the core MVP.
- [DONE] **Authenticated media transport for file distribution already exists** (`src/media-auth.ts`) — Approach B's upload/download step needs no desktop changes.

## Synchronization challenges (apply to both, harder to hide in A)

- Clock offset estimation and continuous drift correction (audio clocks differ per machine).
- Network latency/jitter (worse and unavoidable in A; absorbed by pre-buffer + heartbeat in B).
- Pause/seek/resume consensus and late-joiner catch-up.
- Buffer-underrun and packet-loss handling (A only).

## Effort & risk summary

| Dimension | Approach A (stream through call) | Approach B (sync local playback) |
|---|---|---|
| Lives in | Fork of Element Call + element-web | element-web (matrix-js-sdk events) |
| element-desktop work | ~none | ~none (optional native file UX) |
| Audio quality | Poor (voice Opus) | Full fidelity |
| True sync | No (~150-400 ms offset) | Yes (clock-synced + drift) |
| Main blocker | Sealed LiveKit/widget pipeline | New sync/signaling logic |
| Bidirectional | No | N/A (shared source) |
| Maintenance | High (tracks upstream EC fork) | Moderate (custom events) |

## Recommendation

1. **Build Approach B (synchronized local playback), not the "stream through the call" model.** It delivers what the user actually wants — same song, truly in sync, good quality — without forking Element Call or fighting voice-Opus.
2. **Scope it as an element-web / matrix-js-sdk feature**, not an element-desktop one. This repo's involvement is optional native file-picking polish; the core (file share event + control events + clock sync + drift-corrected `<audio>` playback) is web-client work upstream of `webapp.asar`.
3. **Validate the call architecture against the exact `webapp` build we ship** before any build commits — fetch the bundle (`pnpm run fetch --noverify --cfgdir ""`) and confirm 1:1 calls route through the Element Call widget. This document assumes the widget path from current public sources; the shipped bundle is the source of truth.
4. **If a live shared *stream* (e.g. one person's turntable/system audio, no pre-shared file) is ever a hard requirement**, that is the only case that forces Approach A's territory — and it should be re-scoped as a system-audio capture + dedicated media stream, accepting the quality/sync tradeoffs, rather than retrofitting the voice call.

## Sources

- [Element Call: Redefining conferencing](https://element.io/blog/element-call-redefining-conferencing-for-privacy-scale-and-sovereignty/)
- [Exploring MatrixRTC: Real time communication in rooms](https://element.io/blog/exploring-matrixrtc-real-time-communication-in-rooms/)
- [element-call (livekit) README](https://github.com/element-hq/element-call/blob/livekit/README.md)
- [matrix-js-sdk VoIP calling guide](https://matrix-org-matrix-js-sdk.mintlify.app/guides/voip-calling)
- [element-call repository](https://github.com/element-hq/element-call)
