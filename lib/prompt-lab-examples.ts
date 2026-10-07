import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { AppError } from "./http";

const paidExamplesSchema = z.object({
  version: z.literal(2),
  examples: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1).max(120),
    dream: z.string().trim().min(2).max(2000),
    emotion: z.string().nullable(),
    source: z.enum(["favorite", "synthetic"])
  })).length(5)
});

export async function readPaidPromptLabExamples() {
  try {
    const raw = await readFile(join(process.cwd(), ".data", "prompt-lab", "paid-examples", "examples-v2.json"), "utf8");
    return paidExamplesSchema.parse(JSON.parse(raw)).examples.map(({ id, label, dream, emotion, source }) => ({
      id, label, dream, emotion, source
    }));
  } catch {
    throw new AppError("LAB_EXAMPLES_UNAVAILABLE", "예시 꿈을 불러오지 못했어요. 기존 실험 입력은 그대로 보존돼요.", 503);
  }
}
