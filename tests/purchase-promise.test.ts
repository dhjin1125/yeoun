import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPurchasePromiseSnapshot, samePurchasePromiseIdentity } from "@/lib/purchase-promise";
import { createOrder } from "@/lib/payments";
import { createReading, getPublicReading } from "@/lib/readings";
import { buildOrderRequestPayload } from "@/lib/order-request";
import { orderSchema } from "@/lib/validation";
import { DETAILED_DREAM, TestRepository } from "./helpers/repository";
import type { OrderRecord, PaidOffer } from "@/lib/types";

beforeEach(() => {
  vi.stubEnv("APP_PROFILE", "");
  vi.stubEnv("AI_MODE", "local");
  vi.stubEnv("PAYMENTS_MODE", "mock");
});
afterEach(() => vi.unstubAllEnvs());

async function offerFixture() {
  const repository = new TestRepository();
  const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "promise-test", repository);
  const view = await getPublicReading(reading, "https://dream.test", repository);
  if (!view.paidOffer) throw new Error("Expected a public paid offer.");
  return { repository, reading, offer: view.paidOffer };
}

describe("paid purchase promise", () => {
  it("uses the same persisted offer identity for the public view and the created order", async () => {
    const { repository, reading, offer } = await offerFixture();
    const order = await createOrder(reading, "full_reading", "promise-test", repository, {
      promiseVersion: offer.promiseVersion,
      promiseSha256: offer.promiseSha256
    });

    expect(order.purchasePromiseSnapshot).toMatchObject({
      promiseVersion: offer.promiseVersion,
      promiseSha256: offer.promiseSha256,
      sourceReadingId: reading.id,
      sourceFreeTurnId: expect.any(String),
      captureMode: "confirmed",
      offer: {
        headline: offer.headline,
        bridge: offer.bridge,
        checkoutTitle: offer.checkoutTitle,
        checkoutSummary: offer.checkoutSummary,
        cta: offer.cta,
        cards: offer.cards
      }
    });
    expect([null, 2]).toContain(order.purchasePromiseSnapshot?.sourceFreeCompositionVersion);
  });

  it("rejects a stale promise before creating an order", async () => {
    const { repository, reading, offer } = await offerFixture();
    await expect(createOrder(reading, "full_reading", "promise-test", repository, {
      promiseVersion: offer.promiseVersion,
      promiseSha256: "0".repeat(64)
    })).rejects.toMatchObject({ code: "PURCHASE_PROMISE_STALE", status: 409 });
    expect(repository.orders.size).toBe(0);
  });

  it("marks hash-less legacy callers explicitly and preserves their first snapshot on retry/payment", async () => {
    const { repository, reading } = await offerFixture();
    const first = await createOrder(reading, "full_reading", "promise-test", repository);
    const firstSnapshot = first.purchasePromiseSnapshot!;
    if (firstSnapshot.promiseVersion !== "paid-offer-v1") throw new Error("Expected the public v1 offer snapshot.");
    expect(firstSnapshot.captureMode).toBe("legacy_server_snapshot");
    const retry = await createOrder(reading, "full_reading", "promise-test", repository);
    expect(retry.id).toBe(first.id);
    expect(retry.purchasePromiseSnapshot).toEqual(firstSnapshot);

    const tampered = {
      ...retry,
      purchasePromiseSnapshot: {
        ...firstSnapshot,
        promiseSha256: "f".repeat(64),
        offer: { ...firstSnapshot.offer, headline: `${firstSnapshot.offer.headline}!` }
      }
    };
    await repository.recordPaymentVerificationKey(first.id, "promise-test", "mock_promise_key");
    await repository.commitVerifiedPayment({
      ...tampered,
      status: "paid",
      paymentKey: "mock_promise_key",
      providerTransactionKey: "mock-promise-transaction"
    }, new Date().toISOString(), 7 * 24 * 60 * 60 * 1_000, true);
    await repository.saveOrder({ ...tampered, status: "failed", updatedAt: new Date().toISOString() });
    expect((await repository.getOrder(first.id))?.status).toBe("paid");
    expect((await repository.getOrder(first.id))?.purchasePromiseSnapshot).toEqual(firstSnapshot);
  });

  it("attaches one confirmed snapshot to an existing legacy pending order only once", async () => {
    const { repository, reading, offer } = await offerFixture();
    const legacyPending: OrderRecord = {
      id: "order_legacy_pending_12345678",
      readingId: reading.id,
      sessionHash: "promise-test",
      product: "full_reading",
      amount: 990,
      status: "pending",
      paymentKey: null,
      providerTransactionKey: null,
      contentConsentAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await repository.saveOrder(legacyPending);

    const resumed = await createOrder(reading, "full_reading", "promise-test", repository, {
      promiseVersion: offer.promiseVersion,
      promiseSha256: offer.promiseSha256
    });
    expect(resumed.id).toBe(legacyPending.id);
    expect((await repository.getOrder(resumed.id))?.purchasePromiseSnapshot).toMatchObject({
      promiseSha256: offer.promiseSha256,
      captureMode: "confirmed"
    });
    const firstSnapshot = resumed.purchasePromiseSnapshot;

    const retry = await createOrder(reading, "full_reading", "promise-test", repository, {
      promiseVersion: offer.promiseVersion,
      promiseSha256: offer.promiseSha256
    });
    expect(retry.purchasePromiseSnapshot).toEqual(firstSnapshot);
  });

  it("hashes only stable promise content and source identity, independent of key order or capture time", () => {
    const offer: PaidOffer = {
      variant: "editorial_depth_v2",
      headline: "장면을 더 깊이 살펴봐요",
      bridge: "꿈의 흐름을 연결해요",
      checkoutTitle: "상세 풀이",
      checkoutSummary: "장면 · 감정 · 현실",
      cta: "전체 해몽 보기",
      trustLines: ["꿈을 예언으로 단정하지 않아요"],
      riskClass: "standard",
      cards: [{ key: "traditional", title: "장면의 연결", firstSentence: "앞뒤 장면을 함께 읽어요.", evidenceSceneOrders: [1], promisedSectionTitle: "장면" }]
    };
    const shared = {
      sourceReadingId: "reading_12345678",
      sourceFreeTurnId: "turn_free_12345678",
      sourceFreeCompositionVersion: 2 as const,
      offer,
      captureMode: "confirmed" as const
    };
    const first = createPurchasePromiseSnapshot({ ...shared, capturedAt: "2026-09-27T00:00:00.000Z" });
    const reorderedOffer = Object.fromEntries(Object.entries(offer).reverse()) as PaidOffer;
    reorderedOffer.cards = offer.cards.map(card => Object.fromEntries(Object.entries(card).reverse()) as typeof card);
    const reordered = createPurchasePromiseSnapshot({ ...shared, offer: reorderedOffer, capturedAt: "2026-09-28T00:00:00.000Z" });
    expect(samePurchasePromiseIdentity(first, reordered)).toBe(true);

    expect(samePurchasePromiseIdentity(first, createPurchasePromiseSnapshot({
      ...shared,
      offer: { ...offer, headline: `${offer.headline}!` }
    }))).toBe(false);
    expect(samePurchasePromiseIdentity(first, createPurchasePromiseSnapshot({
      ...shared,
      sourceFreeTurnId: "turn_free_changed"
    }))).toBe(false);
  });

  it("requires a complete identity pair and rejects it for a follow-up product", () => {
    const base = { readingId: "reading_12345678", product: "full_reading" as const, contentConsent: true };
    expect(orderSchema.safeParse({ ...base, promiseVersion: "paid-offer-v1" }).success).toBe(false);
    expect(orderSchema.safeParse({ ...base, promiseVersion: "paid-offer-v1", promiseSha256: "a".repeat(64) }).success).toBe(true);
    expect(orderSchema.safeParse({ ...base, product: "followup_pack_2", promiseVersion: "paid-offer-v1", promiseSha256: "a".repeat(64) }).success).toBe(false);
  });

  it("sends the exact offer identity from the purchase surface and requires it for new full-reading requests", () => {
    const promise = { promiseVersion: "paid-offer-v1" as const, promiseSha256: "a".repeat(64) };
    expect(buildOrderRequestPayload({ readingId: "reading_12345678", product: "full_reading", promise })).toMatchObject({
      readingId: "reading_12345678",
      product: "full_reading",
      contentConsent: true,
      promiseVersion: promise.promiseVersion,
      promiseSha256: promise.promiseSha256
    });
    expect(() => buildOrderRequestPayload({ readingId: "reading_12345678", product: "full_reading" })).toThrow("PURCHASE_PROMISE_REQUIRED");
    expect(buildOrderRequestPayload({ readingId: "reading_12345678", product: "followup_pack_2", promise: null })).not.toHaveProperty("promiseSha256");
  });
});
