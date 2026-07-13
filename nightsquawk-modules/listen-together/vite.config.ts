import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import externalGlobals from "rollup-plugin-external-globals";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// Builds the module to a single ESM bundle that Element Web dynamic-imports at runtime.
// React/ReactDOM are externalised to reuse the host app's copies (the module receives
// `createRoot` from the Module API and shares Element Web's React instance).
//
// VERIFY IN SPIKE: confirm the host exposes React on the expected globals; if not,
// either bundle React or use `api.createRoot` exclusively and drop direct react-dom usage.
export default defineConfig({
    plugins: [
        react(),
        nodePolyfills(),
        {
            ...externalGlobals({
                react: "React",
                "react-dom": "ReactDOM",
            }),
            enforce: "post",
            apply: "build",
        },
    ],
    build: {
        target: "es2022",
        lib: {
            entry: "src/index.ts",
            formats: ["es"],
            fileName: () => "listen-together.js",
        },
        rollupOptions: {
            external: ["react", "react-dom", "react-dom/client"],
        },
        outDir: "dist",
        emptyOutDir: true,
    },
});
