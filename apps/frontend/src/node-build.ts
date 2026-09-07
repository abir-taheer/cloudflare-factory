import { build } from "vite";
import { frontendViteConfiguration } from "./node-vite-config.js";

await build(frontendViteConfiguration());
