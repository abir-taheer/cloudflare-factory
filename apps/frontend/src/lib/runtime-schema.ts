import { z } from "zod";

/** Public API origin excludes credentials, paths, query strings and fragments. */
export const PublicApiOriginSchema = z
  .string()
  .regex(/^\S+$/u)
  .refine((value) => {
    if (!URL.canParse(value)) {
      return false;
    }

    const url = new URL(value);

    return (
      ["http:", "https:"].includes(url.protocol) &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.pathname === "/" &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  });

/** Deployment artifact contains only these public scalar fields. */
export const PublicFrontendSchema = z.strictObject({
  API_URL: PublicApiOriginSchema,
  ENVIRONMENT: z.enum(["dev", "preview", "prod"]),
});

/** Decoded browser configuration never contains backend settings. */
export type PublicFrontendConfiguration = z.infer<typeof PublicFrontendSchema>;
