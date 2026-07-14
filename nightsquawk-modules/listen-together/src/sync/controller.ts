/*
Copyright 2026 NightSquawk Tech.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Anchor-model playback sync + drift correction.
 *
 * Local actions (play/pause/seek) update the driven <audio> element immediately, then
 * broadcast a control event carrying the intended position anchored to homeserver time.
 * Remote control events are applied the same way (via `applyControl`), and a periodic
 * drift-correction loop keeps `audio.currentTime` converging on the anchor-derived target
 * without jarring hard seeks whenever possible.
 */

import type { ControlAction, ControlEventContent } from "../events";
import { EVENT_CONTROL, serializeControl } from "../events";
import type { ListenTogetherClient } from "../client";
import type { HomeserverClock } from "./clock";

export interface SyncControllerOptions {
    client: ListenTogetherClient;
    clock: HomeserverClock;
    audio: HTMLAudioElement; // the <audio> element this controller drives
    roomId: string;
    trackEventId: string; // the share event id being listened to
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

/** Above this |drift|, snap directly via currentTime instead of nudging playbackRate. */
const HARD_SEEK_THRESHOLD_MS = 250;
/** Below this |drift|, consider ourselves in sync and leave playbackRate at 1. */
const SOFT_SYNC_THRESHOLD_MS = 30;
/** How often the drift-correction loop re-evaluates. */
const DRIFT_LOOP_INTERVAL_MS = 500;
/** playbackRate nudges used to converge within the soft/hard band. */
const RATE_FAST = 1.02;
const RATE_SLOW = 0.98;

export function createSyncController(opts: SyncControllerOptions): SyncController {
    const { client, clock, audio, roomId, trackEventId, onStateChange } = opts;

    // The latest anchor we're tracking against, seeded to a paused state at position 0.
    let anchor: ControlEventContent = {
        action: "pause",
        trackEventId,
        positionMs: 0,
        anchorTs: clock.localToServer(Date.now()),
    };
    let playing = false;
    let inSync = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    /** Target position (ms) implied by the current anchor, projected to "now". */
    function computeTargetMs(): number {
        if (!playing) return anchor.positionMs;
        // Map the homeserver-time anchor into the local Date.now() domain, then project
        // elapsed wall-clock time onto the anchored position.
        const localAnchorMs = clock.serverToLocal(anchor.anchorTs);
        const elapsedMs = Date.now() - localAnchorMs;
        return anchor.positionMs + Math.max(0, elapsedMs);
    }

    function getState(): PlaybackState {
        return {
            playing,
            positionMs: audio.currentTime * 1000,
            inSync,
        };
    }

    function emitState(): void {
        onStateChange?.(getState());
    }

    function hardSeek(targetMs: number): void {
        const targetSec = Math.max(0, targetMs / 1000);
        if (Number.isFinite(targetSec)) {
            audio.currentTime = targetSec;
        }
    }

    /** Apply a (local or remote) anchor to the driven <audio> element and local state. */
    function applyAnchor(content: ControlEventContent): void {
        // Defensive: ignore anchors for a track other than the one we're driving. Echoes
        // of our own events are expected to already be filtered out by the caller
        // (index.ts compares the event sender to client.getUserId()), but re-checking the
        // track keeps this controller safe to call directly/out-of-order.
        if (content.trackEventId !== trackEventId) return;

        anchor = content;
        if (content.action === "play") playing = true;
        else if (content.action === "pause") playing = false;
        // "seek" leaves `playing` untouched.

        hardSeek(computeTargetMs());
        audio.playbackRate = 1;
        inSync = true;

        if (playing) {
            void audio.play().catch((e) => console.warn("[listen-together] audio.play() failed", e));
        } else {
            audio.pause();
        }

        emitState();
    }

    /** Apply a local user action immediately, then broadcast it as a control event. */
    async function sendLocal(action: ControlAction, positionMs: number): Promise<void> {
        const content: ControlEventContent = {
            action,
            trackEventId,
            positionMs,
            anchorTs: clock.localToServer(Date.now()),
        };
        applyAnchor(content);
        try {
            await client.sendEvent(roomId, EVENT_CONTROL, serializeControl(content));
        } catch (e) {
            console.warn("[listen-together] failed to send control event", e);
        }
    }

    function driftCorrect(): void {
        if (!playing) return;
        const targetMs = computeTargetMs();
        const deltaMs = audio.currentTime * 1000 - targetMs;
        const absDeltaMs = Math.abs(deltaMs);

        if (absDeltaMs > HARD_SEEK_THRESHOLD_MS) {
            hardSeek(targetMs);
            audio.playbackRate = 1;
            inSync = true;
        } else if (absDeltaMs > SOFT_SYNC_THRESHOLD_MS) {
            // Ahead of target (deltaMs > 0) -> slow down; behind -> speed up.
            audio.playbackRate = deltaMs > 0 ? RATE_SLOW : RATE_FAST;
            inSync = false;
        } else {
            audio.playbackRate = 1;
            inSync = true;
        }

        emitState();
    }

    return {
        async play(): Promise<void> {
            await sendLocal("play", audio.currentTime * 1000);
        },
        async pause(): Promise<void> {
            await sendLocal("pause", audio.currentTime * 1000);
        },
        async seek(positionMs: number): Promise<void> {
            await sendLocal("seek", positionMs);
        },
        applyControl(content: ControlEventContent): void {
            applyAnchor(content);
        },
        getState,
        start(): void {
            if (timer !== undefined) return;
            timer = setInterval(driftCorrect, DRIFT_LOOP_INTERVAL_MS);
        },
        dispose(): void {
            if (timer !== undefined) {
                clearInterval(timer);
                timer = undefined;
            }
        },
    };
}
