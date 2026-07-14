/*
Copyright 2026 NightSquawk Tech.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Listen Together — event schema + validation.
 *
 * Transport-agnostic: no matrix-js-sdk / module-api imports here. This is the shared
 * vocabulary every other file in the module imports, so `parse*` must be defensive
 * (return null on anything malformed rather than throwing) and `serialize*` must
 * produce clean wire content (no `undefined` fields).
 */

export const NS = "tech.nightsquawk.listen_together" as const;
export const EVENT_SHARE = `${NS}.share` as const;
export const EVENT_CONTROL = `${NS}.control` as const;

/** matrix EncryptedFile info (present when the room is E2EE). */
export interface EncryptedFileInfo {
    url: string; // mxc:// uri
    key: JsonWebKey;
    iv: string;
    hashes: Record<string, string>;
    v: string;
}

/** Content of a `${NS}.share` timeline event: the shared audio track. */
export interface ShareEventContent {
    mxc: string; // mxc:// uri (also present inside `file` when encrypted)
    filename: string;
    mimetype: string;
    durationMs: number;
    size?: number;
    file?: EncryptedFileInfo; // set iff the room is encrypted
}

export type ControlAction = "play" | "pause" | "seek";

/** Content of a `${NS}.control` timeline event: an anchor-model playback command. */
export interface ControlEventContent {
    action: ControlAction;
    trackEventId: string; // event id of the share event this controls
    positionMs: number; // intended playback position at `anchorTs`
    anchorTs: number; // homeserver time (ms since epoch) the position is anchored to
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null;
}

function isFiniteNumber(v: unknown): v is number {
    return typeof v === "number" && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
    return typeof v === "string" && v.length > 0;
}

/** Loose validation of an EncryptedFile info object — enough to catch malformed data. */
function isEncryptedFileInfo(v: unknown): v is EncryptedFileInfo {
    if (!isRecord(v)) return false;
    if (!isNonEmptyString(v.url)) return false;
    if (!isRecord(v.key)) return false;
    if (typeof v.iv !== "string") return false;
    if (!isRecord(v.hashes)) return false;
    for (const value of Object.values(v.hashes)) {
        if (typeof value !== "string") return false;
    }
    if (typeof v.v !== "string") return false;
    return true;
}

export function isShareContent(c: unknown): c is ShareEventContent {
    if (!isRecord(c)) return false;
    if (!isNonEmptyString(c.mxc)) return false;
    if (typeof c.filename !== "string") return false;
    if (typeof c.mimetype !== "string") return false;
    if (!isFiniteNumber(c.durationMs)) return false;
    if (c.size !== undefined && !isFiniteNumber(c.size)) return false;
    if (c.file !== undefined && !isEncryptedFileInfo(c.file)) return false;
    return true;
}

export function isControlContent(c: unknown): c is ControlEventContent {
    if (!isRecord(c)) return false;
    if (c.action !== "play" && c.action !== "pause" && c.action !== "seek") return false;
    if (!isNonEmptyString(c.trackEventId)) return false;
    if (!isFiniteNumber(c.positionMs)) return false;
    if (!isFiniteNumber(c.anchorTs)) return false;
    return true;
}

/** Parse+validate raw event content into a typed object, or null if malformed. */
export function parseShare(content: Record<string, unknown>): ShareEventContent | null {
    if (!isShareContent(content)) return null;
    const out: ShareEventContent = {
        mxc: content.mxc,
        filename: content.filename,
        mimetype: content.mimetype,
        durationMs: content.durationMs,
    };
    if (content.size !== undefined) out.size = content.size;
    if (content.file !== undefined) out.file = content.file;
    return out;
}

/** Parse+validate raw event content into a typed object, or null if malformed. */
export function parseControl(content: Record<string, unknown>): ControlEventContent | null {
    if (!isControlContent(content)) return null;
    return {
        action: content.action,
        trackEventId: content.trackEventId,
        positionMs: content.positionMs,
        anchorTs: content.anchorTs,
    };
}

/** Normalise a typed object into the wire content to send (drops undefined). */
export function serializeShare(input: ShareEventContent): Record<string, unknown> {
    const out: Record<string, unknown> = {
        mxc: input.mxc,
        filename: input.filename,
        mimetype: input.mimetype,
        durationMs: input.durationMs,
    };
    if (input.size !== undefined) out.size = input.size;
    if (input.file !== undefined) out.file = input.file;
    return out;
}

/** Normalise a typed object into the wire content to send (drops undefined). */
export function serializeControl(input: ControlEventContent): Record<string, unknown> {
    return {
        action: input.action,
        trackEventId: input.trackEventId,
        positionMs: input.positionMs,
        anchorTs: input.anchorTs,
    };
}
