import { Alert, Button, Link, Paper, Stack, TextField, Typography } from "@mui/material";
import { type SubmitEvent, useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AuthModeSchema, authenticationError, submitAuthentication } from "../lib/auth_forms.js";

const formCopy = {
  login: {
    title: "Welcome back",
    detail: "Sign in to pick up where you left off.",
    action: "Sign in",
  },
  signup: {
    title: "Make room for your ideas",
    detail: "Create an account. We’ll email you a verification link.",
    action: "Create account",
  },
  "verify-email": {
    title: "Check your inbox",
    detail: "Verify your email address before signing in. Need a fresh link?",
    action: "Send verification email",
  },
  "forgot-password": {
    title: "Let’s get you back in",
    detail: "We’ll email a secure link to reset your password.",
    action: "Send reset link",
  },
  "reset-password": {
    title: "A fresh start",
    detail: "Choose a new password with at least 12 characters.",
    action: "Save new password",
  },
};

const formLayout = { maxWidth: 460, mx: "auto", p: { xs: 3, sm: 5 } };

/** Accessible account forms use the official Better Auth client and no persistent credential storage. */
export function AuthPage() {
  const mode = AuthModeSchema.parse(useParams()["authMode"]);
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState("");
  const copy = formCopy[mode];
  const needsPassword = mode === "login" || mode === "signup" || mode === "reset-password";

  const authentication = useMutation({
    mutationFn: (values: FormData) => submitAuthentication(mode, values, search.get("token")),
    onError: (error) => {
      setFeedback(authenticationError(error));
    },
    onSuccess: async (result) => {
      if (result.error) {
        setFeedback(result.error.message ?? "Check your details and try again.");
        return;
      }

      queryClient.clear();

      if (mode === "login") {
        await navigate("/workspace");
        return;
      }

      if (mode === "signup") {
        await navigate("/verify-email");
        return;
      }

      if (mode === "reset-password") {
        await navigate("/login?reset=true");
        return;
      }

      setFeedback("If this address is eligible, an email is on its way. Check your inbox.");
    },
  });

  const { mutate } = authentication;

  const handleSubmit = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFeedback("");
      mutate(new FormData(event.currentTarget));
    },
    [mutate],
  );

  return (
    <Paper sx={formLayout}>
      <Stack spacing={3} component="form" onSubmit={handleSubmit}>
        <Typography component="h1" variant="h4" gutterBottom>
          {copy.title}
        </Typography>
        <Typography color="text.secondary">{copy.detail}</Typography>
        {search.has("error") && (
          <Alert severity="error">This link is invalid or expired. Request a fresh email.</Alert>
        )}
        {search.has("verified") && (
          <Alert severity="success">Email verified. You can sign in now.</Alert>
        )}
        {search.has("reset") && (
          <Alert severity="success">Password updated. Sign in with your new password.</Alert>
        )}
        {mode === "signup" && (
          <TextField name="name" label="Your name" autoComplete="name" required />
        )}
        {mode !== "reset-password" && (
          <TextField
            name="email"
            label="Email address"
            type="email"
            autoComplete="email"
            required
          />
        )}
        {needsPassword && (
          <TextField
            name="password"
            label="Password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            helperText="At least 12 characters"
            required
          />
        )}
        {feedback.length > 0 && <Alert severity="info">{feedback}</Alert>}
        <Button type="submit" variant="contained" loading={authentication.isPending}>
          {copy.action}
        </Button>
        {mode === "login" && <Link href="/signup">Create an account</Link>}
        {mode !== "login" && <Link href="/login">Back to sign in</Link>}
        {mode === "login" && <Link href="/forgot-password">Forgot password?</Link>}
        {mode === "login" && <Link href="/verify-email">Resend verification email</Link>}
      </Stack>
    </Paper>
  );
}
