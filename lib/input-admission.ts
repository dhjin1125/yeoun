import { AppError } from "./http";
import { opaqueToken } from "./crypto";
import type { DreamRepository } from "./repository";
import type { ConsultationPlan } from "./types";

export function assertDreamAdmission(plan: ConsultationPlan | undefined, answered = false) {
  if (plan?.disposition === "NOT_DREAM" || plan?.disposition === "EXTERNAL_INSTRUCTION") {
    throw new AppError("DREAM_INPUT_UNRELATED", "꿈에서 어떤 일이 있었는지 한 장면만 적어주세요. 등장한 대상만이 아니라 무엇을 했는지 알려주시면 돼요.", 422);
  }
  if (plan?.disposition === "NEEDS_CONTEXT" && (answered || !plan.question)) {
    throw new AppError("DREAM_INPUT_NEEDS_CONTEXT", "아직 해석할 장면을 확인하지 못했어요. 꿈에서 있었던 일을 한 줄로 적어주세요.", 422);
  }
}

/** Durable server request budget, independent of purchases or question credits. */
export async function admitDreamRequest(sessionHash: string, repository: DreamRepository) {
  let result;
  try {
    result = await repository.mutateConversationGuard(`intake:${sessionHash}`, {
      kind: "admit", scope: "principal", lease: opaqueToken(9)
    }, Date.now() + 3_600_000);
  } catch {
    throw new AppError("DREAM_REQUEST_CHECK_UNAVAILABLE", "요청을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.", 503);
  }
  if (result.status !== "allowed") {
    throw new AppError("DREAM_REQUEST_RATE_LIMITED", `요청이 많아요. ${result.retryAfterSeconds || 1}초 후 다시 보내주세요.`, 429, result.retryAfterSeconds || 1);
  }
}
