/*
Copyright 2026 NightSquawk Tech.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import type { Api, Module, ModuleFactory } from "@element-hq/element-web-module-api";
import type { Root } from "react-dom/client";

import { EVENT_SHARE, EVENT_CONTROL, parseControl, serializeShare, type ShareEventContent } from "./events";
import { getListenTogetherClient, type ListenTogetherClient, type MatrixEventLike } from "./client";
import { createHomeserverClock } from "./sync/clock";
import { createSyncController, type SyncController, type PlaybackState } from "./sync/controller";
import { ShareTile, MiniPlayer, type PlayerViewState } from "./ui/Player";

/**
 * Listen Together — synchronized shared audio listening.
 *
 * STATUS: Phase 3 implementation (see docs/todo/listen-together-module.md), but
 * RUNTIME-UNVERIFIED: it compiles and bundles, yet has NOT been confirmed to load
 * in a real Element Web nor to obtain a working client via the peg. The two
 * unverified capabilities the whole feature rests on are still gated on the Phase-1
 * spike running against two real accounts:
 *
 *   1. obtaining a matrix client able to SEND a custom room event;
 *   2. that same client being able to DOWNLOAD + DECRYPT an mxc:// media file.
 *
 * `probeClientCapabilities` below is retained as that spike probe — it logs, on load,
 * whether the peg yields a client with the needed methods. The public Module API
 * `api.client` only exposes `accountData` + `getRoom`, so send-event/media-download go
 * through `client.ts` (the legacy `window.mxMatrixClientPeg`, per the opendesk module).
 * If the probe reports MISSING in a real build, `client.ts` + this bootstrap are the
 * only files that change.
 */

export const NS = "tech.nightsquawk.listen_together" as const;
export { EVENT_SHARE, EVENT_CONTROL };

const log = (...args: unknown[]): void => console.info(`[listen-together]`, ...args);

/** VERIFY IN SPIKE: confirm this global exists in the packaged webapp and yields a full client. */
function getMatrixClient(): unknown | undefined {
    const peg = (globalThis as Record<string, any>).mxMatrixClientPeg;
    try {
        return peg?.safeGet?.() ?? peg?.get?.();
    } catch {
        return undefined;
    }
}

/** Probe (read-only) what client capabilities are reachable. Logs only; sends nothing. */
function probeClientCapabilities(api: Api): void {
    const summary: Record<string, boolean> = {
        "api.client.getRoom": typeof api.client?.getRoom === "function",
        "api.client.accountData": !!api.client?.accountData,
    };

    const client = getMatrixClient() as Record<string, unknown> | undefined;
    summary["window.mxMatrixClientPeg -> client"] = !!client;
    if (client) {
        for (const method of ["sendEvent", "sendToDevice", "uploadContent", "decryptEventIfNeeded", "mxcUrlToHttp"]) {
            summary[`client.${method}`] = typeof client[method] === "function";
        }
    }

    log("capability probe:", summary);
    const canSend = !!client && typeof (client as any).sendEvent === "function";
    const canFetchMedia =
        !!client &&
        (typeof (client as any).mxcUrlToHttp === "function" || typeof (client as any).downloadContent === "function");
    log(
        `SPIKE VERDICT: send-event=${canSend ? "OK" : "MISSING"} media-fetch=${canFetchMedia ? "OK" : "MISSING"}.` +
            ` Namespace ready: ${EVENT_SHARE}, ${EVENT_CONTROL}.`,
    );
}

/** Best-effort local duration probe for a freshly picked file, before it round-trips the server. */
function probeAudioDurationMs(file: File): Promise<number> {
    return new Promise((resolve) => {
        try {
            const url = URL.createObjectURL(file);
            const el = new Audio();
            const cleanup = (): void => URL.revokeObjectURL(url);
            el.addEventListener("loadedmetadata", () => {
                const ms = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 0;
                cleanup();
                resolve(ms);
            });
            el.addEventListener("error", () => {
                cleanup();
                resolve(0);
            });
            el.src = url;
        } catch {
            resolve(0);
        }
    });
}

