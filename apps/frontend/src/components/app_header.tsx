import { Link, Stack, Typography } from "@mui/material";
import { AppearanceSelect } from "./appearance_select.js";

const headerStyle = { alignItems: "center", justifyContent: "space-between" };
const captionStyle = { display: "block" };

export function AppHeader() {
  return (
    <Stack component="header" direction="row" sx={headerStyle}>
      <div>
        <Link href="/workspace" underline="none" color="text.primary" variant="h5">
          factory
        </Link>
        <Typography variant="caption" sx={captionStyle} color="text.secondary">
          A small space to build something.
        </Typography>
      </div>
      <AppearanceSelect />
    </Stack>
  );
}
