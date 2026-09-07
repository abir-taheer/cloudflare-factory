import { build } from "vite";
import { frontendViteConfiguration } from "./node_vite_config.js";

await build(frontendViteConfiguration());
