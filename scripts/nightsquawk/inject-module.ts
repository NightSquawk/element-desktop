#!/usr/bin/env -S npx tsx
/*
Copyright 2026 NightSquawk Tech.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Combine step for NightSquawk builds: inject a runtime-loaded Element Web module
 * into the prebuilt `webapp.asar` produced by `pnpm run fetch`.
 *
 * This mirrors the existing "Insert config snippet" pattern in
 * `.github/workflows/build_windows.yaml`: extract the asar, mutate the webapp,
 * then repack.
 *
 * What it does:
 *   1. Extract `webapp.asar` to a temp dir.
 *   2. Copy the built module bundle to `<webapp>/<dest>` (default `modules/listen-together.js`).
 *   3. Ensure the webapp `config.json` references the module under the loader key
 *      (idempotent; the NightSquawk variant config already declares it, but we
 *      self-heal in case a different config was packed in).
 *   4. Repack `webapp.asar`.
 *
 * VERIFIED (2026-07-14, against the packaged desktop build):
 *   - The runtime loader key IS "modules": element-web does `SdkConfig.get("modules")`
 *     then `await import(/* webpackIgnore *\/ src)` for each entry (runtime dynamic import,
 *     NOT build-time bundling — so injecting into the prebuilt webapp works).
 *   - The loader passes `src` to `import()` verbatim from a bundle chunk under
 *     webapp/bundles/<hash>/, so a bare ("modules/x.js") or "./"-relative specifier throws
 *     "Failed to resolve module specifier". The entry MUST be the fully-qualified URL the
 *     desktop file-protocol serves it from: vector://vector/webapp/modules/listen-together.js
 *     (overridable via --base-url).
 *
 * Usage:
 *   tsx scripts/nightsquawk/inject-module.ts \
 *     --asar webapp.asar \
 *     --module nightsquawk-modules/listen-together/dist/listen-together.js \
 *     [--dest modules/listen-together.js] \
 *     [--config-key modules] \
 *     [--base-url vector://vector/webapp/]
 */

import * as path from "node:path";
import * as os from "node:os";
import { promises as fs } from "node:fs";
import * as asar from "@electron/asar";

interface Args {
    asar: string;
    module: string;
    dest: string;
    configKey: string;
    baseUrl: string;
}

function parseArgs(argv: string[]): Args {
    const args: Args = {
        asar: "webapp.asar",
        module: "",
        dest: "modules/listen-together.js",
        configKey: "modules",
        // On desktop the webapp is served at vector://vector/webapp/ (electron-main
        // registerFileProtocol). element-web's loader does `import(src)` with the raw
        // config value from a bundle chunk under webapp/bundles/<hash>/, so the module
        // must be referenced by a fully-qualified URL, not a bare/relative path.
        baseUrl: "vector://vector/webapp/",
    };
    for (let i = 2; i < argv.length; i++) {
        switch (argv[i]) {
            case "--asar":
                args.asar = argv[++i];
                break;
            case "--module":
                args.module = argv[++i];
                break;
            case "--dest":
                args.dest = argv[++i];
                break;
            case "--config-key":
                args.configKey = argv[++i];
                break;
            case "--base-url":
                args.baseUrl = argv[++i];
                break;
            default:
                throw new Error(`Unknown argument: ${argv[i]}`);
        }
    }
    if (!args.module) throw new Error("--module <path to built bundle> is required");
    return args;
}

/**
 * Set the config loader entry for our module to exactly `moduleUrl`, removing any stale
 * entry (e.g. a bare/relative path from an older build) that references the same file —
 * a leftover unresolvable specifier would break loading of ALL modules.
 */
async function ensureModuleInConfig(
    configPath: string,
    key: string,
    moduleUrl: string,
    managedBasename: string,
): Promise<void> {
    let config: Record<string, unknown> = {};
    try {
        config = JSON.parse(await fs.readFile(configPath, "utf8"));
    } catch {
        console.warn(`No ${configPath} found in webapp; creating a minimal one.`);
    }
    const existing = Array.isArray(config[key]) ? (config[key] as string[]) : [];
    // Drop any prior entry pointing at our managed file (any URL form), then add the canonical one.
    const others = existing.filter((e) => !e.endsWith(managedBasename));
    const next = [...others, moduleUrl];
    if (JSON.stringify(next) !== JSON.stringify(existing)) {
        config[key] = next;
        await fs.writeFile(configPath, JSON.stringify(config, null, 4) + "\n");
        console.log(`Registered module under config["${key}"]: ${moduleUrl}`);
    } else {
        console.log(`Module already registered under config["${key}"]: ${moduleUrl}`);
    }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv);

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ns-webapp-"));
    try {
        console.log(`Extracting ${args.asar} -> ${tmp}`);
        asar.extractAll(args.asar, tmp);

        const destAbs = path.join(tmp, args.dest);
        await fs.mkdir(path.dirname(destAbs), { recursive: true });
        await fs.copyFile(args.module, destAbs);
        console.log(`Injected module: ${args.module} -> ${path.join(args.dest)}`);

        // The fully-qualified URL the loader should import (see baseUrl note in parseArgs).
        const relPath = args.dest.split(path.sep).join("/");
        const moduleUrl = args.baseUrl.replace(/\/$/, "") + "/" + relPath.replace(/^\//, "");
        await ensureModuleInConfig(path.join(tmp, "config.json"), args.configKey, moduleUrl, path.basename(relPath));

        console.log(`Repacking ${args.asar}`);
        await asar.createPackage(tmp, args.asar);
        console.log("Done.");
    } finally {
        await fs.rm(tmp, { recursive: true, force: true });
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
