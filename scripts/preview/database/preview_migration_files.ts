import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import nodePath from "node:path";

/** Reject symlinks in every ancestor before reading a preview migration directory. */
export async function requirePreviewMigrationDirectory(directory: string): Promise<void> {
  const resolved = nodePath.resolve(directory);
  const parent = nodePath.dirname(resolved);

  if (parent !== resolved) {
    await requirePreviewMigrationDirectory(parent);
  }

  const stat = await lstat(resolved);

  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Preview migration directory rejected");
  }
}

/** Read a regular migration file with a bounded buffer, no symlink following and strict UTF-8. */
export async function readPreviewMigrationFile(file: string, limit: number): Promise<string> {
  const stat = await lstat(file);

  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) {
    throw new Error("Preview migration file rejected");
  }

  // oxlint-disable-next-line no-bitwise -- Node open flags require a bitmask to reject links and avoid blocking on special files.
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

  try {
    const opened = await handle.stat();

    if (!opened.isFile() || opened.size > limit) {
      throw new Error("Preview migration file limit exceeded");
    }

    const buffer = new Uint8Array(limit + 1);
    let length = 0;

    while (length <= limit) {
      const result = await handle.read(buffer, length, buffer.length - length, null);

      if (result.bytesRead === 0) {
        break;
      }

      length += result.bytesRead;
    }

    if (length > limit) {
      throw new Error("Preview migration file grew beyond limit");
    }

    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
  } finally {
    await handle.close();
  }
}
