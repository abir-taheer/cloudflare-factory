import { Effect, Layer } from "effect";
import { Email, ObjectStore, type ObjectStoreService } from "../../capability_services.js";
import { capabilityOperation } from "../capability_operation.js";

const hexadecimalRadix = 16;
const hexadecimalByteWidth = 2;

/** Private preview inbox shares the preview object store; never expose these objects over HTTP. */
export const makeCaptureEmailService = (objects: ObjectStoreService) =>
  Email.of({
    send: (message) =>
      Effect.gen(function* () {
        const recipientHash = yield* capabilityOperation("email", "captureRecipient", async () => {
          const recipient = new TextEncoder().encode(message.to.trim().toLowerCase());
          const digest = await crypto.subtle.digest("SHA-256", recipient);

          return Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(hexadecimalRadix).padStart(hexadecimalByteWidth, "0"),
          ).join("");
        });

        const contents = new TextEncoder().encode(
          JSON.stringify({ to: message.to, subject: message.subject, text: message.text }),
        );

        yield* objects.put(`auth-email/${recipientHash}/${crypto.randomUUID()}.json`, contents);
      }).pipe(Effect.withSpan("platform.email.capture")),
  });

/** Preview composition supplies its own isolated object store. */
export const captureEmailLayer = Layer.effect(
  Email,
  Effect.gen(function* () {
    const objects = yield* ObjectStore;
    return makeCaptureEmailService(objects);
  }),
);
