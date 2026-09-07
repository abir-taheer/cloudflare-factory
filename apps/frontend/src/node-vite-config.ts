import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { InlineConfig } from "vite";

/** Credential-free Vite configuration shared by Docker HMR and production builds. */
export function frontendViteConfiguration(): InlineConfig {
  return {
    root: fileURLToPath(new URL("../", import.meta.url)),
    configFile: false,
    envDir: false,
    envPrefix: [],
    publicDir: false,
    cacheDir: "/tmp/factory-vite-cache",
    plugins: [react()],
    resolve: { alias: { "@": import.meta.dirname } },
    build: { target: "es2022", outDir: "dist", emptyOutDir: true, sourcemap: false },
  };
}
