import "server-only";
import { z } from "zod";
import { paidJobsEnabled, paidJobStore, paidOrderCapacityAvailable } from "./paid-jobs/runtime";

import { opaqueToken } from "./crypto";
import { hasDetailedGeneratorConfiguration } from "./ai";
import { AppError } from "./http";
import { mockPaymentsAllowed, paymentMode } from "./payment-config";
import { verifyPortOnePayment } from "./portone";
import type { ProgressReporter } from "./progress";
import { generateAndStoreDetailedReading, PAID_LIFETIME_MS, purchasePromiseForReading, readingDetailGuidance } from "./readings";
import { getRepository, type DreamRepository } from "./repository";
import { safetyNoticeForRoute } from "./safety";
import type { OrderProduct, OrderRecord, PurchasePromiseIdentity, ReadingEntitlement, ReadingRecord } from "./types";
import { samePurchasePromiseIdentity } from "./purchase-promise";

export const READING_PRICE = 990 as const;

export { paymentMode } from "./payment-config";

function totalAllowance(entitlement: ReadingEntitlement) {
  return entitlement.baseQuestionAllowance + entitlement.extraQuestionAllowance;
}

function isPaymentKeyConflict(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /(?:23505|SQLITE_CONSTRAINT_UNIQUE|UNIQUE constraint failed|payment_key_unique)/i.test(error.message);
}

export async function createOrder(
  readingInput: ReadingRecord,
  product: OrderProduct,
  sessionHash: string,
  repository: DreamRepository = getRepository(),
  submittedPromise?: PurchasePromiseIdentity
) {
  const reading = await repository.getReading(readingInput.id);
  if (!reading) throw new AppError("READING_NOT_FOUND", "해몽 결과가 없거나 보관 기간이 지났어요.", 404);
  const entitlement = await repository.getEntitlement(reading.id);
  if (!entitlement) throw new AppError("ENTITLEMENT_NOT_FOUND", "이용권 정보를 찾을 수 없어요.", 404);
  if (safetyNoticeForRoute(reading.safetyRoute)?.blocksInterpretation) {
    throw new AppError("PURCHASE_DISABLED", "지금은 결제보다 안전 안내를 우선해요.", 409);
  }
  if (!hasDetailedGeneratorConfiguration()) throw new AppError("DETAILED_SERVICE_UNAVAILABLE", "상세 풀이 연결을 점검하고 있어요. 지금은 결제를 진행하지 않아요.", 503);
  if (!(await paidOrderCapacityAvailable(repository))) throw new AppError("PAID_DELIVERY_UNAVAILABLE", "이미 구매한 풀이를 먼저 안전하게 처리하고 있어요. 결제 금액은 청구되지 않았으니 잠시 뒤 다시 시도해 주세요.", 503);

  let purchasePromiseSnapshot: OrderRecord["purchasePromiseSnapshot"];
  if (product === "full_reading") {
    if (entitlement.fullReadingPurchased) {
      throw new AppError("ALREADY_PURCHASED", "이미 전체 해몽이 열려 있어요.", 409);
    }
    if (reading.status !== "free_ready" && reading.status !== "payment_pending") {
      throw new AppError("FREE_READING_REQUIRED", "무료 해몽을 먼저 확인해 주세요.", 409);
    }
    const sourceTurns = await repository.getConversationTurns(reading.id);
    purchasePromiseSnapshot = purchasePromiseForReading(
      reading,
      sourceTurns,
      submittedPromise ? "confirmed" : "legacy_server_snapshot"
    ) ?? undefined;
    if (!purchasePromiseSnapshot) {
      throw new AppError("PURCHASE_PROMISE_UNAVAILABLE", "무료 결과의 구매 내용을 확인할 수 없어요. 결과를 다시 불러와 주세요.", 409);
    }
    if (submittedPromise && !samePurchasePromiseIdentity(submittedPromise, purchasePromiseSnapshot)) {
      throw new AppError("PURCHASE_PROMISE_STALE", "상세 해몽 내용이 갱신됐어요. 최신 내용을 확인한 뒤 다시 결제해 주세요.", 409);
    }
    if (!readingDetailGuidance(reading).ready && purchasePromiseSnapshot.promiseVersion !== "paid-offer-v2") {
      throw new AppError("MORE_DREAM_DETAIL_REQUIRED", "상세 풀이 전에 해석을 바꿀 핵심 사실을 확인해 주세요. 기억이 나지 않으면 무료 첫 읽기까지만 제공해요.", 409);
    }
  } else {
    if (!entitlement.fullReadingPurchased || reading.detailGenerationStatus !== "ready") {
      throw new AppError("PAID_READING_REQUIRED", "전체 해몽을 먼저 열어주세요.", 403);
    }
    if (entitlement.extraPackPurchased) {
      throw new AppError("FOLLOWUP_PACK_ALREADY_PURCHASED", "추가 질문 묶음은 한 번만 구매할 수 있어요.", 409);
    }
    if (entitlement.usedQuestions < totalAllowance(entitlement)) {
      throw new AppError("FOLLOWUP_CREDITS_REMAIN", "남은 질문을 먼저 사용해 주세요.", 409);
    }
  }

  const now = new Date().toISOString();
  const order: OrderRecord = {
    id: `order_${opaqueToken(12)}`,
    readingId: reading.id,
    sessionHash,
    product,
    amount: READING_PRICE,
    status: "pending",
    paymentKey: null,
    providerTransactionKey: null,
    ...(purchasePromiseSnapshot ? { purchasePromiseSnapshot } : {}),
    contentConsentAt: now,
    createdAt: now,
    updatedAt: now
  };
  const storedOrder = await repository.createPendingOrder(order, reading);
  if (purchasePromiseSnapshot && !samePurchasePromiseIdentity(storedOrder.purchasePromiseSnapshot, purchasePromiseSnapshot)) {
    throw new AppError("PURCHASE_PROMISE_STALE", "이 주문에는 이전에 확인한 상세 해몽 내용이 연결돼 있어요. 주문을 다시 확인해 주세요.", 409);
  }
  return storedOrder;
}

