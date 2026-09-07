import { Effect } from "effect";
import type { EmailService } from "@factory/platform";

/** Better Auth's Promise callback is the sole email execution boundary. */
export function deliverAuthenticationEmail(
  email: EmailService,
  from: string,
  to: string,
  subject: string,
  url: string,
) {
  const delivery = email.send({
    from,
    to,
    subject,
    text: `${subject}\n\n${url}\n\nIf you did not request this, ignore this email.`,
  });

  return Effect.runPromise(delivery);
}
