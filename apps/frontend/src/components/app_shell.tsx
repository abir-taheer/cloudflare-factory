import { Container, Stack, Typography } from "@mui/material";
import { Outlet } from "react-router-dom";
import { AppHeader } from "./app_header.js";

const shellStyle = { py: 3 };
const mainStyle = { py: { xs: 3, md: 6 } };

/** Shared navigation and theme choice stay independent of authentication. */
export function AppShell() {
  return (
    <Container maxWidth="lg" sx={shellStyle}>
      <AppHeader />
      <Stack component="main" sx={mainStyle}>
        <Outlet />
      </Stack>
      <Typography component="footer" variant="caption" color="text.secondary">
        Your notes. Your workspace.
      </Typography>
    </Container>
  );
}
