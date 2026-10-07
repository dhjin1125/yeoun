import { errorResponse, noStoreJson } from "@/lib/http";
import { aiGenerationDisabled, appProfile, interpretationModeLabel } from "@/lib/app-profile";
import { paymentMode } from "@/lib/payment-config";
import { getRepository } from "@/lib/repository";
import { freeReadingReleaseStatus } from "@/lib/ai/free-reading-release";
import { PAID_READING_MODEL } from "@/lib/paid-reading-model";
import { paidJobStore } from "@/lib/paid-jobs/runtime";
import { PAID_PIPELINE_VERSION } from "@/lib/ai/paid-pipeline";

export const runtime = "nodejs";

export async function GET() {
  try {
    await getRepository().checkHealth();
    const jobs = paidJobStore();
    const delivery = jobs?.deliverySummary() ?? null;
    return noStoreJson({
      ok: true,
      profile: appProfile() ?? "custom",
      aiGeneration: aiGenerationDisabled() ? "disabled" : "enabled",
      interpretation: interpretationModeLabel(),
      freeReadingPrompt: await freeReadingReleaseStatus(),
      paidReadingModel: PAID_READING_MODEL,
      paidRecovery: jobs ? PAID_PIPELINE_VERSION : "request-bound",
      payment: paymentMode(),
      // Liveness is intentionally independent from delivery readiness. Docker
      // and the reverse proxy must not restart a healthy app because one paid
      // order needs operator attention; /api/readyz gates new orders instead.
      paidDelivery: jobs ? { workerHealthy:jobs.workerHealthy(), ...delivery } : "request-bound"
    });
  } catch (error) {
    return errorResponse(error);
  }
}
