import { maximumSandboxFileBytes } from "../sandbox/managed-sandbox.js";

/** Drain raw RPC file bytes with a size bound and cancel the stream on interruption or overflow. */
export async function readSandboxFileBytes(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
) {
  const chunks: Uint8Array[] = [];
  let length = 0;

  const destination = new WritableStream<Uint8Array>({
    write: (chunk) => {
      length += chunk.byteLength;

      if (length > maximumSandboxFileBytes) {
        throw new Error("Sandbox file exceeds byte limit");
      }

      chunks.push(chunk);
    },
  });

  await stream.pipeTo(destination, { signal });

  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}
