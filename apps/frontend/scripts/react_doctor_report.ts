import { z } from "zod";

const reactDoctorReportVersion = 3;

const ReactDoctorProjectSchema = z
  .object({
    complete: z.literal(true),
    analyzedFileCount: z.int().nonnegative(),
    scannedFileCount: z.int().positive(),
    skippedChecks: z.array(z.unknown()).length(0),
    diagnostics: z.array(z.unknown()).length(0),
    skippedCheckReasons: z
      .record(z.string(), z.unknown())
      .refine((value) => Object.keys(value).length === 0)
      .optional(),
  })
  .refine((project) => project.analyzedFileCount === project.scannedFileCount);

/** Stock scanner output must prove a complete full scan with no suppressed or missing project results. */
export const ReactDoctorReportSchema = z.object({
  schemaVersion: z.literal(reactDoctorReportVersion),
  mode: z.literal("full"),
  ok: z.literal(true),
  reactDetected: z.literal(true),
  projects: z.array(ReactDoctorProjectSchema).length(1),
  diagnostics: z.array(z.unknown()).length(0),
  error: z.null(),
  summary: z.object({
    errorCount: z.literal(0),
    warningCount: z.literal(0),
    totalDiagnosticCount: z.literal(0),
  }),
});
