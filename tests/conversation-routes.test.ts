import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as messages } from "@/app/api/readings/[id]/messages/route";
import { POST as legacyFollowup } from "@/app/api/readings/[id]/follow-up/route";
import { canAccessReading } from "@/lib/access";
import { setRepositoryForTests } from "@/lib/repository";
import { createReading } from "@/lib/readings";
import { createOrder, confirmPayment } from "@/lib/payments";
import { PROGRESS_MEDIA_TYPE } from "@/lib/progress";
import { readProgressResponse } from "@/lib/progress-client";
import { DETAILED_DREAM, TestRepository } from "./helpers/repository";

vi.mock("@/lib/access", () => ({ canAccessReading: vi.fn(async () => true) }));
beforeEach(() => {
  vi.stubEnv("APP_PROFILE", "review");
  vi.stubEnv("AI_MODE", "local");
  vi.stubEnv("PAYMENTS_MODE", "mock");
  vi.mocked(canAccessReading).mockResolvedValue(true);
});
afterEach(() => { setRepositoryForTests(null); vi.unstubAllEnvs(); globalThis.__dreamConversationIngress = undefined; });

async function fixture() {
  const repository = new TestRepository();
  const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "route-guard-test", repository);
  const order = await createOrder(reading, "full_reading", reading.sessionHash, repository);
  const paid = await confirmPayment({ paymentKey: `mock_${order.id}`, orderId: order.id, amount: 990 }, reading.sessionHash, repository);
  setRepositoryForTests(repository);
  const context = { params: Promise.resolve({ id: paid.id }) };
  const request = (kind: "messages" | "follow-up", clientMessageId: string, stream = false) => new Request(`https://dream.test/api/readings/${paid.id}/${kind}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(stream ? { Accept: PROGRESS_MEDIA_TYPE } : {}) },
    body: JSON.stringify({ clientMessageId, ...(kind === "messages" ? { message: "계오일주에 대해 알려줘" } : { question: "점심 추천해줘" }) })
  });
  const reservationsBeforeRequest = structuredClone([...repository.reservations]);
  return { repository, paid, context, request, reservationsBeforeRequest };
}

describe("message route guard contract", () => {
  it("shares grace and cooldown between current and legacy endpoints, including streaming responses", async () => {
    const { repository, paid, context, request, reservationsBeforeRequest } = await fixture();
    const first = await messages(request("messages", "current_request"), context);
    expect(first.status).toBe(422);
    expect((await first.json()).error.code).toBe("CONVERSATION_SCOPE_GRACE");
    const second = await legacyFollowup(request("follow-up", "legacy_request"), context);
    expect(second.status).toBe(422);
    expect((await second.json()).error.code).toBe("CONVERSATION_OFF_TOPIC");
    const third = await legacyFollowup(request("follow-up", "stream_request", true), context);
    await expect(readProgressResponse(third, () => {})).rejects.toMatchObject({ code: "CONVERSATION_RATE_LIMITED", status: 429, retryAfterSeconds: 60 });
    expect((await repository.getEntitlement(paid.id))?.usedQuestions).toBe(0);
    expect((await repository.getReading(paid.id))?.detailGenerationStatus).toBe("ready");
    expect([...repository.reservations]).toEqual(reservationsBeforeRequest);
  });

  it("does not consume another person's grace or budget on an unauthorized request", async () => {
    const { repository, context, request, reservationsBeforeRequest } = await fixture();
    const guardsBeforeRequest = structuredClone([...repository.conversationGuards]);
    vi.mocked(canAccessReading).mockResolvedValue(false);
    const response = await messages(request("messages", "unauthorized_request"), context);
    expect(response.status).toBe(403);
    expect([...repository.conversationGuards]).toEqual(guardsBeforeRequest);
    expect([...repository.reservations]).toEqual(reservationsBeforeRequest);
  });
});
