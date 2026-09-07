import { MenuItem, TextField } from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import { type ChangeEvent, useCallback } from "react";
import { z } from "zod";

const ThemeModeSchema = z.enum(["light", "dark", "system"]);
const appearanceStyle = { width: 140 };

export function AppearanceSelect() {
  const { mode, setMode } = useColorScheme();

  const handleThemeChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const choice = ThemeModeSchema.safeParse(event.target.value);

      if (choice.success) {
        setMode(choice.data);
      }
    },
    [setMode],
  );

  return (
    <TextField
      select
      label="Appearance"
      size="small"
      value={mode ?? "system"}
      onChange={handleThemeChange}
      sx={appearanceStyle}
    >
      <MenuItem value="system">System</MenuItem>
      <MenuItem value="light">Light</MenuItem>
      <MenuItem value="dark">Dark</MenuItem>
    </TextField>
  );
}
