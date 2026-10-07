import "server-only";

import { z } from "zod";
import { AppError } from "./http";
import { portoneCheckoutConfig } from "./payment-config";
import type { OrderRecord } from "./types";

const paymentReceipt = z.object({
  id: z.string(),
  status: z.string(),
  transactionId: z.string().min(1),
  storeId: z.string(),
  currency: z.string(),
  channel: z.object({ key: z.string(), type: z.string() }),
  amount: z.object({ total: z.number().int(), cancelled: z.number().int() })
});

export async function verifyPortOnePayment(order: OrderRecord, paymentId: string) {
  const config = portoneCheckoutConfig();
  const secret = process.env.PORTONE_API_SECRET?.trim();
  if (!config || !secret) throw new AppError("PAYMENT_NOT_CONFIGURED", "결제 연결을 확인하고 있어요. 잠시 후 다시 시도해 주세요.", 503);
  if (paymentId !== order.id) throw new AppError("PAYMENT_ORDER_MISMATCH", "결제 정보가 이 주문과 일치하지 않아요.", 400);

  let response: Response;
  try {
    response = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}?storeId=${encodeURIComponent(config.storeId)}`, {
      headers: { Authorization: `PortOne ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new AppError("PAYMENT_VERIFICATION_UNAVAILABLE", "결제 내역을 확인하지 못했어요. 다시 결제하지 말고 결제 확인을 다시 시도해 주세요.", 502);
  }
  if (!response.ok) throw new AppError("PAYMENT_VERIFICATION_UNAVAILABLE", "결제 내역을 확인하지 못했어요. 다시 결제하지 말고 결제 확인을 다시 시도해 주세요.", 502);
  const receipt = paymentReceipt.safeParse(await response.json().catch(() => null));
  if (!receipt.success) throw new AppError("PAYMENT_RECEIPT_INVALID", "결제 정보를 확인하지 못했어요. 잠시 후 결제 확인을 다시 시도해 주세요.", 502);
  const paid = receipt.data;
  if (paid.id !== order.id || paid.storeId !== config.storeId || paid.channel.key !== config.channelKey) {
    throw new AppError("PAYMENT_ORDER_MISMATCH", "결제 정보가 이 주문과 일치하지 않아요.", 400);
  }
  if (paid.channel.type !== "LIVE") throw new AppError("TEST_PAYMENT_NOT_ACCEPTED", "테스트 결제는 실제 구매로 처리하지 않아요.", 409);
  if (paid.amount.total !== order.amount || paid.currency !== "KRW" || paid.amount.cancelled !== 0) {
    throw new AppError("AMOUNT_MISMATCH", "승인된 금액이 주문 금액과 일치하지 않아요. 결제 내역을 확인해 주세요.", 400);
  }
  if (paid.status !== "PAID") throw new AppError("PAYMENT_NOT_PAID", "아직 결제 완료가 확인되지 않았어요. 잠시 후 다시 확인해 주세요.", 409);
  return { paymentKey: paid.id, transactionKey: paid.transactionId };
}
