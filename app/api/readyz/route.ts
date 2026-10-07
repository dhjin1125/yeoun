import { paidOrderCapacityAvailable } from "@/lib/paid-jobs/runtime";
import { aiGenerationDisabled } from "@/lib/app-profile";
import { getRepository } from "@/lib/repository";
import { AppError, errorResponse, noStoreJson } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const repository = getRepository();
    await repository.checkHealth();
    if (aiGenerationDisabled()) return noStoreJson({ ok: true, readyForNewOrders: false });
    if (!(await paidOrderCapacityAvailable(repository))) {
      throw new AppError("PAID_DELIVERY_UNAVAILABLE", "기존 유료 작업을 안전하게 처리할 수 있을 때까지 새 결제를 잠시 멈췄어요.", 503);
    }
    return noStoreJson({ ok: true, readyForNewOrders: true });
  } catch (error) {
    return errorResponse(error);
  }
}
