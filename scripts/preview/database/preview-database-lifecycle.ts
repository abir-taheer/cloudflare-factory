import { Effect } from "effect";
import { PreviewFailure, previewResource, previewResourcePlan } from "../preview-model.ts";
import type { PreviewManifest } from "../preview-model.ts";
import type { PreviewStateStore } from "../lifecycle/preview-state.ts";
import type { DatabaseIdentity } from "../../shared/database/database-schema.ts";
import type { PreviewDatabaseAdapter } from "../../shared/database/database-adapter.ts";

const previewLifetimeMs = 604_800_000;

type PreviewDatabaseRevision = Pick<PreviewManifest, "owner" | "head" | "sandbox">;

/** Persist a provider-neutral intent before any branch allocation, including the first failed create. */
export const provisionPreviewDatabase = (
  revision: PreviewDatabaseRevision,
  identity: DatabaseIdentity,
  adapter: PreviewDatabaseAdapter,
  state: PreviewStateStore,
) =>
  Effect.gen(function* () {
    const previous = yield* state.load(revision.owner);

    let manifest = previous;

    if (manifest === null || manifest.status === "deleted") {
      manifest = {
        version: 2,
        owner: revision.owner,
        head: revision.head,
        sandbox: revision.sandbox,
        database: identity,
        expiresAt: new Date(Date.now() + previewLifetimeMs).toISOString(),
        status: "deploying",
        resources: previewResourcePlan(revision.owner, revision.sandbox),
      };
    }

    if (
      manifest.status === "deleting" ||
      manifest.sandbox !== revision.sandbox ||
      manifest.database === null ||
      manifest.database.provider !== identity.provider ||
      manifest.database.projectId !== identity.projectId ||
      manifest.database.parentBranchId !== identity.parentBranchId
    ) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview database configuration drift; cleanup required" }),
      );
    }

    manifest.head = revision.head;
    manifest.status = "deploying";
    manifest.expiresAt = new Date(Date.now() + previewLifetimeMs).toISOString();

    const resource = previewResource(manifest, "postgres");

    if (resource.phase === "deleted") {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview database was deleted; finish cleanup first" }),
      );
    }

    resource.phase = "creating";
    yield* state.save(manifest);

    const handoff = yield* adapter.provision(
      {
        owner: { ...manifest.owner, environment: "preview" },
        name: resource.name,
        identity: manifest.database,
      },
      (next) => {
        manifest.database = next;
        resource.id = next.branchId;
        return state.save(manifest);
      },
    );

    resource.phase = "ready";
    resource.id = handoff.identity.branchId;
    yield* state.save(manifest);
    return handoff;
  });

/** Vendor cleanup runs only after every Cloudflare writer, binding and storage resource is absent. */
export const cleanupPreviewDatabase = (
  manifest: PreviewManifest,
  adapter: PreviewDatabaseAdapter,
  state: PreviewStateStore,
) =>
  Effect.gen(function* () {
    if (
      manifest.status !== "deleting" ||
      manifest.resources.some(
        (resource) => resource.kind !== "database" && resource.phase !== "deleted",
      )
    ) {
      return yield* Effect.fail(
        new PreviewFailure({
          operation: "Preview database retained until Cloudflare cleanup completes",
        }),
      );
    }

    const resource = previewResource(manifest, "postgres");

    if (manifest.database === null) {
      return yield* Effect.fail(
        new PreviewFailure({ operation: "Preview database deletion ownership missing" }),
      );
    }

    if (resource.phase !== "deleted") {
      yield* adapter.remove({
        owner: { ...manifest.owner, environment: "preview" },
        name: resource.name,
        identity: manifest.database,
      });

      resource.phase = "deleted";
    }

    manifest.status = "deleted";
    yield* state.save(manifest);
    process.stdout.write(`Preview resources verified absent for PR #${manifest.owner.pr}\n`);
    return yield* Effect.void;
  });
