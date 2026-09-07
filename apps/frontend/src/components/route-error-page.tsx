import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";

/** Route failures retain a safe recovery link without exposing exception details. */
export function RouteErrorPage() {
  return (
    <Container component="main" maxWidth="sm">
      <Typography component="h1" variant="h4">
        This page couldn’t load
      </Typography>
      <Typography>Try returning to your workspace.</Typography>
      <Link href="/workspace">Return to workspace</Link>
    </Container>
  );
}
