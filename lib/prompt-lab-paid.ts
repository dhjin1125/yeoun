import "server-only";

import { generateDetailedAssistant } from "./ai";
import { PAID_SAFETY_PROMPT } from "./ai/prompts";
import { promptLabArchive } from "./prompt-lab-archive";
import type { AiGenerationProgressReporter } from "./ai";
import type { DreamContext, GenerationUserEvidence, SafetyRoute } from "./types";

// Reuse the paid writer and independent reviewer, with no free reading or order.
// Every checkpoint is a new private file; an older experiment is never replaced.
export async function generatePaidLabReading(input: {
  context: DreamContext;
  sessionHash: string;
  dream: string;
  safetyRoute: SafetyRoute;
  evidence: GenerationUserEvidence;
  instructions: string;
  requestId: string;
  experimentId?: number;
  workspaceId?: string;
  report: AiGenerationProgressReporter;
}) {
  const record = async (payload: Record<string, unknown>) => {
    await promptLabArchive.record("snapshot", {
      type: "paid_lab_pipeline",
      requestId: input.requestId,
      experimentId: input.experimentId ?? null,
      workspaceId: input.workspaceId ?? null,
      ...payload
    });
  };
  return generateDetailedAssistant(
    input.context, input.sessionHash, input.safetyRoute, input.dream,
    input.evidence, input.report, undefined, undefined,
    { save: async state => record({ state }), record },
    undefined, `${input.instructions}\n\n${PAID_SAFETY_PROMPT}`
  );
}
