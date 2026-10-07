import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/http";
import { decryptJson } from "@/lib/crypto";
import { confirmPayment, createOrder, READING_PRICE } from "@/lib/payments";
import { addConversationMessage, createReading, preparePaidPreview, purchasePromiseForReading, retryDetailedReading, storeStagedFreeReadingV3, toPublicReading } from "@/lib/readings";
import { STAGED_FREE_READING_V3_INSTRUCTION_VERSION, type StagedFreeReadingV3Payload } from "@/lib/types";
import { DETAILED_DREAM, TestRepository } from "./helpers/repository";

const originalAiMode = process.env.AI_MODE;
const originalAppProfile = process.env.APP_PROFILE;
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalPaymentMode = process.env.PAYMENTS_MODE;
const originalTossSecret = process.env.TOSS_SECRET_KEY;

afterEach(() => {
  if (originalAiMode === undefined) delete process.env.AI_MODE;
  else process.env.AI_MODE = originalAiMode;
  if (originalAppProfile === undefined) delete process.env.APP_PROFILE;
  else process.env.APP_PROFILE = originalAppProfile;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
  if (originalPaymentMode === undefined) delete process.env.PAYMENTS_MODE;
  else process.env.PAYMENTS_MODE = originalPaymentMode;
  if (originalTossSecret === undefined) delete process.env.TOSS_SECRET_KEY;
  else process.env.TOSS_SECRET_KEY = originalTossSecret;
  vi.unstubAllGlobals();
});

async function paidFixture(sessionHash: string) {
  delete process.env.AI_MODE;
  const repository = new TestRepository();
  const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, sessionHash, repository);
  const order = await createOrder(reading, "full_reading", sessionHash, repository);
  const paid = await confirmPayment(
    { paymentKey: `mock_${sessionHash}`, orderId: order.id, amount: READING_PRICE },
    sessionHash,
    repository
  );
  return { repository, paid, order };
}

