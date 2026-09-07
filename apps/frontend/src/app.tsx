import { createBrowserRouter } from "react-router-dom";
import { RouteErrorPage } from "./components/route-error-page.js";

/** Only implemented pages are registered while feature work is paused. */
export const router = createBrowserRouter([
  { path: "*", element: <RouteErrorPage />, errorElement: <RouteErrorPage /> },
]);
