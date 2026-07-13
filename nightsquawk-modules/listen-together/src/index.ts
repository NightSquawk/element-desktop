/*
Copyright 2026 NightSquawk Tech.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { Api, Module, ModuleFactory } from "@element-hq/element-web-module-api";

/**
 * Listen Together — synchronized shared audio listening.
 *
 * STATUS: Phase 1 capability spike (see docs/todo/listen-together-module.md).
 * This entry deliberately implements NO feature logic. It loads, registers a
 * minimal UI surface, and probes the two unverified capabilities the whole
 * feature depends on, logging the results so a build can confirm them end-to-end:
 *
 *   1. obtaining a matrix client able to SEND a custom room event;
 *   2. that same client being able to DOWNLOAD + DECRYPT an mxc:// media file.
 *
 * The public Module API `api.client` only exposes `accountData` + `getRoom`, so we
 * also probe the legacy global `window.mxMatrixClientPeg` (the pattern the official
 * opendesk module uses). Do not build Phase 3 until this probe reports success.
 */

export const NS = "tech.nightsquawk.listen_together" as const;
export const EVENT_SHARE = `${NS}.share` as const;
export const EVENT_CONTROL = `${NS}.control` as const;

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

class ListenTogetherModule implements Module {
    public static readonly moduleApiVersion = "^1.14.0";

    public constructor(private readonly api: Api) {}

    public async load(): Promise<void> {
        log("module loaded.");
        try {
            probeClientCapabilities(this.api);
        } catch (e) {
            log("capability probe threw:", e);
        }

        // Phase 3 wires the real UI here:
        //   this.api.customComponents.registerMessageRenderer(EVENT_SHARE, renderPlayerTile)
        //   this.api.extras.addRoomHeaderButtonCallback(renderListenTogetherButton)
        //   const root = this.api.createRoot(this.api.rootNode) // persistent mini-player
        // See docs/todo/listen-together-module.md, Phase 3.
    }
}

export default ListenTogetherModule satisfies ModuleFactory;
