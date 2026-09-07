import { Alert, Button, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import { Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { authClient } from "../lib/auth_client.js";
import { workspaceApi } from "../lib/api_client.js";
import { NoteWorkspace } from "../components/note_workspace.js";

const headingStyle = {
  justifyContent: "space-between",
  alignItems: "center",
  gap: 2,
  flexWrap: "wrap",
};

const statusStyle = { gap: 1, flexWrap: "wrap" };

/** Session gating uses Better Auth; user-specific query data is cleared when signing out. */
export function WorkspacePage() {
  const session = authClient.useSession();
  const health = workspaceApi.query.useQuery("get", "/healthz");
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signout = useMutation({
    mutationFn: async () => {
      const result = await authClient.signOut();

      if (result.error) {
        throw new Error("Sign out failed");
      }
    },
    onSuccess: async () => {
      queryClient.clear();
      await navigate("/login", { replace: true });
    },
  });

  const { mutate } = signout;

  const handleSignout = useCallback(() => {
    mutate();
  }, [mutate]);

  let healthLabel = "Connecting to API";

  if (health.data) {
    healthLabel = `API healthy · ${health.data.environment}`;
  }

  if (session.isPending) {
    return <CircularProgress aria-label="Loading your session" />;
  }

  if (!session.data) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Stack spacing={4}>
      <Stack direction="row" sx={headingStyle}>
        <Typography component="h1" variant="h3">
          Your workspace
        </Typography>

        <Button variant="outlined" onClick={handleSignout}>
          Sign out
        </Button>
      </Stack>
      <Typography color="text.secondary">A note today. Something useful tomorrow.</Typography>
      <Stack direction="row" sx={statusStyle}>
        <Chip label={session.data.user.email} variant="outlined" />
        <Chip label={healthLabel} color={health.data ? "success" : "default"} variant="outlined" />
      </Stack>
      {signout.isError && <Alert severity="error">Sign out failed. Please try again.</Alert>}
      <NoteWorkspace />
    </Stack>
  );
}
