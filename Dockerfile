# syntax=docker/dockerfile:1
FROM node:24-trixie-slim@sha256:50c3b2f6988dfc307b86e5301d69611af31f4789bdf232863b07d3b02fe55ae0 AS manifests
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/workflows/package.json ./apps/workflows/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/api-contract/package.json ./packages/api-contract/
COPY packages/auth/package.json ./packages/auth/
COPY packages/platform/package.json ./packages/platform/
COPY packages/lint-rules/package.json ./packages/lint-rules/

FROM manifests AS dependencies
RUN --mount=type=cache,target=/root/.npm npm ci

FROM manifests AS workflow-dependencies
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --workspace=@factory/workflows --include-workspace-root=false

FROM dependencies AS build-base
COPY tsconfig.json ./
COPY scripts/build/build_node_cli.ts ./scripts/build/

FROM build-base AS api-build
COPY packages/platform ./packages/platform
COPY packages/auth ./packages/auth
COPY packages/api-contract ./packages/api-contract
COPY apps/api ./apps/api
RUN npm run build:node --workspace=@factory/api

FROM build-base AS frontend-build
COPY packages/api-client ./packages/api-client
COPY packages/api-contract ./packages/api-contract
COPY apps/frontend ./apps/frontend
RUN npm run build --workspace=@factory/frontend && npm run build:node --workspace=@factory/frontend

FROM build-base AS workflows-build
COPY packages/platform ./packages/platform
COPY apps/workflows ./apps/workflows
RUN npm run build:node --workspace=@factory/workflows

FROM node:24-trixie-slim@sha256:50c3b2f6988dfc307b86e5301d69611af31f4789bdf232863b07d3b02fe55ae0 AS slim-runtime
WORKDIR /app
ENV NODE_ENV=production
USER 65534:65534
ENTRYPOINT ["node"]

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:774b7d020b24214835769e24c3544835526cd0288f0b094eae48e8b2c2429a79 AS distroless-runtime
WORKDIR /app
ENV NODE_ENV=production

FROM slim-runtime AS api-slim
COPY --from=api-build /workspace/apps/api/dist ./dist
EXPOSE 8787
CMD ["dist/node_api.mjs"]

FROM distroless-runtime AS api
COPY --from=api-build /workspace/apps/api/dist ./dist
EXPOSE 8787
CMD ["dist/node_api.mjs"]

FROM slim-runtime AS frontend-slim
COPY --from=frontend-build /workspace/apps/frontend/dist ./dist
EXPOSE 5173
CMD ["dist/node_frontend.mjs"]

FROM distroless-runtime AS frontend
COPY --from=frontend-build /workspace/apps/frontend/dist ./dist
EXPOSE 5173
CMD ["dist/node_frontend.mjs"]

FROM distroless-runtime AS workflows
COPY --from=workflow-dependencies /workspace/node_modules ./node_modules
COPY --from=workflows-build /workspace/apps/workflows/dist ./dist
CMD ["dist/node_workflows.mjs"]

FROM slim-runtime AS workflows-slim
COPY --from=workflow-dependencies /workspace/node_modules ./node_modules
COPY --from=workflows-build /workspace/apps/workflows/dist ./dist
CMD ["dist/node_workflows.mjs"]

# Explicit target keeps Docker-only watchers and verification outside final app images.
FROM dependencies AS development
COPY . .
USER node
CMD ["npm", "run", "check"]
