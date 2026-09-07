import { Effect } from "effect";
import { PreviewFailure, previewRecord, previewString } from "./preview-model.ts";
import {
  createPreviewCloudflare,
  loadPreviewCredentials,
  verifyPreviewAccount,
} from "./cloudflare/preview-cloudflare.ts";
import { createPreviewStateStore } from "./lifecycle/preview-state.ts";
import { previewGithubRequest } from "./preview-github.ts";

/** Shared protected context validates GitHub and Cloudflare identity for every lifecycle action. */
export const loadPreviewContext = (local: boolean) =>
  Effect.gen(function* () {
    const repository = previewString(
      local ? process.env["REPOSITORY"] : process.env["GITHUB_REPOSITORY"],
    );

    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
      return yield* Effect.fail(new PreviewFailure({ operation: "Preview repository invalid" }));
    }

    const metadata = yield* previewGithubRequest(`/repos/${repository}`);

    if (typeof metadata["id"] !== "number" || metadata["full_name"] !== repository) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview repository identity mismatch" }),
      );
    }

    const credentials = yield* loadPreviewCredentials(local);
    yield* verifyPreviewAccount(credentials);

    const cf = createPreviewCloudflare(credentials);
    const subdomain = previewRecord(yield* cf.request("/workers/subdomain"));

    if (subdomain["subdomain"] !== credentials.workersSubdomain) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview Workers subdomain mismatch" }),
      );
    }

    const owner = { accountId: credentials.accountId, repositoryId: String(metadata["id"]), pr: 1 };
    return { repository, owner, credentials, cf, state: createPreviewStateStore(credentials) };
  });
