import { z } from "zod";

const minimumAuthenticationSecretLength = 32;

const ExactOriginSchema = z.string().refine((value) => {
  if (!URL.canParse(value)) {
    return false;
  }

  const origin = new URL(value);

  return (
    ["http:", "https:"].includes(origin.protocol) &&
    origin.origin === value &&
    !origin.hostname.includes("*")
  );
});

/** One validated contract is shared by authentication and app configuration boundaries. */
export const AuthenticationConfigurationSchema = z.object({
  environment: z.enum(["dev", "preview", "prod"]),
  apiUrl: ExactOriginSchema,
  frontendOrigins: z.array(ExactOriginSchema).min(1).readonly(),
  secret: z.string().min(minimumAuthenticationSecretLength).regex(/^\S+$/u),
  emailFrom: z.email(),
});

/** Auth inputs inherit their type from the runtime validation contract. */
export type AuthenticationConfiguration = z.infer<typeof AuthenticationConfigurationSchema>;
