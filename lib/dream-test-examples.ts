import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { DreamTestExample } from "./dream-test-example-types";

const localDreamTestExamplesSchema = z.object({
  version: z.literal(1),
  examples: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1).max(120),
    dream: z.string().trim().min(2).max(2_000),
    source: z.object({ label: z.string().min(1).max(160), url: z.string().url().nullable() }).optional()
  })).max(12)
});

export async function readLocalDreamTestExamples(): Promise<DreamTestExample[]> {
  if (process.env.NODE_ENV !== "development") return [];
  try {
    const raw = await readFile(join(process.cwd(), ".data", "local-dream-test-examples.json"), "utf8");
    return localDreamTestExamplesSchema.parse(JSON.parse(raw)).examples;
  } catch {
    return [];
  }
}
