/*
Copyright 2026 NightSquawk Tech.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

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

/**
 * This implements the contract's "min-latency style estimate" (see the `HomeserverClock`
 * doc-comment above): the running extremum of `delta := serverTsMs - localReceiptMs` that is
 * least distorted by network/processing latency, rather than a naive average of all samples.
 *
 * Derivation: every event we receive has already travelled — the server stamped it at
 * `serverTsMs`, then latency (always >= 0) delayed it until we observed it locally at
 * `localReceiptMs`. With `offsetMs` defined as `serverNow ≈ localNow + offsetMs` (per
 * `serverToLocal`/`localToServer` below), algebra gives `delta = offsetMs - latency`. Since
 * `latency >= 0`, every sample's `delta` UNDER-estimates the true offset by exactly that
 * sample's latency — so the *min-latency* sample is the one with the LARGEST `delta`.
 * (Careful: tracking the running MINIMUM of `delta` would instead lock onto the
 * highest-latency sample seen, i.e. the worst estimate — the inverse of what we want.)
 */
export function createHomeserverClock(): HomeserverClock {
    let best: number | null = null;

    return {
        addSample(localReceiptMs: number, serverTsMs: number): void {
            const delta = serverTsMs - localReceiptMs;
            if (best === null || delta > best) {
                best = delta;
            }
        },

        get offsetMs(): number {
            return best ?? 0;
        },

        get hasEstimate(): boolean {
            return best !== null;
        },

        serverToLocal(serverTsMs: number): number {
            return serverTsMs - (best ?? 0);
        },

        localToServer(localMs: number): number {
            return localMs + (best ?? 0);
        },
    };
}