describe("consultation payment flow", () => {
  it("keeps prepared detail encrypted and reveals the same report after payment", async () => {
    process.env.APP_PROFILE = "review";
    process.env.PAYMENTS_MODE = "mock";
    delete process.env.AI_MODE;
    const repository = new TestRepository();
    const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "prepared-preview", repository);
    const before = await toPublicReading(reading, "https://dream.example", repository);
    expect(before.canPurchaseFullReading).toBe(true);
    const preview = await preparePaidPreview(reading, repository);
    expect(preview.lead).toBeTruthy();
    expect(preview.lockedSections.length).toBeGreaterThan(0);
    const prepared = (await repository.getConversationTurns(reading.id)).find(turn => turn.id === `turn_prepared_${reading.id}`)!;
    expect(prepared.status).toBe("pending");
    const saved = decryptJson<{ payload: { sections: Array<{ paragraphs: string[] }> } }>(prepared.encryptedContent, "turn", prepared.id);
    const hiddenText = saved.payload.sections[1]!.paragraphs[0]!;
    expect(JSON.stringify(preview)).not.toContain(hiddenText);
    expect(JSON.stringify(await toPublicReading(reading, "https://dream.example", repository))).not.toContain(hiddenText);
    const order = await createOrder(reading, "full_reading", "prepared-preview", repository, purchasePromiseForReading(reading, await repository.getConversationTurns(reading.id))!);
    const paid = await confirmPayment({ paymentKey: "mock_prepared-preview", orderId: order.id, amount: READING_PRICE }, "prepared-preview", repository);
    const detailed = (await repository.getConversationTurns(paid.id)).find(turn => turn.id === `turn_detailed_${paid.id}`)!;
    const delivered = decryptJson<{ sections: Array<{ paragraphs: string[] }> }>(detailed.encryptedContent, "turn", detailed.id);
    expect(delivered.sections[1]!.paragraphs[0]).toBe(hiddenText);
  });
  it("admits only an eligible Free V3 snapshot when clarification readiness is false", async () => {
    process.env.APP_PROFILE = "review";
    process.env.PAYMENTS_MODE = "mock";
    delete process.env.AI_MODE;
    const repository = new TestRepository();
    const dream = "길을 잃고 직원에게 물어 큰길로 나왔어요.";
    const reading = await createReading({ dream, emotion: null }, "session-v3-admission", repository);
    const item = (label: string, quote: string) => ({ label, evidenceQuotes: [quote] });
    await storeStagedFreeReadingV3(reading.id, {
      freeCompositionVersion: 3,
      contentContractVersion: 1,
      instructionVersion: STAGED_FREE_READING_V3_INSTRUCTION_VERSION,
      generationInstructionSha256: "a".repeat(64),
      appInstructionsSha256: "b".repeat(64),
      generationSource: "codex",
      title: "멈춤 뒤 방향을 바꾼 꿈",
      primarySection: { heading: "멈춤 뒤 선택", paragraphs: ["다리 한가운데서 멈춘 순간이 이 꿈의 긴장을 만들어요.", "하지만 끝까지 버티기보다 옆길을 택했다는 변화가 중심이에요."] },
      secondarySection: { heading: "끝에 남은 안도", paragraphs: ["마지막에 편안함이 남아 처음의 두려움과 다른 방향을 더합니다."] },
      coverage: {
        primary: item("길을 잃음", "길을 잃고"),
        secondary: item("직원에게 물음", "직원에게 물어"),
        reserved: [item("큰길로 나옴", "큰길로 나왔어요")]
      },
      contentContract: {
        delivered: item("길을 잃음", "길을 잃고"),
        discovered: item("직원에게 물음", "직원에게 물어"),
        reserved: [item("큰길로 나옴", "큰길로 나왔어요")],
        offerEligibility: { eligible: true, perspectives: [
          item("직원에게 물음", "직원에게 물어"),
          item("큰길로 나옴", "큰길로 나왔어요")
        ] }
      }
    }, repository);
    const turns = await repository.getConversationTurns(reading.id);
    const promise = purchasePromiseForReading(reading, turns);
    expect(promise?.promiseVersion).toBe("paid-offer-v2");
    const preview = await toPublicReading(reading, "https://dream.example", repository);
    expect(preview.freeDetailGuidance?.ready).toBe(false);
    expect(preview.canPurchaseFullReading).toBe(true);
    const order = await createOrder(reading, "full_reading", "session-v3-admission", repository, promise!);
    expect(order.purchasePromiseSnapshot).toEqual(promise);
    expect(order.status).toBe("pending");

    const insufficientReading = await createReading({ dream, emotion: null }, "session-v3-insufficient", repository);
    const sourceTurn = (await repository.getConversationTurns(reading.id)).findLast(turn => turn.kind === "free" && turn.role === "kkumgyeol")!;
    const insufficientPayload = structuredClone(decryptJson<StagedFreeReadingV3Payload>(sourceTurn.encryptedContent, "turn", sourceTurn.id));
    insufficientPayload.contentContract.offerEligibility = { eligible: false, perspectives: [] };
    await storeStagedFreeReadingV3(insufficientReading.id, insufficientPayload, repository);
    const insufficientPublic = await toPublicReading(insufficientReading, "https://dream.example", repository);
    expect(insufficientPublic.freeDetailGuidance?.ready).toBe(false);
    expect(insufficientPublic.paidOffer).toBeNull();
    expect(insufficientPublic.canPurchaseFullReading).toBe(false);
    await expect(createOrder(insufficientReading, "full_reading", "session-v3-insufficient", repository)).rejects.toMatchObject({
      code: "PURCHASE_PROMISE_UNAVAILABLE"
    });
  });

  it("keeps the clarification requirement for legacy V1/V2 offer snapshots", async () => {
    process.env.APP_PROFILE = "review";
    process.env.PAYMENTS_MODE = "mock";
    delete process.env.AI_MODE;
    const repository = new TestRepository();
    const reading = await createReading({ dream: "길을 잃었어요.", emotion: null }, "session-v2-admission", repository);
    const preview = await toPublicReading(reading, "https://dream.example", repository);
    expect(preview.freeDetailGuidance?.ready).toBe(false);
    await expect(createOrder(reading, "full_reading", "session-v2-admission", repository)).rejects.toMatchObject({
      code: "MORE_DREAM_DETAIL_REQUIRED"
    });
    expect(repository.orders.size).toBe(0);
  });

  it("keeps paid-generation progress monotonic after the entitlement checkpoint", async () => {
    delete process.env.AI_MODE;
    const repository = new TestRepository();
    const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "session-paid-progress", repository);
    const order = await createOrder(reading, "full_reading", "session-paid-progress", repository);
    const progress: Array<{ stage: string; percent: number }> = [];

    await confirmPayment(
      { paymentKey: "mock_session-paid-progress", orderId: order.id, amount: READING_PRICE },
      "session-paid-progress",
      repository,
      (update) => progress.push({ stage: update.stage, percent: update.percent })
    );

    expect(progress.map((update) => update.stage)).toEqual([
      "payment_request_verified",
      "payment_approved",
      "reading_entitlement_saved",
      "detailed_generation_started",
      "detailed_reading_generated",
      "detailed_turn_saved",
      "detailed_reading_saved"
    ]);
    expect(progress.map((update) => update.percent)).toEqual([12, 30, 48, 52, 90, 94, 97]);
    expect(progress.every((update, index) => index === 0 || update.percent >= progress[index - 1]!.percent)).toBe(true);
  });

  it("completes the paid review flow with rule-based interpretation and no AI key", async () => {
    process.env.APP_PROFILE = "review";
    process.env.AI_MODE = "openai";
    delete process.env.OPENAI_API_KEY;
    const repository = new TestRepository();
    const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "session-review", repository);
    const order = await createOrder(reading, "full_reading", "session-review", repository);
    const paid = await confirmPayment(
      { paymentKey: "mock_session-review", orderId: order.id, amount: READING_PRICE },
      "session-review",
      repository
    );
    const publicReading = await toPublicReading(paid, "https://dream.example", repository);
    const detailed = publicReading.timeline.find((turn) => turn.kind === "detailed");

    expect(paid.status).toBe("paid_ready");
    expect(publicReading.detailGenerationStatus).toBe("ready");
    expect(detailed?.content).toMatchObject({ generationSource: "local" });
    expect(publicReading.entitlement.remainingQuestions).toBe(2);
  });

  it("creates only one pending full-reading order at the fixed 990 won price", async () => {
    const repository = new TestRepository();
    const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "session-pay", repository);

    const first = await createOrder(reading, "full_reading", "session-pay", repository);
    const second = await createOrder(
      (await repository.getReading(reading.id))!,
      "full_reading",
      "session-pay",
      repository
    );

    expect(first.amount).toBe(READING_PRICE);
    expect(first.product).toBe("full_reading");
    expect(second.id).toBe(first.id);
    expect(repository.orders.size).toBe(1);
  });

  it("rejects an amount changed by the browser", async () => {
    const repository = new TestRepository();
    const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "session-mismatch", repository);
    const order = await createOrder(reading, "full_reading", "session-mismatch", repository);

    await expect(
      confirmPayment(
        { paymentKey: "mock_amount_mismatch", orderId: order.id, amount: 1_900 },
        "session-mismatch",
        repository
      )
    ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH", status: 400 } satisfies Partial<AppError>);
    expect((await repository.getOrder(order.id))?.status).toBe("failed");
  });

  it("opens the detailed timeline and two questions, then treats repeated confirmation idempotently", async () => {
    const { repository, paid, order } = await paidFixture("session-paid");
    const repeated = await confirmPayment(
      { paymentKey: "mock_session-paid", orderId: order.id, amount: 990 },
      "session-paid",
      repository
    );
    const publicReading = await toPublicReading(repeated, "https://dream.example", repository);

    expect(paid.status).toBe("paid_ready");
    expect(publicReading.detailGenerationStatus).toBe("ready");
    expect(publicReading.timeline.filter((turn) => turn.kind === "detailed")).toHaveLength(1);
    expect(publicReading.entitlement.remainingQuestions).toBe(2);
    expect((await repository.getOrder(order.id))?.status).toBe("paid");
  });

  it("rejects a payment key reused by a different order with a stable client error", async () => {
    delete process.env.AI_MODE;
    const repository = new TestRepository();
    const firstReading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "session-key-one", repository);
    const secondReading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "session-key-two", repository);
    const firstOrder = await createOrder(firstReading, "full_reading", "session-key-one", repository);
    const secondOrder = await createOrder(secondReading, "full_reading", "session-key-two", repository);

    await confirmPayment(
      { paymentKey: "mock_shared_payment_key", orderId: firstOrder.id, amount: 990 },
      "session-key-one",
      repository
    );
    await expect(
      confirmPayment(
        { paymentKey: "mock_shared_payment_key", orderId: secondOrder.id, amount: 990 },
        "session-key-two",
        repository
      )
    ).rejects.toMatchObject({ code: "PAYMENT_KEY_ALREADY_USED", status: 409 } satisfies Partial<AppError>);
    expect((await repository.getOrder(secondOrder.id))?.status).toBe("failed");
  });

  it("recovers a Toss-approved payment before sending a duplicate approval request", async () => {
    delete process.env.AI_MODE;
    const repository = new TestRepository();
    const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "toss-existing-payment", repository);
    const order = await createOrder(reading, "full_reading", "toss-existing-payment", repository);
    delete process.env.APP_PROFILE;
    process.env.PAYMENTS_MODE = "toss"; process.env.TOSS_SECRET_KEY = "test-secret";
    const receipt = { paymentKey: "toss_key_123", orderId: order.id, status: "DONE", currency: "KRW", totalAmount: 990, balanceAmount: 990, lastTransactionKey: "tx_existing" };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(receipt), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const paid = await confirmPayment({ paymentKey: receipt.paymentKey, orderId: order.id, amount: 990 }, "toss-existing-payment", repository, undefined, () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
    expect(paid.detailGenerationStatus).toBe("generating");
    expect((await repository.getOrder(order.id))?.providerTransactionKey).toBe("tx_existing");
  });

  it("recovers a Toss approval whose HTTP response was lost", async () => {
    delete process.env.AI_MODE;
    const repository = new TestRepository();
    const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "toss-lost-response", repository);
    const order = await createOrder(reading, "full_reading", "toss-lost-response", repository);
    delete process.env.APP_PROFILE;
    process.env.PAYMENTS_MODE = "toss"; process.env.TOSS_SECRET_KEY = "test-secret";
    const receipt = { paymentKey: "toss_key_lost", orderId: order.id, status: "DONE", currency: "KRW", totalAmount: 990, balanceAmount: 990, lastTransactionKey: "tx_recovered" };
    const replies: Array<Response | Error> = [
      new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404, headers: { "content-type": "application/json" } }),
      new TypeError("connection reset after approval"),
      new Response(JSON.stringify(receipt), { status: 200, headers: { "content-type": "application/json" } })
    ];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const reply = replies.shift()!;
      if (reply instanceof Error) throw reply;
      return reply;
    });
    vi.stubGlobal("fetch", fetchMock);

    const paid = await confirmPayment({ paymentKey: receipt.paymentKey, orderId: order.id, amount: 990 }, "toss-lost-response", repository, undefined, () => {});
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(paid.detailGenerationStatus).toBe("generating");
    expect((await repository.getOrder(order.id))?.status).toBe("paid");
    expect((await repository.getEntitlement(reading.id))?.fullReadingPurchased).toBe(true);
  });

  it("deduplicates a repeated client message without charging twice", async () => {
    const { repository, paid } = await paidFixture("session-deduplicate");
    const input = { clientMessageId: "client_message_same", message: "현실의 일과 연결해줘" };

    await addConversationMessage(paid, input, repository);
    await addConversationMessage((await repository.getReading(paid.id))!, input, repository);
    const entitlement = await repository.getEntitlement(paid.id);

    expect(entitlement?.usedQuestions).toBe(1);
    expect((await repository.getConversationTurns(paid.id)).filter((turn) => turn.kind === "followup")).toHaveLength(2);
  });

  it("restores the question credit when follow-up generation fails", async () => {
    const { repository, paid } = await paidFixture("session-failure");
    process.env.AI_MODE = "openai";
    delete process.env.OPENAI_API_KEY;

    await expect(
      addConversationMessage(
        paid,
        { clientMessageId: "client_message_failure", message: "현실의 일과 더 자세히 연결해줘" },
        repository
      )
    ).rejects.toMatchObject({ code: "FOLLOWUP_GENERATION_FAILED", status: 502 } satisfies Partial<AppError>);

    expect((await repository.getEntitlement(paid.id))?.usedQuestions).toBe(0);
  });

  it("keeps a paid entitlement and exposes retry when detailed generation fails", async () => {
    const repository = new TestRepository();
    const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "session-detail-retry", repository);
    const order = await createOrder(reading, "full_reading", "session-detail-retry", repository);
    process.env.AI_MODE = "openai";
    delete process.env.OPENAI_API_KEY;
    const failed = await confirmPayment(
      { paymentKey: "mock_detail_retry", orderId: order.id, amount: 990 },
      "session-detail-retry",
      repository
    );
    const failedPublic = await toPublicReading(failed, "https://dream.example", repository);

    expect(failed.detailGenerationStatus).toBe("failed");
    expect(failedPublic.entitlement.fullReadingPurchased).toBe(true);
    expect(failedPublic.entitlement.remainingQuestions).toBe(2);
    expect(failedPublic.canRetryDetailedReading).toBe(true);

    process.env.AI_MODE = "local";
    const retried = await retryDetailedReading(failed, repository);
    const alreadyReady = await retryDetailedReading(retried, repository);
    expect(retried.detailGenerationStatus).toBe("ready");
    expect(alreadyReady.detailGenerationStatus).toBe("ready");
    expect((await toPublicReading(retried, "https://dream.example", repository)).timeline.filter((turn) => turn.kind === "detailed")).toHaveLength(1);
  });

  it("does not spend a question credit when a follow-up needs immediate safety routing", async () => {
    const { repository, paid } = await paidFixture("session-followup-safety");
    const updated = await addConversationMessage(
      paid,
      { clientMessageId: "client_safety_route", message: "지금 죽고 싶다는 생각이 계속 들고 혼자 있어요." },
      repository
    );
    const publicReading = await toPublicReading(updated, "https://dream.example", repository);

    expect((await repository.getEntitlement(paid.id))?.usedQuestions).toBe(0);
    expect(publicReading.entitlement.remainingQuestions).toBe(2);
    expect(publicReading.timeline.some((turn) => turn.kind === "safety")).toBe(true);
    expect(publicReading.timeline.filter((turn) => turn.kind === "followup" && turn.role === "kkumgyeol")).toHaveLength(0);
    await expect(
      addConversationMessage(
        updated,
        { clientMessageId: "client_after_safety", message: "그럼 꿈의 다른 장면을 계속 해석해줘" },
        repository
      )
    ).rejects.toMatchObject({ code: "SAFETY_ROUTE_ACTIVE", status: 409 } satisfies Partial<AppError>);
    expect((await repository.getEntitlement(paid.id))?.usedQuestions).toBe(0);
  });

  it("blocks purchases when the original message has current self-harm risk", async () => {
    const repository = new TestRepository();
    const reading = await createReading(
      { dream: "악몽에서 깬 뒤에도 지금 죽고 싶다는 생각이 계속 들고 혼자 있어요.", emotion: null },
      "session-purchase-safety",
      repository
    );

    await expect(
      createOrder(reading, "full_reading", "session-purchase-safety", repository)
    ).rejects.toMatchObject({ code: "PURCHASE_DISABLED", status: 409 } satisfies Partial<AppError>);
    const publicReading = await toPublicReading(reading, "https://dream.example", repository);
    expect(publicReading.canPurchaseFullReading).toBe(false);
    expect(publicReading.safetyNotice?.blocksInterpretation).toBe(true);
  });

  it("sells the extra two-question pack once and caps one dream at four follow-ups", async () => {
    const { repository, paid } = await paidFixture("session-pack");
    let current = paid;
    for (const suffix of ["one", "two"]) {
      current = await addConversationMessage(
        current,
        { clientMessageId: `client_base_${suffix}`, message: `현실의 관계와 연결해줘 ${suffix}` },
        repository
      );
    }

    const exhausted = await toPublicReading(current, "https://dream.example", repository);
    expect(exhausted.entitlement.remainingQuestions).toBe(0);
    expect(exhausted.entitlement.canPurchaseExtraPack).toBe(true);

    const expiryBeforePack = current.expiresAt;
    const packOrder = await createOrder(current, "followup_pack_2", "session-pack", repository);
    current = await confirmPayment(
      { paymentKey: "mock_pack_once", orderId: packOrder.id, amount: 990 },
      "session-pack",
      repository
    );
    expect((await toPublicReading(current, "https://dream.example", repository)).entitlement.remainingQuestions).toBe(2);
    expect(new Date(current.expiresAt).getTime()).toBeGreaterThanOrEqual(new Date(expiryBeforePack).getTime());
    await expect(createOrder(current, "followup_pack_2", "session-pack", repository)).rejects.toMatchObject({
      code: "FOLLOWUP_PACK_ALREADY_PURCHASED"
    });

    for (const suffix of ["three", "four"]) {
      current = await addConversationMessage(
        current,
        { clientMessageId: `client_extra_${suffix}`, message: `마지막으로 더 연결해줘 ${suffix}` },
        repository
      );
    }
    await expect(
      addConversationMessage(
        current,
        { clientMessageId: "client_fifth_question", message: "다섯 번째 질문이에요" },
        repository
      )
    ).rejects.toMatchObject({ code: "QUESTION_CREDITS_EXHAUSTED", status: 409 } satisfies Partial<AppError>);
    const finalPublic = await toPublicReading(current, "https://dream.example", repository);
    expect(finalPublic.entitlement.usedQuestions).toBe(4);
    expect(finalPublic.entitlement.remainingQuestions).toBe(0);
    expect(finalPublic.entitlement.canPurchaseExtraPack).toBe(false);
  });

  it("deletes the reading and all linked consultation data", async () => {
    const { repository, paid, order } = await paidFixture("session-delete");
    await repository.deleteReading(paid.id);

    expect(await repository.getReading(paid.id)).toBeNull();
    expect(await repository.getOrder(order.id)).toBeNull();
    expect(await repository.getEntitlement(paid.id)).toBeNull();
    expect(await repository.getConversationTurns(paid.id)).toEqual([]);
  });
});