/**
 * Minimal room-header entry point: a button that opens a hidden file input scoped to the
 * room it was rendered for. `ui/Player.tsx` only defines the presentational tile/mini-player
 * per CONTRACT.md, so this small transport-picker glue lives here in the bootstrap instead.
 */
function RoomHeaderShareButton(props: { onPick: (file: File) => void }): React.ReactElement {
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    return React.createElement(
        React.Fragment,
        null,
        React.createElement("input", {
            ref: inputRef,
            type: "file",
            accept: "audio/*",
            style: { display: "none" },
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) props.onPick(file);
            },
        }),
        React.createElement(
            "button",
            {
                type: "button",
                title: "Listen Together: share audio",
                "aria-label": "Listen Together: share audio",
                onClick: () => inputRef.current?.click(),
            },
            "\u{1F3A7}", // headphones emoji
        ),
    );
}

class ListenTogetherModule implements Module {
    // The engine's compat check is satisfies(engineVersion, thisRange). We develop against the
    // @element-hq/element-web-module-api@1.14.0 *types*, but the fetched Element Web (v1.12.13)
    // ships module engine 1.12.0 at runtime — and all APIs we call (registerMessageRenderer,
    // createRoot, rootNode, extras.addRoomHeaderButtonCallback) are present in it. So declare
    // broad 1.x compatibility rather than the npm package's version, which would wrongly reject
    // the older-but-capable engine. Newer APIs are feature-detected before use.
    public static readonly moduleApiVersion = "^1.0.0";

    public constructor(private readonly api: Api) {}

    public async load(): Promise<void> {
        log("module loaded.");
        try {
            probeClientCapabilities(this.api);
        } catch (e) {
            log("capability probe threw:", e);
        }

        const clock = createHomeserverClock();

        // The peg has no client until the user logs in, so we must NOT bail at boot: `load()`
        // runs before login. Acquire the client lazily (see ensureClient below) and keep going.
        let client: ListenTogetherClient | null = null;

        // --- mini-player (persistent transport UI) state -------------------------------------
        let controller: SyncController | null = null;
        let objectUrl: string | null = null;
        let playerRoot: Root | null = null;
        let viewState: PlayerViewState | null = null;
        /** Last room a share/listen touched; used to scope a picked file when no header button fired. */
        let lastRoomId: string | null = null;

        const getPlayerRoot = (): Root | null => {
            if (playerRoot) return playerRoot;
            try {
                playerRoot = this.api.createRoot(this.api.rootNode);
            } catch (e) {
                log("failed to create mini-player root:", e);
                return null;
            }
            return playerRoot;
        };

        const renderPlayer = (): void => {
            const root = getPlayerRoot();
            if (!root) return;
            root.render(
                React.createElement(MiniPlayer, {
                    state: viewState,
                    handlers: {
                        onPlay: () => void controller?.play(),
                        onPause: () => void controller?.pause(),
                        onSeek: (positionMs: number) => void controller?.seek(positionMs),
                        onPickFile: (file: File) => void shareFile(lastRoomId, file),
                    },
                }),
            );
        };

        const teardownSession = (): void => {
            controller?.dispose();
            controller = null;
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
                objectUrl = null;
            }
            viewState = null;
        };

        /**
         * Obtain the peg-backed client lazily. It is null until the user logs in, so this is
         * called both from a post-login poll and from user-action handlers. The first success
         * attaches the receive path (timeline listener) and logs the real spike verdict.
         */
        const ensureClient = (): ListenTogetherClient | null => {
            if (client) return client;
            const c = getListenTogetherClient();
            if (!c) return null;
            client = c;
            log(`matrix client acquired (${c.getUserId() ?? "unknown"}); wiring receive path.`);
            c.onTimelineEvent((ev: MatrixEventLike) => {
                clock.addSample(Date.now(), ev.getTs());
                if (ev.getType() !== EVENT_CONTROL) return;
                if (ev.getSender() === c.getUserId()) return; // ignore our own echo
                const content = parseControl(ev.getContent());
                if (content) controller?.applyControl(content);
            });
            return client;
        };

