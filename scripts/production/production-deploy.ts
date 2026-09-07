import { Effect } from "effect";
import { loadDeploymentRuntime } from "../shared/deployment-doppler.ts";
import { previewRecord, previewString } from "../preview/preview-model.ts";
import { loadProductionContext, verifyProductionRevision } from "./production-context.ts";
import {
  deployProductionArtifact,
  validateProductionArtifacts,
} from "../build/production-artifacts.ts";
import {
  parseProductionInventory,
  productionApps,
  renderProductionWorkerConfig,
} from "./production-model.ts";
import {
  productionRequest,
  verifyProductionWorkerOwner,
  verifyProductionWorkerRelease,
  verifyProductionWorkflowOwner,
} from "./production-control.ts";
import { prepareProductionDeploymentDatabase } from "./production-database.ts";
import { verifyProductionApplication } from "./production-verify.ts";

/** One selected app is deployed from an exact-main artifact; all is reserved for ordered bootstrap. */
export const deployProductionApplication = () =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* loadProductionContext();
      const { dispatch, config, credentials, prefix, owner } = context;
      const selected = productionApps(dispatch.DEPLOYMENT_APP);

      const revision = {
        sha: dispatch.REVISION,
        repositoryId: dispatch.REPOSITORY_ID,
        app: dispatch.DEPLOYMENT_APP,
      };

      yield* validateProductionArtifacts("production-artifact", revision);

      const resources = parseProductionInventory(
        JSON.parse(previewString(config["RESOURCE_INVENTORY_JSON"])),
        prefix,
      );

      const subdomain = previewString(config["WORKERS_SUBDOMAIN"]);

      if (!/^[a-z\d][a-z\d-]*$/u.test(subdomain)) {
        throw new Error("Production Worker subdomain invalid");
      }

      const actualSubdomain = previewRecord(
        yield* productionRequest(credentials, "/workers/subdomain"),
      );

      if (actualSubdomain["subdomain"] !== subdomain) {
        throw new Error("Production account subdomain mismatch");
      }

      const urls = {
        api: `https://${prefix}-api.${subdomain}.workers.dev`,
        frontend: `https://${prefix}-frontend.${subdomain}.workers.dev`,
      };

      const prepared = [];
      const ownerMarker = `${owner.accountId}:${owner.repositoryId}:prod:${prefix}`;

      for (const app of selected) {
        const runtime = yield* loadDeploymentRuntime(app, "prod");
        const vars: Record<string, string> = runtime.vars;

        if (app !== "workflows" && vars["API_URL"] !== urls.api) {
          throw new Error("Production API origin differs from app configuration");
        }

        if (app === "api" && vars["FRONTEND_ORIGINS"] !== urls.frontend) {
          throw new Error("Production frontend origin differs from app configuration");
        }

        prepared.push({ app, runtime });

        yield* verifyProductionWorkerOwner(
          credentials,
          `${prefix}-${app}`,
          ownerMarker,
          dispatch.ALLOW_CREATE === "true",
        );
      }

      let dependencies = productionApps("all").filter((app) => !selected.includes(app));

      if (dispatch.DEPLOYMENT_APP === "frontend") {
        dependencies = ["api"];
      }

      for (const app of dependencies) {
        yield* verifyProductionWorkerOwner(credentials, `${prefix}-${app}`, ownerMarker, false);
      }

      if (selected.includes("workflows")) {
        yield* verifyProductionWorkflowOwner(credentials, prefix, ownerMarker);
      }

      let hyperdriveId = "";

      if (selected.some((app) => app !== "frontend")) {
        hyperdriveId = yield* prepareProductionDeploymentDatabase(context, resources);
      }

      for (const { app, runtime } of prepared) {
        yield* verifyProductionRevision(dispatch);

        const rendered = renderProductionWorkerConfig(
          {
            accountId: credentials.accountId,
            repositoryId: dispatch.REPOSITORY_ID,
            prefix,
            sha: dispatch.REVISION,
          },
          resources,
          app,
          "production-artifact",
          hyperdriveId,
          runtime.vars,
        );

        yield* deployProductionArtifact(credentials, rendered, runtime.secrets, app, runtime.vars);

        yield* verifyProductionWorkerRelease(
          credentials,
          `${prefix}-${app}`,
          dispatch.REVISION,
          app !== "workflows",
        );
      }

      yield* verifyProductionApplication(urls, dispatch.DEPLOYMENT_APP);
      yield* verifyProductionRevision(dispatch);

      process.stdout.write(
        "Production selected-app deployment and behavior verification passed.\n",
      );
    }),
  );
