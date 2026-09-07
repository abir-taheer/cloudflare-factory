"use strict";

/** @param {string} id */
function element(id) {
  const found = document.querySelector(`#${id}`);
  if (!(found instanceof HTMLElement)) throw new Error(`Frontend element missing: ${id}`);
  return found;
}
/** @param {string} id */
function inputElement(id) {
  const found = element(id);
  if (!(found instanceof HTMLInputElement) && !(found instanceof HTMLTextAreaElement)) throw new Error(`Frontend input missing: ${id}`);
  return found;
}
/** @param {string} id */
function buttonElement(id) {
  const found = element(id);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Frontend button missing: ${id}`);
  return found;
}
/** @param {unknown} data @param {string} key */
function stringField(data, key) {
  if (typeof data !== "object" || data === null) return null;
  /** @type {unknown} */
  const value = Reflect.get(data, key);
  return typeof value === "string" ? value : null;
}
/** @param {Promise<void>} task */
function startUiTask(task) {
  // DOM event handlers cannot await; attach a final rejection handler to each task.
  // eslint-disable-next-line promise/prefer-await-to-then -- Synchronous event-to-promise boundary with explicit rejection handling.
  task.catch(() => { element("health").textContent = "Frontend request failed"; });
}
const tokenInput = inputElement("token");
// Never persist credentials, note content, or API responses in browser storage.
tokenInput.value = "";
element("clear-token").addEventListener("click", () => { tokenInput.value = ""; tokenInput.focus(); });
window.addEventListener("pagehide", () => { tokenInput.value = ""; });

/** @param {string} path @param {Record<string, string>} [body] @returns {Promise<unknown>} */
async function requestApi(path, body) {
  const token = tokenInput.value.trim();
  if (token.length === 0) throw new Error("Enter a bearer token to call the API.");
  const headers = new Headers({ Authorization: `Bearer ${token}`, Accept: "application/json" });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST", headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000)
  });
  // Error bodies can contain implementation details; show only an HTTP status.
  if (!response.ok) throw new Error(`API request failed (${response.status}). ${response.status === 401 || response.status === 403 ? "Check your bearer token." : "Check the ID or try again."}`);
  if (response.status === 204) return { status: "accepted" };
  /** @type {unknown} */
  const data = await response.json();
  return data;
}

/** @param {string} formId @param {string} resultId @param {() => Promise<unknown>} action */
function bindApiForm(formId, resultId, action) {
  const form = element(formId);
  const button = form.querySelector("button");
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Frontend form button missing: ${formId}`);
  async function submitApiForm() {
    const result = element(resultId);
    button.disabled = true;
    result.dataset.state = "loading";
    result.textContent = "Request in progress…";
    try {
      const data = await action();
      result.dataset.state = "ok";
      result.textContent = JSON.stringify(data, null, 2);
    } catch (error) {
      result.dataset.state = "error";
      result.textContent = error instanceof Error ? error.message : "Request failed. Try again.";
    } finally { button.disabled = false; }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    startUiTask(submitApiForm());
  });
}

/** @param {string} id */
function resourceId(id) {
  const value = inputElement(id).value.trim();
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Enter a valid resource ID (letters, numbers, underscores or hyphens).");
  return value;
}

bindApiForm("create-note", "note-result", async () => {
  const content = inputElement("content").value;
  if (content.trim().length === 0) throw new Error("Write some note content first.");
  const note = await requestApi("/api/notes", { content });
  const noteId = stringField(note, "id");
  if (noteId !== null) {
    inputElement("note-id").value = noteId;
    inputElement("job-note-id").value = noteId;
  }
  return note;
});
bindApiForm("read-note", "note-result", () => requestApi(`/api/notes/${resourceId("note-id")}`));
bindApiForm("create-job", "job-result", async () => {
  element("job-status").textContent = "· Starting…";
  try {
    const job = await requestApi("/api/jobs", { noteId: resourceId("job-note-id") });
    const jobId = stringField(job, "id");
    if (jobId !== null) inputElement("job-id").value = jobId;
    element("job-status").textContent = `· ${stringField(job, "status") ?? "Accepted"}`;
    return job;
  } catch (error) { element("job-status").textContent = "· Start not confirmed"; throw error; }
});
bindApiForm("read-job", "job-result", async () => {
  element("job-status").textContent = "· Checking…";
  try {
    const job = await requestApi(`/api/jobs/${resourceId("job-id")}`);
    element("job-status").textContent = `· ${stringField(job, "status") ?? "Unknown"}`;
    return job;
  } catch (error) { element("job-status").textContent = "· Status unavailable"; throw error; }
});

async function checkHealth() {
  const button = buttonElement("refresh-health");
  const health = element("health");
  button.disabled = true;
  health.textContent = "Checking API…";
  health.dataset.state = "loading";
  element("environment").textContent = "Environment: unknown";
  try {
    const response = await fetch("/healthz", { cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Health check failed");
    /** @type {unknown} */
    const data = await response.json();
    health.textContent = "API healthy";
    health.dataset.state = "ok";
    element("environment").textContent = `Environment: ${stringField(data, "environment") ?? "not reported"}`;
  } catch {
    health.textContent = "API unavailable";
    health.dataset.state = "error";
  } finally { button.disabled = false; }
}
element("refresh-health").addEventListener("click", () => { startUiTask(checkHealth()); });
startUiTask(checkHealth());
