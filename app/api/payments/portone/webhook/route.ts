import { after } from "next/server";
import { Webhook } from "@portone/server-sdk";
import { AppError, errorResponse, noStoreJson } from "@/lib/http";
import { paymentMode } from "@/lib/payment-config";
import { confirmPayment } from "@/lib/payments";
import { getRepository } from "@/lib/repository";
import { nodeOffReviewSiteEnabled } from "@/lib/nodeoff-review";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (nodeOffReviewSiteEnabled()) throw new AppError("WEBHOOK_DISABLED", "심사 사이트에서는 결제 알림을 처리하지 않아요.", 503);
    const secret = process.env.PORTONE_WEBHOOK_SECRET?.trim();
    if (paymentMode() !== "portone" || !secret) throw new AppError("WEBHOOK_DISABLED", "결제 알림 연결을 사용할 수 없어요.", 503);
    const body = await request.text();
    if (body.length > 65_536) throw new AppError("INVALID_WEBHOOK", "올바르지 않은 결제 알림이에요.", 400);
    let event;
    try {
      event = await Webhook.verify(secret, body, Object.fromEntries(request.headers));
    } catch {
      throw new AppError("INVALID_WEBHOOK", "결제 알림 서명을 확인할 수 없어요.", 400);
    }
    if (event.type !== "Transaction.Paid") return noStoreJson({ received: true });
    if (event.data.storeId !== process.env.PORTONE_STORE_ID?.trim()) throw new AppError("INVALID_WEBHOOK_STORE", "상점 정보가 일치하지 않아요.", 400);
    const repository = getRepository();
    const order = await repository.getOrder(event.data.paymentId);
    if (!order) return noStoreJson({ received: true });
    // Verify with the provider and persist the purchase before acknowledging.
    // Generation continues after the response; retries cannot add credits again.
    await confirmPayment(
      { paymentKey: order.id, orderId: order.id, amount: order.amount },
      order.sessionHash,
      repository,
      undefined,
      (generate) => after(async () => { await generate(); })
    );
    return noStoreJson({ received: true });
  } catch (error) {
    return errorResponse(error);
  }
}