        /**
         * CONTRACT-DEVIATION: CONTRACT.md's `startSession(share, trackEventId)` omits `roomId`,
         * but `SyncControllerOptions` (sync/controller.ts) requires one and there's no reliable
         * way to recover it otherwise (the module-API `Api` surface has no "current room" getter).
         * Callers below always have the room at hand (the tile's `mxEvent.roomId`, or the room
         * header button's `roomId`), so it's threaded through as a leading argument here.
         */
        const startSession = async (roomId: string, share: ShareEventContent, trackEventId: string): Promise<void> => {
            lastRoomId = roomId;
            const c = ensureClient();
            if (!c) {
                log("cannot start listen session: not signed in yet.");
                return;
            }
            teardownSession();
            renderPlayer();
            try {
                const bytes = await c.downloadTrack(share);
                const blob = new Blob([bytes], { type: share.mimetype || "audio/mpeg" });
                objectUrl = URL.createObjectURL(blob);

                const audio = new Audio();
                audio.preload = "auto";
                audio.src = objectUrl;

                controller = createSyncController({
                    client: c,
                    clock,
                    audio,
                    roomId,
                    trackEventId,
                    onStateChange: (state: PlaybackState) => {
                        viewState = {
                            filename: share.filename,
                            durationMs: share.durationMs,
                            positionMs: state.positionMs,
                            playing: state.playing,
                            inSync: state.inSync,
                        };
                        renderPlayer();
                    },
                });
                controller.start();

                viewState = {
                    filename: share.filename,
                    durationMs: share.durationMs,
                    positionMs: 0,
                    playing: false,
                    inSync: true,
                };
                renderPlayer();
            } catch (e) {
                log("failed to start listen session:", e);
                teardownSession();
                renderPlayer();
            }
        };

        const shareFile = async (roomId: string | null, file: File): Promise<void> => {
            if (!roomId) {
                log("onPickFile: no room in context to share into (use the room header button).");
                return;
            }
            const c = ensureClient();
            if (!c) {
                log("cannot share: not signed in yet.");
                return;
            }
            try {
                const [uploaded, durationMs] = await Promise.all([
                    c.uploadAudio(roomId, file),
                    probeAudioDurationMs(file),
                ]);
                const share: ShareEventContent = {
                    mxc: uploaded.mxc,
                    filename: file.name,
                    mimetype: file.type || "application/octet-stream",
                    durationMs,
                    size: file.size,
                    file: uploaded.file,
                };
                const trackEventId = await c.sendEvent(roomId, EVENT_SHARE, serializeShare(share));
                await startSession(roomId, share, trackEventId);
            } catch (e) {
                log("failed to share picked file:", e);
            }
        };

        // Timeline tile renderer: turn a `${NS}.share` event into a clickable ShareTile.
        this.api.customComponents.registerMessageRenderer(EVENT_SHARE, (props) =>
            React.createElement(ShareTile, {
                mxEvent: props.mxEvent,
                onListen: (share, trackEventId) => void startSession(props.mxEvent.roomId, share, trackEventId),
            }),
        );

        // (Receive path is attached inside ensureClient once a client is available.)

        // Entry point: a room-header button, if this module-API version exposes the hook.
        if (typeof this.api.extras?.addRoomHeaderButtonCallback === "function") {
            this.api.extras.addRoomHeaderButtonCallback((roomId: string) =>
                React.createElement(RoomHeaderShareButton, {
                    onPick: (file: File) => {
                        lastRoomId = roomId;
                        void shareFile(roomId, file);
                    },
                }),
            );
            log("wired room-header share button via api.extras.addRoomHeaderButtonCallback.");
        } else {
            log("api.extras.addRoomHeaderButtonCallback unavailable; mini-player file picker is the only entry point.");
        }

        renderPlayer(); // mount the (initially idle) persistent mini-player shell

        // The peg client is absent until login. Acquire it now if already signed in; otherwise
        // poll so the receive path attaches once the user signs in (needed even for a peer who
        // never initiates a share). Stops on first success or after ~3 minutes.
        if (!ensureClient()) {
            let attempts = 0;
            const poll = setInterval(() => {
                if (ensureClient() || ++attempts >= 60) clearInterval(poll);
            }, 3000);
        }
        log("wired: message renderer + mini-player; client acquired lazily post-login.");
    }
}

export default ListenTogetherModule satisfies ModuleFactory;
