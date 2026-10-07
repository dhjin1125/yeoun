import { describe, expect, it, vi } from "vitest";
import { createPurchasePromiseSnapshot, createPurchasePromiseSnapshotV2, sourceFreePayloadSha256 } from "@/lib/purchase-promise";
import { resolvePaidGenerationContract } from "@/lib/paid-generation-contract";
import { createStagedPaidOfferV2 } from "@/lib/paid-reading-v3";
import { createReading, getPublicReading, storeStagedFreeReadingV3, generateStagedPaidV3, purchasePromiseForReading } from "@/lib/readings";
import type { ConversationTurn, OrderRecord, PaidOffer, StagedFreeReadingV3Payload, StagedPaidV3Result } from "@/lib/types";
import { STAGED_FREE_READING_V3_INSTRUCTION_VERSION } from "@/lib/types";
import { TestRepository, DETAILED_DREAM } from "./helpers/repository";

const offer: PaidOffer = {
  variant: "editorial_depth_v2",
  headline: "꿈을 더 깊게 살펴봐요",
  bridge: "무료 해석에서 이어지는 장면을 읽어요.",
  checkoutTitle: "전체 해몽",
  checkoutSummary: "꿈의 흐름을 연결해 살펴봅니다.",
  cta: "전체 해몽 보기",
  trustLines: ["꿈에 적힌 장면을 바탕으로 해석해요."],
  riskClass: "standard",
  cards: []
};
const paidV3Offer = createStagedPaidOfferV2();
const dreamForV3Offer = "피가 나서 주치의에게 전화하고 응급실 가려고 했어요.";

const freeV2 = {
  freeCompositionVersion: 2 as const,
  generationSource: "openai" as const,
  directAnswer: "꿈속에서 평범한 행동이 갑자기 위급한 상황으로 바뀌었어요.",
  sections: [],
  interpretationChanges: null,
  uncertainty: [],
  shareableSentences: [],
  suggestedQuestions: []
};

const freeV3: StagedFreeReadingV3Payload = {
  freeCompositionVersion: 3,
  contentContractVersion: 1,
  instructionVersion: STAGED_FREE_READING_V3_INSTRUCTION_VERSION,
  generationInstructionSha256: "a".repeat(64),
  appInstructionsSha256: "b".repeat(64),
  generationSource: "codex",
  title: "가글 중 갑자기 위급해진 순간",
  primarySection: { heading: "갑자기 달라진 상황", paragraphs: ["평범한 가글 도중 갑작스러운 출혈이 시작됐어요.", "상황은 순식간에 위급한 쪽으로 크게 바뀌었어요."] },
  secondarySection: { heading: "도움을 찾은 행동", paragraphs: ["주치의에게 바로 전화하고 응급실로 가려 했어요."] },
  coverage: {
    primary: { label: "갑작스러운 출혈", evidenceQuotes: ["피가 나서"] },
    secondary: { label: "주치의를 찾음", evidenceQuotes: ["주치의에게 전화"] },
    reserved: [{ label: "응급실로 향함", evidenceQuotes: ["응급실 가려고"] }]
  },
  contentContract: {
    delivered: { label: "갑작스러운 출혈", evidenceQuotes: ["피가 나서"] },
    discovered: { label: "주치의를 찾음", evidenceQuotes: ["주치의에게 전화"] },
    reserved: [{ label: "응급실로 향함", evidenceQuotes: ["응급실 가려고"] }],
    offerEligibility: { eligible: true, perspectives: [
      { label: "주치의를 먼저 찾음", evidenceQuotes: ["주치의에게 전화"] },
      { label: "응급실로 움직이려 함", evidenceQuotes: ["응급실 가려고"] }
    ] }
  }
};

function fixture(payload: unknown, version: 2 | 3 | null) {
  const sourceTurn: ConversationTurn = {
    id: "turn_free_purchase_time",
    readingId: "reading_paid_contract_12345678",
    role: "kkumgyeol",
    kind: "free",
    status: "complete",
    clientMessageId: null,
    encryptedContent: { v: 1, alg: "A256GCM", iv: "", ciphertext: "", tag: "" },
    createdAt: "2026-09-01T00:00:00.000Z"
  };
  const baseOrder: OrderRecord = {
    id: "order_paid_contract_12345678",
    readingId: sourceTurn.readingId,
    sessionHash: "session",
    product: "full_reading",
    amount: 990,
    status: "paid",
    paymentKey: "payment-key",
    providerTransactionKey: "tx",
    contentConsentAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z"
  };
  const digest = sourceFreePayloadSha256(payload);
  return { sourceTurn, baseOrder, digest, version };
}

