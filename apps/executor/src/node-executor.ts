import { z } from "zod";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { Effect, FileSystem, Layer } from "effect";
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { readExecutorConfiguration } from "./node-executor-configuration.js";

interface ExecutorOutputBuffer {
  bytes: Uint8Array;
  size: number;
}

const executorOutputLimitBytes = 65_536;
const executorRequestLimitBytes = 16_384;
const executorCommandLimitCharacters = 4096;
const executorTimeoutLimitMs = 30_000;

const ExecutorRequestSchema = z.object({ command: z.string(), timeoutMs: z.number() });
const executorEnvironment = readExecutorConfiguration();
let executorBusy = false;

// Trusted local development only: commands share container identity and storage.
// Process groups clean up ordinary descendants; this is not tenant isolation.
const executeCommand = (command: string, timeoutMs: number) =>
  Effect.callback<HttpServerResponse.HttpServerResponse>((resume, signal) => {
    const child = spawn("/bin/sh", ["-c", command], {
      detached: true,
      cwd: "/tmp",
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp" },
    });

    const stdout = { bytes: new Uint8Array(executorOutputLimitBytes), size: 0 };
    const stderr = { bytes: new Uint8Array(executorOutputLimitBytes), size: 0 };
    let outputBytes = 0;
    let stopped = false;
    let groupTerminated = false;

    const killProcessGroup = () => {
      if (child.pid === undefined || groupTerminated) {
        return;
      }

      groupTerminated = true;

      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };

    const stop = () => {
      stopped = true;
      killProcessGroup();
    };

    const timer = setTimeout(stop, timeoutMs);
    signal.addEventListener("abort", stop, { once: true });

    const collect = (output: ExecutorOutputBuffer, chunk: Uint8Array) => {
      outputBytes += chunk.byteLength;

      if (outputBytes > executorOutputLimitBytes) {
        stop();
        return;
      }

      output.bytes.set(chunk, output.size);
      output.size += chunk.byteLength;
    };

    child.stdout.on("data", (chunk: Uint8Array) => {
      collect(stdout, chunk);
    });

    child.stderr.on("data", (chunk: Uint8Array) => {
      collect(stderr, chunk);
    });

    // A successful shell can leave background processes holding its output pipes.
    child.once("exit", killProcessGroup);
    child.once("error", stop);

    child.once("close", (exitCode) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      killProcessGroup();

      if (stopped || exitCode === null) {
        resume(Effect.succeed(HttpServerResponse.empty({ status: 408 })));
        return;
      }

      resume(
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({
            stdout: new TextDecoder().decode(stdout.bytes.subarray(0, stdout.size)),
            stderr: new TextDecoder().decode(stderr.bytes.subarray(0, stderr.size)),
            exitCode,
          }),
        ),
      );
    });

    if (signal.aborted) {
      stop();
    }

    return Effect.sync(() => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      stop();
    });
  });

const executeRequest = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const contentLength = Number(request.headers["content-length"] ?? "0");

    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      return HttpServerResponse.empty({ status: 400 });
    }

    if (contentLength > executorRequestLimitBytes) {
      return HttpServerResponse.empty({ status: 413 });
    }

    const body = yield* request.json.pipe(
      Effect.provideService(
        HttpServerRequest.MaxBodySize,
        FileSystem.Size(executorRequestLimitBytes),
      ),
      Effect.timeout("5 seconds"),
    );

    const result = ExecutorRequestSchema.safeParse(body);

    if (!result.success) {
      return HttpServerResponse.empty({ status: 400 });
    }

    const input = result.data;

    if (
      input.command.trim().length === 0 ||
      input.command.length > executorCommandLimitCharacters ||
      !Number.isInteger(input.timeoutMs) ||
      input.timeoutMs < 1 ||
      input.timeoutMs > executorTimeoutLimitMs
    ) {
      return HttpServerResponse.empty({ status: 400 });
    }

    return yield* executeCommand(input.command, input.timeoutMs);
  });

const application = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;

  if (request.headers["authorization"] !== `Bearer ${executorEnvironment.EXECUTOR_TOKEN}`) {
    return HttpServerResponse.empty({ status: 401 });
  }

  if (request.method !== "POST" || request.url !== "/execute") {
    return HttpServerResponse.empty({ status: 404 });
  }

  if (executorBusy) {
    return HttpServerResponse.empty({ status: 429 });
  }

  // Reserve the slot before reading the body so simultaneous readers cannot execute together.
  executorBusy = true;

  return yield* executeRequest(request).pipe(
    Effect.interruptible,
    Effect.ensuring(
      Effect.sync(() => {
        executorBusy = false;
      }),
    ),
  );
}).pipe(Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 400 })));

NodeRuntime.runMain(
  HttpServer.serve(application).pipe(
    Layer.provide(
      NodeHttpServer.layer(() => createServer({ requestTimeout: 5000, headersTimeout: 5000 }), {
        port: 8090,
        host: "0.0.0.0",
      }),
    ),
    Layer.launch,
  ),
);