async function tossRequest(path: string, body?: unknown, method: "GET" | "POST" = "POST") {
  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) throw new AppError("PAYMENT_NOT_CONFIGURED", "결제 설정을 확인하고 다시 시도해 주세요.", 503);
  const authorization = Buffer.from(`${secretKey}:`, "utf8").toString("base64");
  let response: Response;
  try {
    response = await fetch(`https://api.tosspayments.com${path}`, {
      method,
      headers: { Authorization: `Basic ${authorization}`, "Content-Type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new AppError("PAYMENT_PROVIDER_UNAVAILABLE", "결제 확인 연결이 잠시 끊겼어요. 다시 결제하지 말고 결제 확인을 다시 시도해 주세요.", 502);
  }
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new AppError(
      String(payload.code ?? "PAYMENT_PROVIDER_ERROR"),
      "결제를 승인하지 못했어요. 결제 내역을 확인한 뒤 다시 시도해 주세요.",
      response.status === 404 ? 404 : 502
    );
  }
  return payload;
}

const tossPaymentReceipt = z.object({
  paymentKey: z.string().min(1),
  orderId: z.string().min(1),
  status: z.string(),
  currency: z.string(),
  totalAmount: z.number().int(),
  balanceAmount: z.number().int(),
  lastTransactionKey: z.string().optional()
});

function verifyTossReceipt(payload: unknown, order: OrderRecord, paymentKey: string) {
  const parsed = tossPaymentReceipt.safeParse(payload);
  if (!parsed.success) throw new AppError("PAYMENT_RECEIPT_INVALID", "결제 응답의 금액과 주문을 확인하지 못했어요. 결제 확인을 다시 시도해 주세요.", 502);
  const payment = parsed.data;
  if (payment.paymentKey !== paymentKey || payment.orderId !== order.id) throw new AppError("PAYMENT_ORDER_MISMATCH", "결제 정보가 이 주문과 일치하지 않아요.", 400);
  if (payment.status !== "DONE" || payment.currency !== "KRW" || payment.totalAmount !== order.amount || payment.balanceAmount !== order.amount) {
    throw new AppError("PAYMENT_NOT_PAID", "승인된 결제의 상태와 금액이 주문과 일치하지 않아요. 결제 내역을 확인해 주세요.", 409);
  }
  return { paymentKey: payment.paymentKey, transactionKey: payment.lastTransactionKey ?? payment.paymentKey };
}

async function findApprovedTossPayment(order: OrderRecord, paymentKey: string) {
  try {
    const payload = await tossRequest(`/v1/payments/${encodeURIComponent(paymentKey)}`, undefined, "GET");
    const parsed = tossPaymentReceipt.safeParse(payload);
    if (!parsed.success) throw new AppError("PAYMENT_RECEIPT_INVALID", "결제 정보를 확인하지 못했어요. 결제 확인을 다시 시도해 주세요.", 502);
    if (parsed.data.status === "READY" || parsed.data.status === "IN_PROGRESS") return null;
    return verifyTossReceipt(parsed.data, order, paymentKey);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) return null;
    throw error;
  }
}

