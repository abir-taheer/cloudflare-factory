import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { createAppQueryClient } from "../lib/query_client.js";

const nonce = document.querySelector('meta[name="csp-nonce"]')?.getAttribute("content") ?? "";

const emotionCache = createCache({ key: "factory", nonce, prepend: true });
const queryClient = createAppQueryClient();

const appTheme = createTheme({
  cssVariables: { colorSchemeSelector: "class" },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: "#176b58" },
        background: { default: "#f5f7f6", paper: "#ffffff" },
      },
    },
    dark: {
      palette: {
        primary: { main: "#76d5b6" },
        background: { default: "#101815", paper: "#18231e" },
      },
    },
  },
  spacing: 8,
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
    h3: { fontWeight: 700, letterSpacing: "-0.025em" },
    h5: { fontWeight: 650 },
    button: { textTransform: "none", fontWeight: 650 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 8, padding: "10px 20px" } },
    },
    MuiTextField: { defaultProps: { fullWidth: true, variant: "outlined" } },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { border: "1px solid", borderColor: "var(--mui-palette-divider)" } },
    },
  },
});

/** Emotion receives the response nonce; MUI owns persisted light/dark/system mode. */
export function ApplicationProviders({ children }: PropsWithChildren) {
  return (
    <CacheProvider value={emotionCache}>
      <ThemeProvider theme={appTheme} defaultMode="system">
        <CssBaseline />
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ThemeProvider>
    </CacheProvider>
  );
}
