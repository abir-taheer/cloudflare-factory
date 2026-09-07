import { Navigate, createBrowserRouter } from "react-router-dom";
import { RouteErrorPage } from "./components/route-error-page.js";
import { AppShell } from "./components/app-shell.js";

/** Lazy route modules load after public configuration, with a safe root recovery boundary. */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: "/", element: <Navigate to="/workspace" replace /> },
      {
        path: "/workspace",
        lazy: async () => {
          const page = await import("./pages/workspace-page.js");
          return { Component: page.WorkspacePage };
        },
      },
      {
        path: "/:authMode",
        lazy: async () => {
          const page = await import("./pages/auth-page.js");
          return { Component: page.AuthPage };
        },
      },
      { path: "*", element: <RouteErrorPage /> },
    ],
  },
]);
