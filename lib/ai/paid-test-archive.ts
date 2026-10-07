import "server-only";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { effectiveAiMode } from "../app-profile";
import { encryptJson } from "../crypto";
import { paymentMode } from "../payment-config";
import { PromptLabArchive } from "../prompt-lab-archive";

/** Private, encrypted attempt records for the explicitly enabled mock AI lab. */
export function createPaidTestRecorder() {
  const databasePath = process.env.DREAM_DATABASE_PATH?.trim();
  if (!databasePath || effectiveAiMode() !== "codex" || paymentMode() !== "mock") {
    return async (_stage: string, _payload: Record<string, unknown>) => undefined;
  }
  const traceId = randomUUID();
  const archive = new PromptLabArchive(join(dirname(resolve(databasePath)), "prompt-lab", "paid-runtime"));
  return async (stage: string, payload: Record<string, unknown>) => {
    await archive.record("snapshot", {
      type: "paid_generation_attempt", traceId, stage,
      encryptedDetails: encryptJson({ stage, payload }, "context", traceId)
    });
  };
}
