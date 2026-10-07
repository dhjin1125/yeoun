import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), getOrder: vi.fn(), after: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...await importOriginal<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/payments", () => ({ confirmPayment: mocks.confirm }));
vi.mock("@/lib/repository", () => ({ getRepository: () => ({ getOrder: mocks.getOrder }) }));
import { POST } from "@/app/api/payments/portone/webhook/route";

const key = Buffer.from("synthetic-webhook-secret-for-tests").toString("base64");
function notification(storeId = "store_fixture", signatureValid = true) {
  const body = JSON.stringify({ type: "Transaction.Paid", timestamp: new Date().toISOString(), data: { storeId, paymentId: "order_fixture", transactionId: "transaction_fixture" } });
  const id = "notification_fixture";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", Buffer.from(key, "base64")).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new Request("https://dream.example/api/payments/portone/webhook", {
    method: "POST", body,
    headers: { "Content-Type": "application/json", "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signatureValid ? signature : "invalid"}` }
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_PROFILE", "local-ai");
  vi.stubEnv("PAYMENTS_MODE", "portone");
  vi.stubEnv("PORTONE_STORE_ID", "store_fixture");
  vi.stubEnv("PORTONE_WEBHOOK_SECRET", key);
  mocks.getOrder.mockResolvedValue({ id: "order_fixture", amount: 990, sessionHash: "owner_session" });
  mocks.confirm.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());

describe("PortOne signed webhook", () => {
  it("rejects forged notifications without looking up a private order", async () => {
    expect((await POST(notification("store_fixture", false))).status).toBe(400);
    expect(mocks.getOrder).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("rejects a correctly signed notification for another store", async () => {
    expect((await POST(notification("other_store"))).status).toBe(400);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("verifies the stored order and schedules generation after acknowledging the purchase", async () => {
    expect((await POST(notification())).status).toBe(200);
    expect(mocks.confirm).toHaveBeenCalledWith({ paymentKey: "order_fixture", orderId: "order_fixture", amount: 990 }, "owner_session", expect.anything(), undefined, expect.any(Function));
    const generate = vi.fn().mockResolvedValue({});
    mocks.confirm.mock.calls[0]![4](generate);
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });
  it("does not create orders from unsolicited notifications", async () => {
    mocks.getOrder.mockResolvedValue(null);
    expect((await POST(notification())).status).toBe(200);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
