import { Alert, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import { CreateJobSchema } from "@factory/api-contract/schema";
import { useCallback } from "react";
import type { z } from "zod";
import { workspaceApi } from "../lib/api_client.js";

const pollIntervalMs = 1000;
const panelStyle = { p: { xs: 3, md: 4 }, flex: 1, minWidth: 0 };
const resultStyle = { whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "monospace" };
type JobPanelProps = z.infer<typeof CreateJobSchema>;

/** Workflow polling stops at completion and displays the real transformed payload. */
export function JobPanel({ noteId }: JobPanelProps) {
  const startJob = workspaceApi.query.useMutation("post", "/api/v1/jobs");
  const jobId = startJob.data?.id ?? "";

  const job = workspaceApi.query.useQuery(
    "get",
    "/api/v1/jobs/{id}",
    { params: { path: { id: jobId } } },
    {
      enabled: jobId.length > 0,
      refetchInterval: (query) =>
        query.state.data?.status === "completed" ? false : pollIntervalMs,
    },
  );

  const { mutate } = startJob;

  const handleStart = useCallback(() => {
    mutate({ body: CreateJobSchema.parse({ noteId }) });
  }, [mutate, noteId]);

  return (
    <Stack component={Paper} sx={panelStyle} spacing={3}>
      <div>
        <Typography variant="overline" color="primary">
          02 / Transform
        </Typography>
        <Typography component="h2" variant="h5">
          Put it to work
        </Typography>
      </div>
      <Typography color="text.secondary">
        Run your note through a background workflow. The completed result turns your words into
        uppercase.
      </Typography>
      <Button
        variant="contained"
        onClick={handleStart}
        disabled={noteId.length === 0}
        loading={startJob.isPending}
      >
        Run workflow
      </Button>
      {noteId.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Create or open a note to begin.
        </Typography>
      )}
      {(startJob.isError || job.isError) && (
        <Alert severity="error">The workflow request failed. Please try again.</Alert>
      )}
      {jobId.length > 0 && <Chip variant="outlined" label={job.data?.status ?? "pending"} />}
      {job.data?.status === "completed" && (
        <div aria-live="polite">
          <Typography variant="caption" color="text.secondary">
            Completed result
          </Typography>
          <Typography sx={resultStyle} data-testid="job-content">
            {job.data.content}
          </Typography>
        </div>
      )}
    </Stack>
  );
}
