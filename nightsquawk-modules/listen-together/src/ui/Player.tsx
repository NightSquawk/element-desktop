import React from "react";
import type { MatrixEvent } from "@element-hq/element-web-module-api";
import type { ShareEventContent } from "../events";
import { parseShare } from "../events";

/**
 * NOTE: this file intentionally uses `React.createElement` instead of JSX syntax.
 * `jsx: "react-jsx"` (automatic runtime) would make the bundler emit an
 * `import ... from "react/jsx-runtime"`; that specifier isn't in vite.config.ts's
 * `rollupOptions.external` (only `react`/`react-dom`/`react-dom/client` are), so it
 * would get bundled instead of externalised, which drags in a `process.env` check
 * that node-polyfills can't resolve. Same reasoning as src/index.ts.
 */

/** Format milliseconds as `m:ss` (or `h:mm:ss` once past an hour). */
function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return "0:00";
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
    const ss = String(seconds).padStart(2, "0");
    return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Timeline tile for a `${NS}.share` event. `mxEvent` is the module-API MatrixEvent (props). */
export interface ShareTileProps {
    mxEvent: MatrixEvent; // read the track via mxEvent.content
    onListen: (share: ShareEventContent, trackEventId: string) => void;
}

export const ShareTile: React.FC<ShareTileProps> = ({ mxEvent, onListen }) => {
    const share = parseShare(mxEvent.content);

    if (!share) {
        // Malformed/unknown share content — render nothing rather than a broken tile.
        return null;
    }

    return React.createElement(
        "div",
        {
            style: {
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                border: "1px solid var(--cpd-color-border-interactive-secondary, #e3e8f0)",
                borderRadius: 8,
                maxWidth: 360,
            },
        },
        React.createElement(
            "div",
            { style: { flex: 1, minWidth: 0 } },
            React.createElement(
                "div",
                {
                    style: {
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    },
                    title: share.filename,
                },
                share.filename,
            ),
            React.createElement(
                "div",
                { style: { fontSize: 12, opacity: 0.7 } },
                formatDuration(share.durationMs),
            ),
        ),
        React.createElement(
            "button",
            {
                type: "button",
                onClick: () => onListen(share, mxEvent.eventId),
            },
            "Listen together",
        ),
    );
};

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
    onPickFile(file: File): void; // sharer picks a local audio file to share
}

/** Persistent transport UI rendered into api.rootNode. `state` null = idle/hidden. */
export interface MiniPlayerProps {
    state: PlayerViewState | null;
    handlers: PlayerHandlers;
}

export const MiniPlayer: React.FC<MiniPlayerProps> = ({ state, handlers }) => {
    const onFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
        const file = e.target.files?.[0];
        if (file) handlers.onPickFile(file);
        // Allow re-picking the same file later.
        e.target.value = "";
    };

    if (!state) {
        // Idle affordance: nothing playing yet, offer the file picker so a user can start a share.
        return React.createElement(
            "div",
            { style: { display: "flex", alignItems: "center", gap: 8, padding: 8 } },
            React.createElement("span", { style: { fontSize: 12, opacity: 0.7 } }, "Listen Together"),
            React.createElement(
                "label",
                { style: { cursor: "pointer", fontSize: 12 } },
                "Share audio",
                React.createElement("input", {
                    type: "file",
                    accept: "audio/*",
                    onChange: onFileChange,
                    style: { display: "none" },
                }),
            ),
        );
    }

    const { filename, durationMs, positionMs, playing, inSync } = state;

    return React.createElement(
        "div",
        {
            style: {
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                borderTop: "1px solid var(--cpd-color-border-interactive-secondary, #e3e8f0)",
            },
        },
        React.createElement(
            "button",
            {
                type: "button",
                onClick: () => (playing ? handlers.onPause() : handlers.onPlay()),
            },
            playing ? "Pause" : "Play",
        ),

        React.createElement(
            "div",
            {
                style: {
                    minWidth: 0,
                    maxWidth: 160,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 12,
                },
                title: filename,
            },
            filename,
        ),

        React.createElement("input", {
            type: "range",
            min: 0,
            max: Math.max(durationMs, 0),
            value: Math.min(positionMs, Math.max(durationMs, 0)),
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => handlers.onSeek(Number(e.target.value)),
            style: { flex: 1 },
        }),

        React.createElement(
            "div",
            { style: { fontSize: 12, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } },
            `${formatDuration(positionMs)} / ${formatDuration(durationMs)}`,
        ),

        React.createElement(
            "span",
            {
                title: inSync ? "In sync" : "Syncing…",
                style: {
                    fontSize: 11,
                    padding: "2px 6px",
                    borderRadius: 10,
                    color: inSync ? "#0b8a3d" : "#b26a00",
                    background: inSync ? "rgba(11,138,61,0.12)" : "rgba(178,106,0,0.12)",
                    whiteSpace: "nowrap",
                },
            },
            inSync ? "In sync" : "Syncing",
        ),

        React.createElement(
            "label",
            { style: { cursor: "pointer", fontSize: 12 } },
            "+",
            React.createElement("input", {
                type: "file",
                accept: "audio/*",
                onChange: onFileChange,
                style: { display: "none" },
            }),
        ),
    );
};
