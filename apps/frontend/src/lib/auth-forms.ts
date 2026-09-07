import { z } from "zod";
import { authClient } from "./auth-client.js";

const minimumPasswordLength = 12;
const maximumPasswordLength = 128;

const PasswordSchema = z
  .string()
  .min(minimumPasswordLength, "Use at least 12 characters.")
  .max(maximumPasswordLength);

const EmailSchema = z.email("Enter a valid email address.");

const SignupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name."),
  email: EmailSchema,
  password: PasswordSchema,
});

const LoginSchema = SignupSchema.omit({ name: true });
const EmailOnlySchema = SignupSchema.pick({ email: true });

const ResetSchema = z.object({
  password: PasswordSchema,
  token: z.string().min(1, "Open the link in your reset email."),
});

/** Auth route names are validated before selecting a form or official client operation. */
export const AuthModeSchema = z.enum([
  "login",
  "signup",
  "verify-email",
  "forgot-password",
  "reset-password",
]);

export type AuthMode = z.infer<typeof AuthModeSchema>;

/** Better Auth handles the authentication protocol; form validation is schema-first. */
export async function submitAuthentication(mode: AuthMode, values: FormData, token: string | null) {
  const input = Object.fromEntries(values);
  const callbackURL = new URL("/login?verified=true", window.location.origin).href;

  if (mode === "signup") {
    return authClient.signUp.email({ ...SignupSchema.parse(input), callbackURL });
  }

  if (mode === "login") {
    return authClient.signIn.email(LoginSchema.parse(input));
  }

  if (mode === "verify-email") {
    return authClient.sendVerificationEmail({ ...EmailOnlySchema.parse(input), callbackURL });
  }

  if (mode === "forgot-password") {
    return authClient.requestPasswordReset({
      ...EmailOnlySchema.parse(input),
      redirectTo: new URL("/reset-password", window.location.origin).href,
    });
  }

  const reset = ResetSchema.parse({ ...input, token });
  return authClient.resetPassword({ newPassword: reset.password, token: reset.token });
}

/** Validation feedback is safe to display and never echoes password values. */
export function authenticationError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Check the form fields.";
  }

  return "We couldn’t complete that request. Please try again.";
}
