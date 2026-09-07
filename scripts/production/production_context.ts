import { createCloudflareDomainProvider } from "../shared/domains/cloudflare_domain_provider.ts";
import {
  ProductionDomainPinsSchema,
  productionDomainConfiguration,
} from "./domains/production_domain_configuration.ts";
import { Config, Effect } from "effect";
import { z } from "zod";
import type { DatabaseHandoff } from "../shared/database/database_schema.ts";
import { loadDeploymentDoppler } from "../shared/deployment_doppler.ts";
import { previewGithubRequest } from "../preview/github/preview_github.ts";
import { previewIo, previewRecord, previewString } from "../preview/preview_model.ts";
import { ProductionAppSchema, parseProductionValue, productionPrefix } from "./production_model.ts";

const accountRequestTimeoutMs = 30_000;

/** Only protected default-branch releases may obtain production management capabilities. */
const ProductionDispatchSchema = z
  .strictObject({
    ...ProductionDomainPinsSchema.shape,
    GITHUB_ACTIONS: z.literal("true"),
    DEPLOYMENT_ENVIRONMENT: z.literal("cloudflare-prod"),
    GITHUB_EVENT_NAME: z.enum(["workflow_dispatch", "push"]),
    DEFAULT_BRANCH: z.string().min(1),
    GITHUB_REF: z.string(),
    REPOSITORY: z.string().regex(/^[\w.-]+\/[\w.-]+$/u),
    REPOSITORY_ID: z.string().regex(/^\d+$/u),
    REVISION: z.string().regex(/^[a-f\d]{40}$/u),
    DEPLOYMENT_APP: ProductionAppSchema,
    ALLOW_CREATE: z.enum(["true", "false"]),
    CLOUDFLARE_ACCOUNT_ID: z.string().regex(/^[a-f\d]{32}$/u),
    CLOUDFLARE_ACCOUNT_NAME: z.string(),
  })
  .refine(
    (value) =>
      value.GITHUB_REF === `refs/heads/${value.DEFAULT_BRANCH}` &&
      (value.GITHUB_EVENT_NAME === "workflow_dispatch" ||
        (value.DEPLOYMENT_APP === "all" && value.ALLOW_CREATE === "false")),
    "Production release requires the default branch and push releases cannot select apps or create resources",
  );

const ProductionRepositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: ProductionDispatchSchema.shape.REPOSITORY,
  default_branch: ProductionDispatchSchema.shape.DEFAULT_BRANCH,
});

const ProductionCommitSchema = z.object({ sha: ProductionDispatchSchema.shape.REVISION });

/** Typed configuration reads named keys before validating the protected dispatch. */
export const productionDispatch = Config.all({
  CLOUDFLARE_ZONE_ID: Config.string("CLOUDFLARE_ZONE_ID"),
  CLOUDFLARE_ZONE_NAME: Config.string("CLOUDFLARE_ZONE_NAME"),
  DOMAIN_SUFFIX: Config.string("DOMAIN_SUFFIX"),
  API_URL: Config.string("API_URL"),
  FRONTEND_URL: Config.string("FRONTEND_URL"),
  GITHUB_ACTIONS: Config.string("GITHUB_ACTIONS"),
  DEPLOYMENT_ENVIRONMENT: Config.string("DEPLOYMENT_ENVIRONMENT"),
  GITHUB_EVENT_NAME: Config.string("GITHUB_EVENT_NAME"),
  DEFAULT_BRANCH: Config.string("DEFAULT_BRANCH"),
  GITHUB_REF: Config.string("GITHUB_REF"),
  REPOSITORY: Config.string("REPOSITORY"),
  REPOSITORY_ID: Config.string("REPOSITORY_ID"),
  REVISION: Config.string("REVISION"),
  DEPLOYMENT_APP: Config.string("DEPLOYMENT_APP"),
  ALLOW_CREATE: Config.string("ALLOW_CREATE"),
  CLOUDFLARE_ACCOUNT_ID: Config.string("CLOUDFLARE_ACCOUNT_ID"),
  CLOUDFLARE_ACCOUNT_NAME: Config.string("CLOUDFLARE_ACCOUNT_NAME"),
}).pipe(Config.map((value) => parseProductionValue(ProductionDispatchSchema, value)));

/** Typed dispatch context has no local bypass or fallback branch. */
export type ProductionDispatch =
  typeof productionDispatch extends Config.Config<infer Value> ? Value : never;

/** Verify repository identity and the current default branch head before mutations and final sign-off. */
export const verifyProductionRevision = (dispatch: ProductionDispatch) =>
  Effect.gen(function* () {
    const repository = parseProductionValue(
      ProductionRepositorySchema,
      yield* previewGithubRequest(`/repos/${dispatch.REPOSITORY}`),
    );

    if (
      String(repository.id) !== dispatch.REPOSITORY_ID ||
      repository.full_name !== dispatch.REPOSITORY ||
      repository.default_branch !== dispatch.DEFAULT_BRANCH ||
      dispatch.GITHUB_REF !== `refs/heads/${dispatch.DEFAULT_BRANCH}`
    ) {
      throw new Error("Production default branch identity mismatch");
    }

    const head = parseProductionValue(
      ProductionCommitSchema,
      yield* previewGithubRequest(
        `/repos/${dispatch.REPOSITORY}/commits/${encodeURIComponent(dispatch.DEFAULT_BRANCH)}`,
      ),
    );

    if (head.sha !== dispatch.REVISION) {
      throw new Error("Production default branch revision changed");
    }
  });

/** Download only the prod CI config; identity is independently pinned by named environment variables. */
export const loadProductionContext = () =>
  Effect.gen(function* () {
    const dispatch = yield* productionDispatch;
    yield* verifyProductionRevision(dispatch);

    const config = yield* loadDeploymentDoppler("DEPLOY", "prod");

    if (
      config["ACCOUNT_ID"] !== dispatch.CLOUDFLARE_ACCOUNT_ID ||
      config["ACCOUNT_NAME"] !== dispatch.CLOUDFLARE_ACCOUNT_NAME ||
      config["ENVIRONMENT"] !== "prod"
    ) {
      throw new Error("Production account configuration mismatch");
    }

    const credentials = {
      accountId: dispatch.CLOUDFLARE_ACCOUNT_ID,
      token: previewString(config["CLOUDFLARE_API_TOKEN"]),
    };

    yield* previewIo("Production account verification failed", async () => {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}`,
        {
          headers: { Authorization: `Bearer ${credentials.token}` },
          signal: AbortSignal.timeout(accountRequestTimeoutMs),
          redirect: "error",
        },
      );

      if (!response.ok) {
        throw new Error("Production account unavailable");
      }

      const responseBody = await response.json();
      const account = previewRecord(previewRecord(responseBody)["result"]);

      if (
        account["id"] !== credentials.accountId ||
        account["name"] !== dispatch.CLOUDFLARE_ACCOUNT_NAME
      ) {
        throw new Error("Production account identity mismatch");
      }
    });

    const network = productionDomainConfiguration(config, dispatch);

    yield* createCloudflareDomainProvider({
      ...credentials,
      domains: network.domains,
    }).verifyZone();

    return {
      ...network,
      dispatch,
      config,
      credentials,
      prefix: productionPrefix(previewString(config["RESOURCE_PREFIX"])),
      owner: {
        accountId: credentials.accountId,
        repositoryId: dispatch.REPOSITORY_ID,
        environment: "prod",
        pr: null,
      } satisfies DatabaseHandoff["owner"],
    };
  });
