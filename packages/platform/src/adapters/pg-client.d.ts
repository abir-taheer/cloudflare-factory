declare module "pg/lib/client.js" {
  /** pg exports this JS subpath; @types/pg declares its identical public class at the root. */
  export { Client as default } from "pg";
}