describe("paid generation contract resolution", () => {
  it("keeps snapshotless orders on the existing legacy path", () => {
    const { baseOrder } = fixture(freeV2, 2);
    expect(resolvePaidGenerationContract({ readingId: baseOrder.readingId, orderId: baseOrder.id, order: baseOrder })).toEqual({ kind: "legacy-v2" });
  });

  it("uses the v1 snapshot offer and exact source turn while preserving the v1 hash", () => {
    const { sourceTurn, baseOrder, digest } = fixture(freeV2, 2);
    const snapshot = createPurchasePromiseSnapshot({
      sourceReadingId: baseOrder.readingId,
      sourceFreeTurnId: sourceTurn.id,
      sourceFreeCompositionVersion: 2,
      sourceFreePayloadSha256: digest,
      offer,
      captureMode: "confirmed",
      capturedAt: "2026-09-01T00:00:00.000Z"
    });
    const order = { ...baseOrder, purchasePromiseSnapshot: snapshot };
    expect(resolvePaidGenerationContract({ readingId: order.readingId, orderId: order.id, order, sourceTurn, sourcePayload: freeV2 }))
      .toEqual({ kind: "snapshot-v1-v2", snapshot, sourceFreePayload: freeV2 });
    const samePromiseWithoutOptionalDigest = createPurchasePromiseSnapshot({
      sourceReadingId: baseOrder.readingId,
      sourceFreeTurnId: sourceTurn.id,
      sourceFreeCompositionVersion: 2,
      offer,
      captureMode: "confirmed",
      capturedAt: "2026-09-01T00:00:00.000Z"
    });
    expect(snapshot.promiseSha256).toBe(samePromiseWithoutOptionalDigest.promiseSha256);
  });

  it("rejects Free V3 paired with paid-offer-v1 instead of projecting it into V2", () => {
    const { sourceTurn, baseOrder, digest } = fixture(freeV3, 3);
    const snapshot = createPurchasePromiseSnapshot({
      sourceReadingId: baseOrder.readingId,
      sourceFreeTurnId: sourceTurn.id,
      sourceFreeCompositionVersion: 3,
      sourceFreePayloadSha256: digest,
      offer,
      captureMode: "confirmed"
    });
    const order = { ...baseOrder, purchasePromiseSnapshot: snapshot };
    expect(() => resolvePaidGenerationContract({ readingId: order.readingId, orderId: order.id, order, sourceTurn, sourcePayload: freeV3 }))
      .toThrow("PAID_OFFER_V1_REQUIRES_FREE_V2");
  });

  it("creates a snapshot offer only when Free V3 retains two grounded paid perspectives", async () => {
    const repository = new TestRepository();
    const reading = await createReading({ dream: dreamForV3Offer, emotion: null }, "session", repository);
    await storeStagedFreeReadingV3(reading.id, freeV3, repository);
    const turns = await repository.getConversationTurns(reading.id);
    const promise = purchasePromiseForReading(reading, turns);
    expect(promise).toMatchObject({ promiseVersion: "paid-offer-v2", sourceFreeCompositionVersion: 3 });
    expect(promise?.offer).toMatchObject({ contentContractVersion: 1, eligibility: "eligible", newPerspectiveRange: [2, 2] });
    expect(promise?.offer.cards?.map(card => card.title)).toEqual(["무료에서 남긴 관점 1", "무료에서 남긴 관점 2"]);
    expect(JSON.stringify(promise?.offer)).not.toContain("주치의를 먼저 찾음");
    expect(JSON.stringify(promise?.offer)).not.toContain("주치의에게 전화했어요");
    const publicReading = await getPublicReading(reading, "https://dream.example", repository);
    const visibleFree = publicReading.timeline.findLast(turn => turn.kind === "free")?.content;
    expect(visibleFree).toMatchObject({ freeCompositionVersion: 3, title: freeV3.title });
    expect(visibleFree && "contentContract" in visibleFree).toBe(false);
    expect(publicReading.paidOffer?.cards.map(card => card.title)).toEqual(["무료에서 남긴 관점 1", "무료에서 남긴 관점 2"]);
    expect(publicReading.canPurchaseFullReading).toBe(true);

    const insufficient = structuredClone(freeV3);
    insufficient.contentContract.reserved = [];
    insufficient.coverage.reserved = [];
    insufficient.contentContract.offerEligibility = { eligible: false, perspectives: [] };
    await storeStagedFreeReadingV3(reading.id, insufficient, repository);
    expect(purchasePromiseForReading(reading, await repository.getConversationTurns(reading.id))).toBeNull();
    const insufficientPublic = await getPublicReading(reading, "https://dream.example", repository);
    expect(insufficientPublic.paidOffer).toBeNull();
    expect(insufficientPublic.canPurchaseFullReading).toBe(false);
  });

  it("builds a paid offer from two distinct residual axes split between discovered and reserved", async () => {
    const repository = new TestRepository();
    const sourceDream = "발표 자료가 사라졌고 동료가 종이를 건네 발표를 마쳤어요. 빈 옛집을 둘러본 뒤 가족을 보았지만 부르지 않고 반대 방향으로 걸었어요. 현관문을 잠그지 않고 나왔어요.";
    const reading = await createReading({ dream: sourceDream, emotion: null }, "free-contract-granularity", repository);
    const sample = structuredClone(freeV3);
    const delivered = { label: "발표가 멈춘 뒤 동료의 도움으로 직접 마침", evidenceQuotes: ["발표 자료가 사라졌고", "동료가 종이를 건네 발표를 마쳤어요"] };
    const discovered = { label: "가족을 부르지 않고 다른 방향으로 감", evidenceQuotes: ["가족을 보았지만 부르지 않고 반대 방향으로 걸었어요"] };
    const reserved = [
      { label: "빈 옛집을 둘러봄", evidenceQuotes: ["빈 옛집을 둘러본 뒤"] },
      { label: "현관문을 잠그지 않고 나옴", evidenceQuotes: ["현관문을 잠그지 않고 나왔어요"] }
    ];
    sample.coverage = { primary: delivered, secondary: discovered, reserved };
    sample.contentContract = {
      delivered,
      discovered,
      reserved,
      offerEligibility: { eligible: true, perspectives: [discovered, reserved[1]!] }
    };
    await storeStagedFreeReadingV3(reading.id, sample, repository);

    const promise = purchasePromiseForReading(reading, await repository.getConversationTurns(reading.id));
    expect(promise).toMatchObject({
      promiseVersion: "paid-offer-v2",
      offer: { contentContractVersion: 1, eligibility: "eligible", newPerspectiveRange: [2, 2] }
    });
    expect(promise?.offer.cards).toHaveLength(2);
  });

  it("dispatches Paid Composition V3 only for paid-offer-v2 plus the exact Free V3 payload", () => {
    const { sourceTurn, baseOrder, digest } = fixture(freeV3, 3);
    const snapshot = createPurchasePromiseSnapshotV2({
      sourceReadingId: baseOrder.readingId,
      sourceFreeTurnId: sourceTurn.id,
      sourceFreePayloadSha256: digest,
      offer: paidV3Offer,
      captureMode: "confirmed"
    });
    const changedDigest = createPurchasePromiseSnapshotV2({
      sourceReadingId: baseOrder.readingId,
      sourceFreeTurnId: sourceTurn.id,
      sourceFreePayloadSha256: "0".repeat(64),
      offer: paidV3Offer,
      captureMode: "confirmed"
    });
    expect(changedDigest.promiseSha256).not.toBe(snapshot.promiseSha256);
    const order = { ...baseOrder, purchasePromiseSnapshot: snapshot };
    expect(resolvePaidGenerationContract({ readingId: order.readingId, orderId: order.id, order, sourceTurn, sourcePayload: freeV3 }))
      .toEqual({ kind: "staged-v3", snapshot, sourceFreePayload: freeV3 });
  });

  it("fails explicitly for missing or changed purchase-time source instead of selecting a newer free turn", () => {
    const { sourceTurn, baseOrder, digest } = fixture(freeV3, 3);
    const snapshot = createPurchasePromiseSnapshotV2({
      sourceReadingId: baseOrder.readingId,
      sourceFreeTurnId: sourceTurn.id,
      sourceFreePayloadSha256: digest,
      offer: paidV3Offer,
      captureMode: "confirmed"
    });
    const order = { ...baseOrder, purchasePromiseSnapshot: snapshot };
    expect(() => resolvePaidGenerationContract({ readingId: order.readingId, orderId: order.id, order, sourceTurn: null, sourcePayload: freeV3 }))
      .toThrow("SOURCE_FREE_TURN_MISSING");
    expect(() => resolvePaidGenerationContract({ readingId: order.readingId, orderId: order.id, order, sourceTurn, sourcePayload: { ...freeV3, title: "Changed after purchase" } }))
      .toThrow("SOURCE_FREE_PAYLOAD_MISMATCH");
  });

  it("passes the exact snapshot offer and two private paid perspective candidates to the writer", async () => {
    const repository = new TestRepository();
    const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "paid-v3-writer-contract", repository);
    const base = fixture(freeV3, 3);
    const sourceTurn = { ...base.sourceTurn, readingId: reading.id, id: "turn_free_purchase_snapshot" };
    const snapshot = createPurchasePromiseSnapshotV2({
      sourceReadingId: reading.id,
      sourceFreeTurnId: sourceTurn.id,
      sourceFreePayloadSha256: base.digest,
      offer: paidV3Offer,
      captureMode: "confirmed"
    });
    const order = { ...base.baseOrder, readingId: reading.id, purchasePromiseSnapshot: snapshot };
    const resolved = resolvePaidGenerationContract({ readingId: reading.id, orderId: order.id, order, sourceTurn, sourcePayload: freeV3 });
    if (resolved.kind !== "staged-v3") throw new Error("Expected staged V3 source");
    const writer = vi.fn(async () => ({ kind: "insufficient_grounded_material" as const, reasonCode: "INSUFFICIENT_GROUNDED_MATERIAL" as const }));

    await generateStagedPaidV3(reading, resolved, writer);

    expect(writer).toHaveBeenCalledWith(expect.objectContaining({
      sourceFreePayload: freeV3,
      purchasePromise: snapshot.offer
    }));
  });

  it("rejects mismatched order identity, broken promise hash, and v2 paired with Free V2", () => {
    const { sourceTurn, baseOrder, digest } = fixture(freeV3, 3);
    const snapshot = createPurchasePromiseSnapshotV2({
      sourceReadingId: baseOrder.readingId,
      sourceFreeTurnId: sourceTurn.id,
      sourceFreePayloadSha256: digest,
      offer: paidV3Offer,
      captureMode: "confirmed"
    });
    const order = { ...baseOrder, purchasePromiseSnapshot: { ...snapshot, promiseSha256: "0".repeat(64) } };
    expect(() => resolvePaidGenerationContract({ readingId: order.readingId, orderId: order.id, order, sourceTurn, sourcePayload: freeV3 }))
      .toThrow("PURCHASE_PROMISE_HASH_MISMATCH");
    const brokenPair = { ...baseOrder, purchasePromiseSnapshot: snapshot };
    expect(() => resolvePaidGenerationContract({ readingId: brokenPair.readingId, orderId: brokenPair.id, order: brokenPair, sourceTurn, sourcePayload: freeV2 }))
      .toThrow("PAID_OFFER_V2_REQUIRES_FREE_V3");
    expect(() => resolvePaidGenerationContract({ readingId: baseOrder.readingId, orderId: baseOrder.id, order: { ...baseOrder, readingId: "other" }, sourceTurn, sourcePayload: freeV3 }))
      .toThrow("PAID_ORDER_READING_MISMATCH");
  });

  it("runs the staged V3 dispatcher without mutating conversation storage or durable worker state", async () => {
    const repository = new TestRepository();
    const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "staged-paid-v3", repository);
    const sourceTurn = await storeStagedFreeReadingV3(reading.id, freeV3, repository);
    const snapshot = createPurchasePromiseSnapshotV2({
      sourceReadingId: reading.id,
      sourceFreeTurnId: sourceTurn.id,
      sourceFreePayloadSha256: sourceFreePayloadSha256(freeV3),
      offer: paidV3Offer,
      captureMode: "confirmed"
    });
    const order: OrderRecord = { ...fixture(freeV3, 3).baseOrder, readingId: reading.id, purchasePromiseSnapshot: snapshot };
    const contract = resolvePaidGenerationContract({ readingId: reading.id, orderId: order.id, order, sourceTurn, sourcePayload: freeV3 });
    if (contract.kind !== "staged-v3") throw new Error("Expected the staged V3 contract.");
    const beforeTurns = await repository.getConversationTurns(reading.id);
    const generated: StagedPaidV3Result = {
      kind: "complete",
      composition: {
        paidCompositionVersion: 3,
        instructionVersion: "paid-composition-v3-1",
        generationInstructionSha256: "c".repeat(64),
        appInstructionsSha256: "d".repeat(64),
        generationSource: "codex",
        title: "검수된 내부 결과",
        bridge: "무료 해석을 짧게 이어받아요. 남은 장면의 관계를 살펴봐요.",
        newPerspectives: [],
        relationshipSynthesis: [],
        finalIntegration: "꿈의 흐름을 한 문장으로 묶어요."
      },
      review: { approved: true }
    };
    const generate = vi.fn().mockResolvedValue(generated);
    const result = await generateStagedPaidV3(reading, contract, generate);
    expect(result).toEqual(generated);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ sourceFreePayload: freeV3, purchasePromise: paidV3Offer }));
    expect(await repository.getConversationTurns(reading.id)).toEqual(beforeTurns);
    expect(repository.orders.size).toBe(0);
  });
});
