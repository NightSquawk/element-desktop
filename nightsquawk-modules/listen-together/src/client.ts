/*
Copyright 2026 NightSquawk Tech.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { ShareEventContent, EncryptedFileInfo } from "./events";

/**
 * Listen Together — peg-backed matrix client facade.
 *
 * PROVISIONAL: `window.mxMatrixClientPeg` is an unverified legacy global (see the Phase-1
 * capability probe in index.ts). The raw client is untyped from our side, so every method we
 * touch is feature-detected with `typeof` and calls are wrapped in try/catch. Callers must be
 * prepared for `getListenTogetherClient()` to return null and for individual facade methods to
 * throw/degrade.
 */

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

const log = (...args: unknown[]): void => console.info(`[listen-together:client]`, ...args);

/** Loosely typed handle onto the raw matrix-js-sdk client reached via the legacy peg. */
type RawClient = Record<string, any>;

/** Grab the raw client off the legacy global peg, defensively. */
function getRawClient(): RawClient | undefined {
    const peg = (globalThis as Record<string, any>).mxMatrixClientPeg;
    try {
        return peg?.safeGet?.() ?? peg?.get?.();
    } catch {
        return undefined;
    }
}

/** Best-effort mxc -> http(s) URL resolution, tolerant of signature differences across SDK versions. */
function safeMxcToHttp(raw: RawClient, mxc: string): string | null {
    if (typeof raw.mxcUrlToHttp !== "function") return null;
    try {
        const url = raw.mxcUrlToHttp(mxc);
        return typeof url === "string" ? url : null;
    } catch (e) {
        log("mxcUrlToHttp threw:", e);
        return null;
    }
}

/** Normalise the varying shapes of an uploadContent() resolution across SDK versions into an mxc:// uri. */
function extractMxcFromUploadResponse(res: unknown): string | null {
    if (typeof res === "string") return res;
    if (res && typeof res === "object") {
        const obj = res as Record<string, unknown>;
        if (typeof obj.content_uri === "string") return obj.content_uri;
        if (typeof obj.contentUri === "string") return obj.contentUri;
    }
    return null;
}

/** Locate an encrypt-attachment helper reachable from the raw client or a global SDK export, if any. */
function findEncryptAttachmentFn(raw: RawClient): ((data: ArrayBuffer) => Promise<any>) | null {
    const candidate = raw.crypto?.encryptAttachment ?? raw.encryptAttachment ?? (globalThis as any).matrixcs?.encryptAttachment;
    return typeof candidate === "function" ? candidate.bind(raw.crypto ?? raw) : null;
}

/** Locate a decrypt-attachment helper reachable from the raw client or a global SDK export, if any. */
function findDecryptAttachmentFn(raw: RawClient): ((info: any) => Promise<any>) | null {
    const candidate = raw.crypto?.decryptAttachment ?? raw.decryptAttachment ?? (globalThis as any).matrixcs?.decryptAttachment;
    return typeof candidate === "function" ? candidate.bind(raw.crypto ?? raw) : null;
}

/** Wrap a raw SDK timeline event (method-based) into our local MatrixEventLike, defensively. */
function wrapTimelineEvent(event: unknown): MatrixEventLike {
    const e = event as Record<string, any>;
    return {
        getId: () => {
            try {
                return e?.getId?.();
            } catch {
                return undefined;
            }
        },
        getType: () => {
            try {
                return e?.getType?.() ?? "";
            } catch {
                return "";
            }
        },
        getRoomId: () => {
            try {
                return e?.getRoomId?.();
            } catch {
                return undefined;
            }
        },
        getSender: () => {
            try {
                return e?.getSender?.();
            } catch {
                return undefined;
            }
        },
        getContent: () => {
            try {
                return e?.getContent?.() ?? {};
            } catch {
                return {};
            }
        },
        getTs: () => {
            try {
                return e?.getTs?.() ?? 0;
            } catch {
                return 0;
            }
        },
    };
}

class PegListenTogetherClient implements ListenTogetherClient {
    public constructor(private readonly raw: RawClient) {}

    public getUserId(): string | null {
        try {
            return this.raw.getUserId?.() ?? null;
        } catch (e) {
            log("getUserId threw:", e);
            return null;
        }
    }

    public async sendEvent(roomId: string, eventType: string, content: Record<string, unknown>): Promise<string> {
        if (typeof this.raw.sendEvent !== "function") {
            throw new Error("listen-together: client.sendEvent is unavailable");
        }
        const res = await this.raw.sendEvent(roomId, eventType, content);
        const eventId = res?.event_id ?? res?.eventId;
        if (typeof eventId !== "string") {
            throw new Error("listen-together: sendEvent response had no event id");
        }
        return eventId;
    }