async function approveProviderPayment(order: OrderRecord, paymentKey: string, amount: number) {
  const mode = paymentMode();
  if (mode === "disabled") throw new AppError("PAYMENT_DISABLED", "현재 결제를 준비하고 있어요.", 503);
  if (mode === "mock") {
    if (!mockPaymentsAllowed()) {
      throw new AppError("MOCK_PAYMENT_DISABLED", "운영 환경에서는 테스트 결제를 사용할 수 없어요.", 503);
    }
    if (!paymentKey.startsWith("mock_")) {
      throw new AppError("INVALID_MOCK_PAYMENT", "테스트 결제 키가 올바르지 않아요.", 400);
    }
    return { paymentKey, transactionKey: `tx_${opaqueToken(10)}` };
  }
  if (mode === "portone") return verifyPortOnePayment(order, paymentKey);
  const alreadyApproved = await findApprovedTossPayment(order, paymentKey);
  if (alreadyApproved) return alreadyApproved;
  try {
    const approved = await tossRequest("/v1/payments/confirm", { paymentKey, orderId: order.id, amount });
    return verifyTossReceipt(approved, order, paymentKey);
  } catch (error) {
    // If Toss approved the charge but this process lost its response, recover
    // from the provider's receipt lookup instead of leaving a paid charge
    // without a local entitlement and durable delivery obligation.
    const recovered = await findApprovedTossPayment(order, paymentKey);
    if (recovered) return recovered;
    throw error;
  }
}

