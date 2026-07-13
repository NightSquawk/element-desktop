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
 * VERIFY IN SPIKE (see docs/todo/listen-together-module.md):
 *   - `--config-key` (default "modules") is the *assumed* runtime module-loader key.
 *     Confirm against the fetched element-web version. If that element-web only
 *     supports BUILD-TIME module bundling, this injection approach does not work
 *     and the combine step must instead build element-web with the module.
 *   - Whether the loader resolves a webapp-relative URL ("modules/listen-together.js")
 *     or requires an absolute URL / different path.
 *
 * Usage:
 *   tsx scripts/nightsquawk/inject-module.ts \
 *     --asar webapp.asar \
 *     --module nightsquawk-modules/listen-together/dist/listen-together.js \
 *     [--dest modules/listen-together.js] \
 *     [--config-key modules]
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
}

function parseArgs(argv: string[]): Args {
    const args: Args = {
        asar: "webapp.asar",
        module: "",
        dest: "modules/listen-together.js",
        configKey: "modules",
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
            default:
                throw new Error(`Unknown argument: ${argv[i]}`);
        }
    }
    if (!args.module) throw new Error("--module <path to built bundle> is required");
    return args;
}

/** Add the module path to the config's loader array if not already present. */
async function ensureModuleInConfig(configPath: string, key: string, modulePath: string): Promise<void> {
    let config: Record<string, unknown> = {};
    try {
        config = JSON.parse(await fs.readFile(configPath, "utf8"));
    } catch {
        console.warn(`No ${configPath} found in webapp; creating a minimal one.`);
    }
    const existing = Array.isArray(config[key]) ? (config[key] as string[]) : [];
    if (!existing.includes(modulePath)) {
        config[key] = [...existing, modulePath];
        await fs.writeFile(configPath, JSON.stringify(config, null, 4) + "\n");
        console.log(`Registered module under config["${key}"]: ${modulePath}`);
    } else {
        console.log(`Module already registered under config["${key}"].`);
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

        // The webapp-relative URL the loader should import (config references it).
        const moduleUrl = args.dest.split(path.sep).join("/");
        await ensureModuleInConfig(path.join(tmp, "config.json"), args.configKey, moduleUrl);

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
