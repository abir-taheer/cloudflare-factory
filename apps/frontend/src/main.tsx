import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { ApplicationProviders } from "./components/application_providers.js";
import { loadFrontendConfiguration } from "./lib/runtime_configuration.js";
import { installChunkRecovery } from "./lib/chunk_recovery.js";
import { RouteErrorPage } from "./components/route_error_page.js";

const rootElement = document.querySelector("#root");

if (rootElement === null) {
  throw new Error("Frontend root element is missing");
}

const root = createRoot(rootElement);
installChunkRecovery();

async function bootstrapFrontend() {
  try {
    await loadFrontendConfiguration();

    const { router } = await import("./app.js");

    root.render(
      <StrictMode>
        <ApplicationProviders>
          <RouterProvider router={router} />
        </ApplicationProviders>
      </StrictMode>,
    );
  } catch {
    root.render(
      <ApplicationProviders>
        <RouteErrorPage />
      </ApplicationProviders>,
    );
  }
}

// eslint-disable-next-line node/no-top-level-await -- Browser ESM entrypoint is never loaded through Node require.
await bootstrapFrontend();