export async function confirmPayment(
  input: { paymentKey: string; orderId: string; amount: number },
  sessionHash: string,
  repository: DreamRepository = getRepository(),
  reportProgress?: ProgressReporter,
  scheduleGeneration?: (generate: () => Promise<ReadingRecord>) => void
) {
  const order = await repository.getOrder(input.orderId);
  if (!order) throw new AppError("ORDER_NOT_FOUND", "주문을 찾을 수 없어요.", 404);
  if (order.sessionHash !== sessionHash) throw new AppError("ORDER_ACCESS_DENIED", "주문 권한이 없어요.", 403);
  if (input.amount !== READING_PRICE || input.amount !== order.amount) {
    if (order.status === "pending") {
      order.status = "failed";
      order.updatedAt = new Date().toISOString();
      await repository.saveOrder(order);
    }
    throw new AppError("AMOUNT_MISMATCH", "결제 금액이 주문 금액과 다릅니다.", 400);
  }
  const reading = await repository.getReading(order.readingId);
  if (!reading) throw new AppError("READING_NOT_FOUND", "해몽 결과가 만료되었어요.", 410);
  reportProgress?.({
    stage: "payment_request_verified",
    percent: 12,
    label: "주문과 결제 금액을 확인했어요"
  });

  let paidAt: Date;
  let confirmedOrder = order;
  let committedReading: ReadingRecord | null = null;
  if (order.status === "paid") {
    if (order.paymentKey !== input.paymentKey) throw new AppError("PAYMENT_KEY_MISMATCH", "이미 다른 결제 정보로 확인된 주문이에요.", 409);
    paidAt = new Date(order.updatedAt);
  } else {
    if (order.status !== "pending") throw new AppError("ORDER_NOT_PENDING", "진행할 수 없는 주문 상태예요.", 409);
    if (order.verificationPaymentKey && order.verificationPaymentKey !== input.paymentKey) {
      throw new AppError("PAYMENT_KEY_MISMATCH", "결제 확인을 시작한 정보와 일치하지 않아요. 기존 결제 확인을 다시 시도해 주세요.", 409);
    }
    // Persist the provider identifier before network verification. If the provider
    // confirms but this process stops before SQLite commits, a retry can verify
    // the same payment instead of starting a new one.
    await repository.recordPaymentVerificationKey(order.id, sessionHash, input.paymentKey);
    confirmedOrder = { ...order, verificationPaymentKey: input.paymentKey };
    const approved = await approveProviderPayment(order, input.paymentKey, input.amount);
    paidAt = new Date();
    confirmedOrder = {
      ...confirmedOrder,
      status: "paid",
      paymentKey: approved.paymentKey,
      providerTransactionKey: approved.transactionKey,
      updatedAt: paidAt.toISOString()
    };
    try {
      // The repository transaction commits the verified order, entitlement,
      // reading status, and durable delivery outbox together.
      const jobs = paidJobStore(repository);
      committedReading = await repository.commitVerifiedPayment(confirmedOrder, paidAt.toISOString(), PAID_LIFETIME_MS, Boolean(jobs));
      reportProgress?.({ stage: "payment_approved", percent: 30, label: "결제 승인과 상세 풀이 작업을 안전하게 기록했어요" });
      if (jobs) {
        jobs.recoverUnqueued();
      }
      if (order.product === "followup_pack_2") {
        reportProgress?.({ stage: "followup_pack_saved", percent: 92, label: "추가 질문 2회를 상담 기록에 열었어요" });
      } else {
        reportProgress?.({ stage: "reading_entitlement_saved", percent: 48, label: "상세 해몽과 질문 이용권을 열었어요" });
      }
      if (jobs) return (await repository.getReading(committedReading.id)) ?? committedReading;
    } catch (error) {
      if (!isPaymentKeyConflict(error)) throw error;
      try {
        const stillPending = await repository.getOrder(order.id);
        if (stillPending?.status === "pending") {
          stillPending.status = "failed";
          stillPending.updatedAt = new Date().toISOString();
          await repository.saveOrder(stillPending);
        }
      } catch {
        // Keep the stable duplicate-key response even if the secondary status
        // update also fails; the unique payment-key constraint remains final.
      }
      throw new AppError(
        "PAYMENT_KEY_ALREADY_USED",
        "이미 다른 주문에 사용된 결제 정보예요. 결제 내역을 확인해 주세요.",
        409
      );
    }
  }
  const jobs = paidJobStore(repository);
  const committed = committedReading ?? await repository.commitVerifiedPayment(confirmedOrder, paidAt.toISOString(), PAID_LIFETIME_MS, Boolean(jobs));
  if (jobs) {
    jobs.recoverUnqueued();
    return (await repository.getReading(committed.id)) ?? committed;
  }
  const currentReading = (await repository.getReading(committed.id)) ?? committed;

  if (currentReading.detailGenerationStatus === "ready" || currentReading.detailGenerationStatus === "failed") {
    reportProgress?.({
      stage: "existing_detailed_status_found",
      percent: 94,
      label: currentReading.detailGenerationStatus === "ready" ? "이미 완성된 상세 해몽을 찾았어요" : "상세 해몽 재시도 상태를 확인했어요"
    });
    return currentReading;
  }
  if (currentReading.detailGenerationStatus === "generating") {
    if (paidJobsEnabled()) return generateAndStoreDetailedReading(currentReading, repository, reportProgress, order.id);
    reportProgress?.({
      stage: "detailed_generation_in_progress",
      percent: 58,
      label: "이미 시작된 상세 해몽 생성을 확인했어요"
    });
    return currentReading;
  }

  // Browser confirmation and provider webhooks can arrive together. Reserve the
  // first generation in the database without consuming a paid question.
  const reservationId = `payment_${order.id}`;
  const reservation = await repository.reserveQuestion(currentReading.id, reservationId, false);
  if (reservation.status !== "reserved") return (await repository.getReading(currentReading.id)) ?? currentReading;
  currentReading.status = "paid_generating";
  currentReading.detailGenerationStatus = "generating";
  await repository.saveReading(currentReading);
  const generate = async () => {
    try {
      const result = await generateAndStoreDetailedReading(currentReading, repository, reportProgress, order.id);
      await repository.completeQuestionReservation(currentReading.id, reservationId);
      return result;
    } catch {
      await repository.releaseQuestionReservation(currentReading.id, reservationId);
      // Keep the purchase and expose the existing no-charge retry flow.
      return currentReading;
    }
  };
  if (scheduleGeneration && !paidJobsEnabled()) {
    scheduleGeneration(generate);
    return currentReading;
  }
  return generate();
}
