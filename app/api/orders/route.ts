import { canAccessReading } from "@/lib/access";
import { reviewPurchaseLoginRequired } from "@/lib/app-profile";
import { readReviewSession } from "@/lib/auth/reviewer";
import { AppError, assertSameOrigin, errorResponse, noStoreJson } from "@/lib/http";
import { portoneCheckoutConfig, purchasesEnabled } from "@/lib/payment-config";
import { createOrder, paymentMode } from "@/lib/payments";
import { getRepository } from "@/lib/repository";
import { getOrCreateDreamSession } from "@/lib/session";
import { orderSchema, parseJson } from "@/lib/validation";
import { nodeOffReviewSiteEnabled } from "@/lib/nodeoff-review";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (nodeOffReviewSiteEnabled()) {
      throw new AppError("PAYMENT_DISABLED", "심사 사이트에서는 주문이나 결제를 진행할 수 없어요.", 503);
    }
    assertSameOrigin(request);
    const input = orderSchema.parse(await parseJson(request));
    if (reviewPurchaseLoginRequired() && !(await readReviewSession())) {
      throw new AppError("AUTH_REQUIRED", "결제 전에 로그인해 주세요.", 401);
    }
    const repository = getRepository();
    const reading = await repository.getReading(input.readingId);
    if (!reading) throw new AppError("READING_NOT_FOUND", "해몽 결과가 없거나 보관 기간이 지났어요.", 404);
    if (!(await canAccessReading(reading, input.restoreToken))) {
      throw new AppError("READING_ACCESS_DENIED", "이 해몽을 결제할 권한이 없어요.", 403);
    }
    const mode = paymentMode();
    if (mode === "disabled" || !purchasesEnabled()) {
      throw new AppError("PAYMENT_DISABLED", "현재는 전체 해몽 결제를 준비하고 있어요.", 503);
    }
    const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? null;
    if (mode === "toss" && !clientKey) {
      throw new AppError("PAYMENT_NOT_CONFIGURED", "결제 설정을 확인하고 다시 시도해 주세요.", 503);
    }
    const session = await getOrCreateDreamSession();
    const submittedPromise = input.promiseVersion && input.promiseSha256
      ? { promiseVersion: input.promiseVersion, promiseSha256: input.promiseSha256 }
      : undefined;
    const order = await createOrder(reading, input.product, session.hash, repository, submittedPromise);
    try {
      await repository.recordEvent({
        event: "checkout_started",
        readingId: reading.id,
        context: { paymentMode: mode, product: input.product },
        occurredAt: new Date().toISOString()
      });
    } catch {
      console.warn(JSON.stringify({ event:"checkout_analytics_write_failed",code:"EVENT_STORE_WRITE_FAILED" }));
    }
    return noStoreJson({
      order: {
        orderId: order.id,
        readingId: order.readingId,
        amount: order.amount,
        product: order.product,
        orderName: order.product === "full_reading" ? "여운 상세 꿈 해몽 1건" : "여운 추가 질문 2회",
        customerKey: `dream_${session.hash.slice(0, 36)}`,
        mode,
        clientKey: mode === "toss" ? clientKey : null,
        portone: mode === "portone" ? portoneCheckoutConfig() : null
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
