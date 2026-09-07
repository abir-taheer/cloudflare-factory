const chunkReloadCooldownMs = 60_000;

/** A stale lazy chunk triggers at most one reload per minute, then leaves a recovery surface. */
export function installChunkRecovery(): void {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();

    try {
      const lastReload = Number(sessionStorage.getItem("factory:chunk-reload") ?? "0");

      if (Date.now() - lastReload > chunkReloadCooldownMs) {
        sessionStorage.setItem("factory:chunk-reload", String(Date.now()));
        window.location.reload();
      }
    } catch {
      /* Storage denial must not create a reload loop. */
    }
  });
}
