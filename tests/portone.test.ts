import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyPortOnePayment } from "@/lib/portone";
import { confirmPayment, createOrder } from "@/lib/payments";
import { createReading } from "@/lib/readings";
import type { OrderRecord } from "@/lib/types";
import { DETAILED_DREAM, TestRepository } from "./helpers/repository";

const order = { id: "order_fixture", amount: 990 } as OrderRecord;
const receipt = {
  id: order.id, status: "PAID", transactionId: "transaction_fixture", storeId: "store_fixture",
  currency: "KRW", channel: { key: "channel_fixture", type: "LIVE" }, amount: { total: 990, cancelled: 0 }
};
const provider = vi.fn();
beforeEach(() => {
  vi.stubEnv("PORTONE_STORE_ID", "store_fixture");
  vi.stubEnv("PORTONE_KCP_CHANNEL_KEY", "channel_fixture");
  vi.stubEnv("PORTONE_API_SECRET", "synthetic-api-secret");
  vi.stubGlobal("fetch", provider);
  provider.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("PortOne server payment verification", () => {
  it("accepts only the provider-verified payment for the server order", async () => {
    provider.mockResolvedValue(Response.json(receipt));
    await expect(verifyPortOnePayment(order, order.id)).resolves.toEqual({ paymentKey: order.id, transactionKey: receipt.transactionId });
    expect(provider).toHaveBeenCalledWith("https://api.portone.io/payments/order_fixture?storeId=store_fixture", expect.objectContaining({ cache: "no-store" }));
  });

  it("rejects another order's payment before contacting the provider", async () => {
    await expect(verifyPortOnePayment(order, "other_order")).rejects.toMatchObject({ code: "PAYMENT_ORDER_MISMATCH" });
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    { id: "other_order" }, { storeId: "other_store" },
    { channel: { key: "other_channel", type: "LIVE" } },
    { amount: { total: 1, cancelled: 0 } }, { currency: "USD" },
    { amount: { total: 990, cancelled: 10 } }, { status: "FAILED" },
    { channel: { key: "channel_fixture", type: "TEST" } }
  ])("rejects an untrusted receipt %j", async (change) => {
    provider.mockResolvedValue(Response.json({ ...receipt, ...change }));
    await expect(verifyPortOnePayment(order, order.id)).rejects.toThrow();
  });

  it("keeps a temporary lookup failure retryable without a second payment", async () => {
    provider.mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(verifyPortOnePayment(order, order.id)).rejects.toMatchObject({ code: "PAYMENT_VERIFICATION_UNAVAILABLE", status: 502 });
  });

  it("persists a webhook purchase before generation, and a browser replay cannot add another generation or credits", async () => {
    vi.stubEnv("APP_PROFILE", "");
    vi.stubEnv("AI_MODE", undefined);
    vi.stubEnv("PAYMENTS_MODE", "mock");
    const repository = new TestRepository();
    const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "payment-session", repository);
    const pending = await createOrder(reading, "full_reading", "payment-session", repository);
    vi.stubEnv("PAYMENTS_MODE", "portone");
    provider.mockResolvedValue(Response.json({ ...receipt, id: pending.id }));
    let generation: (() => Promise<unknown>) | undefined;
    const purchased = await confirmPayment({ orderId: pending.id, paymentKey: pending.id, amount: 990 }, "payment-session", repository, undefined, (run) => { generation = run; });
    expect(purchased.detailGenerationStatus).toBe("generating");
    expect((await repository.getOrder(pending.id))?.status).toBe("paid");
    expect(await repository.getEntitlement(reading.id)).toMatchObject({ fullReadingPurchased: true, baseQuestionAllowance: 2, usedQuestions: 0 });
    await confirmPayment({ orderId: pending.id, paymentKey: pending.id, amount: 990 }, "payment-session", repository);
    expect(provider).toHaveBeenCalledTimes(1);
    // The receipt path is real code; generation uses the existing offline fixture.
    vi.stubEnv("PAYMENTS_MODE", "mock");
    await generation!();
    expect((await repository.getConversationTurns(reading.id)).filter(turn => turn.kind === "detailed")).toHaveLength(1);
    expect((await repository.getEntitlement(reading.id))?.usedQuestions).toBe(0);
  });
});
