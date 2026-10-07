import { reviewPurchaseLoginRequired } from "@/lib/app-profile";
import { readReviewSession } from "@/lib/auth/reviewer";
import { assertSameOrigin, errorResponse, noStoreJson, requestOrigin, AppError } from "@/lib/http";
import { confirmPayment, paymentMode } from "@/lib/payments";
import { getPublicReading } from "@/lib/readings";
import { getRepository } from "@/lib/repository";
import { readDreamSession } from "@/lib/session";
import { parseJson, paymentConfirmationSchema } from "@/lib/validation";
import type { ProgressReporter } from "@/lib/progress";
import { acceptsProgressStream, progressStreamResponse } from "@/lib/progress-server";
import { nodeOffReviewSiteEnabled } from "@/lib/nodeoff-review";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (nodeOffReviewSiteEnabled()) {
      throw new AppError("PAYMENT_DISABLED", "심사 사이트에서는 주문이나 결제를 진행할 수 없어요.", 503);
    }
    assertSameOrigin(request);
    const input = paymentConfirmationSchema.parse(await parseJson(request));
    if (reviewPurchaseLoginRequired() && !(await readReviewSession())) {
      throw new AppError("AUTH_REQUIRED", "결제를 확인하려면 로그인해 주세요.", 401);
    }
    const session = await readDreamSession();
    if (!session) throw new AppError("SESSION_REQUIRED", "결제를 시작한 브라우저에서 다시 시도해 주세요.", 403);
    const repository = getRepository();
    const order = await repository.getOrder(input.orderId);
    const origin = requestOrigin(request);
    const run = async (report: ProgressReporter = () => undefined) => {
      const reading = await confirmPayment(input, session.hash, repository, report);
      try {
        await repository.recordEvent({
          event: order?.product === "followup_pack_2" ? "followup_pack_purchased" : "payment_succeeded",
          readingId: reading.id,
          context: { paymentMode: paymentMode(), product: order?.product ?? "full_reading" },
          occurredAt: new Date().toISOString()
        });
      } catch {
        console.warn(JSON.stringify({ event:"payment_analytics_write_failed",code:"EVENT_STORE_WRITE_FAILED" }));
      }
      const publicReading = await getPublicReading(reading, origin, repository);
      const label = reading.detailGenerationStatus === "failed"
        ? "결제는 보관했고 상세 해몽 재시도 상태를 준비했어요"
        : reading.detailGenerationStatus === "generating"
          ? "결제 확인을 마치고 진행 중인 생성을 연결했어요"
          : "결제와 결과 준비를 모두 마쳤어요";
      report({ stage: "result_ready", percent: 100, label });
      return { reading: publicReading };
    };
    if (acceptsProgressStream(request)) return progressStreamResponse(run);
    return noStoreJson(await run());
  } catch (error) {
    return errorResponse(error);
  }
}
