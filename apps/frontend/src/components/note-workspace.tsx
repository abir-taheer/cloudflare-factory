import { Alert, Button, Divider, Paper, Stack, TextField, Typography } from "@mui/material";
import { type SubmitEvent, useCallback, useState } from "react";
import { ApiIdSchema, CreateNoteSchema } from "@factory/api-contract/schema";
import { workspaceApi } from "../lib/api-client.js";
import { JobPanel } from "./job-panel.js";

const panelSpacing = { p: { xs: 3, md: 4 }, flex: 1, minWidth: 0 };
const noteTextStyle = { whiteSpace: "pre-wrap", overflowWrap: "anywhere" };

/** Note forms and reads share the API input schemas and generated Query operations. */
export function NoteWorkspace() {
  const [noteId, setNoteId] = useState("");
  const [formError, setFormError] = useState("");
  const createNote = workspaceApi.query.useMutation("post", "/api/v1/notes");

  const readNote = workspaceApi.query.useQuery(
    "get",
    "/api/v1/notes/{id}",
    { params: { path: { id: noteId } } },
    { enabled: noteId.length > 0 },
  );

  const note = readNote.data ?? createNote.data;

  const { mutate } = createNote;

  const handleCreate = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();

      const input = CreateNoteSchema.safeParse(
        Object.fromEntries(new FormData(event.currentTarget)),
      );

      if (!input.success) {
        setFormError("Write a note between 1 and 4,000 characters.");
        return;
      }

      setFormError("");
      setNoteId("");
      mutate({ body: input.data });
    },
    [mutate],
  );

  const handleRead = useCallback((event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    const input = ApiIdSchema.safeParse(new FormData(event.currentTarget).get("noteId"));

    if (!input.success) {
      setFormError("Enter the note ID returned when you created a note.");
      return;
    }

    setFormError("");
    setNoteId(input.data);
  }, []);

  return (
    <Stack component={Paper} sx={panelSpacing} spacing={3}>
      <Typography component="h2" variant="h5">
        Start with a note
      </Typography>
      <Stack component="form" spacing={2} onSubmit={handleCreate}>
        <TextField
          label="Note content"
          name="content"
          multiline
          minRows={4}
          placeholder="What are you working on?"
          required
        />
        <Button type="submit" variant="contained" loading={createNote.isPending}>
          Create note
        </Button>
      </Stack>
      <Divider />
      <Stack component="form" spacing={2} onSubmit={handleRead}>
        <TextField
          label="Note ID"
          name="noteId"
          placeholder="Open a note you created earlier"
          required
        />
        <Button type="submit" variant="outlined" loading={readNote.isFetching}>
          Read note
        </Button>
      </Stack>
      {formError.length > 0 && <Alert severity="error">{formError}</Alert>}
      {(createNote.isError || readNote.isError) && (
        <Alert severity="error">
          We couldn’t save or open that note. Check the ID and try again.
        </Alert>
      )}
      {note && (
        <div aria-live="polite">
          <Typography variant="caption" color="text.secondary">
            Note {note.id}
          </Typography>
          <Typography sx={noteTextStyle} data-testid="note-content">
            {note.content}
          </Typography>
        </div>
      )}
      <JobPanel key={note?.id ?? ""} noteId={note?.id ?? ""} />
    </Stack>
  );
}
