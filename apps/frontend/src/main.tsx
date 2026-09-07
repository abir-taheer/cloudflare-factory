import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { configureApiClient } from "@factory/api-client/http";
import { createAppQueryClient } from "./lib/query-client.js";
import { loadFrontendConfiguration } from "./lib/runtime-configuration.js";
import { installChunkRecovery } from "./lib/chunk-recovery.js";
import { RouteErrorPage } from "./components/route-error-page.js";

const rootElement = document.querySelector("#root");

if (rootElement === null) {
  throw new Error("Frontend root element is missing");
}

const root = createRoot(rootElement);
installChunkRecovery();

async function bootstrapFrontend() {
  try {
    const configuration = await loadFrontendConfiguration();
    configureApiClient(configuration.API_URL);

    const { router } = await import("./app.js");

    root.render(
      <StrictMode>
        <QueryClientProvider client={createAppQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </StrictMode>,
    );
  } catch {
    root.render(<RouteErrorPage />);
  }
}

// eslint-disable-next-line node/no-top-level-await -- Browser ESM entrypoint is never loaded through Node require.
await bootstrapFrontend();