    public async uploadAudio(roomId: string, file: File): Promise<{ mxc: string; file?: EncryptedFileInfo }> {
        let isEncryptedRoom = false;
        try {
            isEncryptedRoom = !!this.raw.isRoomEncrypted?.(roomId);
        } catch (e) {
            log("isRoomEncrypted threw:", e);
        }

        if (isEncryptedRoom) {
            const encrypt = findEncryptAttachmentFn(this.raw);
            if (encrypt && typeof this.raw.uploadContent === "function") {
                try {
                    const buf = await file.arrayBuffer();
                    const encrypted = await encrypt(buf);
                    const uploadRes = await this.raw.uploadContent(
                        new Blob([encrypted.data]) as unknown as File,
                        { type: "application/octet-stream", rawResponse: false, onlyContentUri: false },
                    );
                    const mxc = extractMxcFromUploadResponse(uploadRes);
                    if (mxc) {
                        const info = encrypted.info ?? {};
                        return {
                            mxc,
                            file: {
                                url: mxc,
                                key: info.key,
                                iv: info.iv,
                                hashes: info.hashes,
                                v: info.v,
                            },
                        };
                    }
                    log("encrypted uploadContent response had no content_uri, falling back to plaintext upload");
                } catch (e) {
                    log("encrypted attachment upload path failed, falling back to plaintext upload:", e);
                }
            } else {
                // CONTRACT-DEVIATION: no reachable encrypt-attachment helper on the peg client.
                // TODO-degrade: uploading plaintext into an E2EE room's media repo until the SDK's
                // attachment-encryption helper is confirmed reachable (see Phase-1 spike notes).
                log("no reachable encryptAttachment helper; uploading audio unencrypted into an E2EE room");
            }
        }

        if (typeof this.raw.uploadContent !== "function") {
            throw new Error("listen-together: client.uploadContent is unavailable");
        }
        const uploadRes = await this.raw.uploadContent(file);
        const mxc = extractMxcFromUploadResponse(uploadRes);
        if (!mxc) {
            throw new Error("listen-together: uploadContent response had no content_uri");
        }
        return { mxc };
    }

    public async downloadTrack(share: ShareEventContent): Promise<ArrayBuffer> {
        if (share.file) {
            const decrypt = findDecryptAttachmentFn(this.raw);
            const httpUrl = safeMxcToHttp(this.raw, share.file.url);
            if (decrypt && httpUrl) {
                try {
                    const res = await fetch(httpUrl);
                    if (!res.ok) throw new Error(`fetch of encrypted media failed: ${res.status}`);
                    const encryptedData = await res.arrayBuffer();
                    const decrypted = await decrypt({ ...share.file, data: encryptedData });
                    if (decrypted instanceof ArrayBuffer) return decrypted;
                    if (decrypted && typeof (decrypted as Blob).arrayBuffer === "function") {
                        return await (decrypted as Blob).arrayBuffer();
                    }
                    throw new Error("decryptAttachment returned an unrecognised shape");
                } catch (e) {
                    log("attachment decryption failed:", e);
                    throw e;
                }
            }
            // CONTRACT-DEVIATION / TODO-degrade: no reachable decryptAttachment helper on the peg
            // client. Fall back to fetching the (still-encrypted) bytes at the plaintext http url;
            // this will not produce a playable track for E2EE shares until the real SDK decryption
            // path is confirmed reachable (see Phase-1 spike notes).
            log("no reachable decryptAttachment helper; fetching media without decrypting");
            const fallbackUrl = httpUrl ?? safeMxcToHttp(this.raw, share.mxc);
            if (!fallbackUrl) {
                throw new Error("listen-together: cannot resolve mxc:// to an http url");
            }
            const res = await fetch(fallbackUrl);
            if (!res.ok) throw new Error(`fetch of media failed: ${res.status}`);
            return res.arrayBuffer();
        }

        const httpUrl = safeMxcToHttp(this.raw, share.mxc);
        if (!httpUrl) {
            throw new Error("listen-together: cannot resolve mxc:// to an http url");
        }
        const res = await fetch(httpUrl);
        if (!res.ok) {
            throw new Error(`listen-together: fetch of media failed: ${res.status}`);
        }
        return res.arrayBuffer();
    }

    public onTimelineEvent(handler: (ev: MatrixEventLike) => void): () => void {
        if (typeof this.raw.on !== "function") {
            log("client.on is unavailable; onTimelineEvent is a no-op");
            return () => {};
        }
        const listener = (event: unknown): void => {
            try {
                handler(wrapTimelineEvent(event));
            } catch (e) {
                log("timeline event handler threw:", e);
            }
        };
        try {
            this.raw.on("Room.timeline", listener);
        } catch (e) {
            log("failed to subscribe to Room.timeline:", e);
            return () => {};
        }
        return () => {
            try {
                this.raw.off?.("Room.timeline", listener);
            } catch (e) {
                log("failed to unsubscribe from Room.timeline:", e);
            }
        };
    }
}

/**
 * Obtain the facade, or null if the peg/full client is unavailable in the packaged bundle
 * (the Phase-1 spike verifies this at runtime). Callers must degrade gracefully on null.
 */
export function getListenTogetherClient(): ListenTogetherClient | null {
    let raw: RawClient | undefined;
    try {
        raw = getRawClient();
    } catch (e) {
        log("failed to reach mxMatrixClientPeg:", e);
        return null;
    }
    if (!raw) {
        log("mxMatrixClientPeg did not yield a client");
        return null;
    }
    if (typeof raw.getUserId !== "function" || typeof raw.sendEvent !== "function") {
        log("client is missing core methods (getUserId/sendEvent); refusing to wrap");
        return null;
    }
    return new PegListenTogetherClient(raw);
}
