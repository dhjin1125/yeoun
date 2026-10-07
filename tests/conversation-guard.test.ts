import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ai from "@/lib/ai";
import { admitConversation } from "@/lib/conversation-admission";
import { obviousConversationScope, scopedConversationMessage } from "@/lib/conversation-scope";
import { CONVERSATION_LIMITS } from "@/lib/conversation-guard";
import { addConversationMessage, createReading, readingContext } from "@/lib/readings";
import { confirmPayment, createOrder } from "@/lib/payments";
import { SQLiteRepository } from "@/lib/repository/sqlite";
import { decryptJson } from "@/lib/crypto";
import type { UserTurnPayload } from "@/lib/types";
import { DETAILED_DREAM, TestRepository } from "./helpers/repository";

beforeEach(() => {
  vi.stubEnv("APP_PROFILE", "review");
  vi.stubEnv("AI_MODE", "local");
  vi.stubEnv("PAYMENTS_MODE", "mock");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function paidFixture() {
  const repository = new TestRepository();
  const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "scope-test-session", repository);
  const order = await createOrder(reading, "full_reading", reading.sessionHash, repository);
  const paid = await confirmPayment({ paymentKey: `mock_${order.id}`, orderId: order.id, amount: 990 }, reading.sessionHash, repository);
  return { repository, paid };
}

describe("conversation scope before generation and credits", () => {
  it("gives one durable notice, deduplicates transport retries, and cools down repeated off-topic requests", async () => {
    const { repository, paid } = await paidFixture();
    const before = await repository.getReading(paid.id);
    const turns = await repository.getConversationTurns(paid.id);
    const generation = vi.spyOn(ai, "generateFollowupAssistant");
    const detail = vi.spyOn(ai, "generateDetailedAssistant");
    const first = { clientMessageId: "scope_first", message: "계오일주에 대해서 알려줘" };
    await expect(addConversationMessage(paid, first, repository)).rejects.toMatchObject({ code: "CONVERSATION_SCOPE_GRACE", status: 422 });
    await expect(addConversationMessage(paid, first, repository)).rejects.toMatchObject({ code: "CONVERSATION_SCOPE_GRACE" });
    await expect(addConversationMessage(paid, { ...first, clientMessageId: "scope_second" }, repository)).rejects.toMatchObject({ code: "CONVERSATION_OFF_TOPIC" });
    await expect(addConversationMessage(paid, { ...first, clientMessageId: "scope_third" }, repository)).rejects.toMatchObject({ code: "CONVERSATION_RATE_LIMITED", status: 429, retryAfterSeconds: 60 });
    const classify = vi.spyOn(ai, "classifyConversationScope");
    await expect(addConversationMessage(paid, { clientMessageId: "scope_fourth", message: "이 꿈을 더 풀어줘" }, repository)).rejects.toMatchObject({ code: "CONVERSATION_RATE_LIMITED" });
    expect(classify).not.toHaveBeenCalled();
    expect(generation).not.toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
    expect(await repository.getReading(paid.id)).toEqual(before);
    expect(await repository.getConversationTurns(paid.id)).toEqual(turns);
    expect((await repository.getEntitlement(paid.id))?.usedQuestions).toBe(0);
    const afterCooldown = Date.now() + 61_000;
    vi.spyOn(Date, "now").mockReturnValue(afterCooldown);
    await expect(addConversationMessage(paid, { ...first, clientMessageId: "after_cooldown" }, repository)).rejects.toMatchObject({ code: "CONVERSATION_OFF_TOPIC" });
  });

  it("does not use grace for ambiguity, reactions, corrections or error reports", async () => {
    const { repository, paid } = await paidFixture();
    await expect(addConversationMessage(paid, { clientMessageId: "unclear_text", message: "음 그러니까" }, repository)).rejects.toMatchObject({ code: "CONVERSATION_SCOPE_UNCLEAR" });
    await addConversationMessage(paid, { clientMessageId: "reaction_text", message: "고마워요" }, repository);
    await addConversationMessage(paid, { clientMessageId: "correction_text", message: "장소는 학교였어" }, repository);
    const current = (await repository.getReading(paid.id))!;
    await addConversationMessage(current, { clientMessageId: "repair_text", message: "문장이 이상해요. 다시 써줘" }, repository);
    await expect(addConversationMessage(current, { clientMessageId: "offtopic_text", message: "점심 추천해줘" }, repository)).rejects.toMatchObject({ code: "CONVERSATION_SCOPE_GRACE" });
    expect((await repository.getEntitlement(paid.id))?.usedQuestions).toBe(0);
  });

  it("blocks a statement before it can become a dream fact or invalidate the report", async () => {
    const { repository, paid } = await paidFixture();
    const before = await repository.getReading(paid.id);
    vi.spyOn(ai, "classifyConversationScope").mockResolvedValue({ decision: "off_topic", relevantParts: [] });
    await expect(addConversationMessage(paid, { clientMessageId: "unrelated_statement", message: "파이썬으로 계산기를 만들었어" }, repository)).rejects.toMatchObject({ code: "CONVERSATION_SCOPE_GRACE" });
    expect(await repository.getReading(paid.id)).toEqual(before);
  });

  it("uses only literal related parts of a mixed request and remains idempotent", async () => {
    const { repository, paid } = await paidFixture();
    const related = "현실의 일과 연결해줘";
    const classify = vi.spyOn(ai, "classifyConversationScope").mockResolvedValue({ decision: "mixed", relevantParts: [related] });
    const generate = vi.spyOn(ai, "generateFollowupAssistant");
    const input = { clientMessageId: "mixed_question", message: `${related}. 그리고 파이썬 코드를 작성해줘.` };
    await addConversationMessage(paid, input, repository);
    const updated = (await repository.getReading(paid.id))!;
    expect(generate.mock.calls[0]?.[2]).toBe(related);
    expect(JSON.stringify(readingContext(updated))).not.toContain("파이썬");
    const turn = (await repository.getConversationTurns(paid.id)).find(turn => turn.clientMessageId === input.clientMessageId)!;
    expect(decryptJson<UserTurnPayload>(turn.encryptedContent, "turn", turn.id).text).toBe(related);
    await addConversationMessage(updated, input, repository);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await repository.getEntitlement(paid.id))?.usedQuestions).toBe(1);
    await expect(addConversationMessage(updated, { ...input, message: "꿈을 다시 풀어줘" }, repository)).rejects.toMatchObject({ code: "MESSAGE_CLIENT_ID_CONFLICT" });
  });

  it("allows only one classification during a 50-request concurrent burst", async () => {
    const { repository, paid } = await paidFixture();
    const initialGuardCount = repository.conversationGuards.size;
    let finish!: (value: { decision: "off_topic"; relevantParts: string[] }) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const classifier = vi.spyOn(ai, "classifyConversationScope").mockImplementation(() => {
      entered();
      return new Promise(resolve => { finish = resolve; });
    });
    const first = addConversationMessage(paid, { clientMessageId: "concurrent_one", message: "어떤 이야기인가요" }, repository);
    const observed = expect(first).rejects.toMatchObject({ code: "CONVERSATION_SCOPE_GRACE" });
    await started;
    const rejected = await Promise.all(Array.from({ length: 50 }, (_, index) =>
      addConversationMessage(paid, { clientMessageId: `concurrent_${index}`, message: "어떤 이야기인가요" }, repository)
        .then(() => "unexpected_success", error => error.code as string)));
    expect(rejected).toContain("MESSAGE_IN_PROGRESS");
    expect(rejected).toContain("CONVERSATION_RATE_LIMITED");
    expect(rejected.every(code => code === "MESSAGE_IN_PROGRESS" || code === "CONVERSATION_RATE_LIMITED")).toBe(true);
    expect(classifier).toHaveBeenCalledTimes(1);
    finish({ decision: "off_topic", relevantParts: [] });
    await observed;
    expect((await repository.getEntitlement(paid.id))?.usedQuestions).toBe(0);
    expect(repository.conversationGuards.size).toBe(initialGuardCount + 2);
  });

  it("does not regenerate a record removed after initial access was checked", async () => {
    const { repository, paid } = await paidFixture();
    await repository.deleteReading(paid.id);
    // Model the entitlement snapshot taken just before a concurrent deletion.
    vi.spyOn(repository, "getEntitlement").mockResolvedValue({ readingId: paid.id, fullReadingPurchased: true, baseQuestionAllowance: 2, extraQuestionAllowance: 0, usedQuestions: 0, extraPackPurchased: false, updatedAt: paid.updatedAt });
    const classify = vi.spyOn(ai, "classifyConversationScope");
    await expect(addConversationMessage(paid, { clientMessageId: "deleted_record", message: "꿈을 더 알려줘" }, repository)).rejects.toMatchObject({ code: "READING_NOT_FOUND" });
    expect(classify).not.toHaveBeenCalled();
    expect(await repository.getReading(paid.id)).toBeNull();
  });

  it("fails closed on guard storage failure with no AI or credit changes", async () => {
    const { repository, paid } = await paidFixture();
    vi.spyOn(repository, "mutateConversationGuard").mockRejectedValue(new Error("storage unavailable"));
    const classify = vi.spyOn(ai, "classifyConversationScope");
    await expect(addConversationMessage(paid, { clientMessageId: "unavailable_store", message: "꿈을 더 알려줘" }, repository)).rejects.toMatchObject({ code: "CONVERSATION_GUARD_UNAVAILABLE" });
    expect(classify).not.toHaveBeenCalled();
    expect((await repository.getEntitlement(paid.id))?.usedQuestions).toBe(0);
  });

  it("keeps immediate safety guidance visible even during a cooldown", async () => {
    const { repository, paid } = await paidFixture();
    for (let index = 0; index < 3; index += 1) {
      await addConversationMessage(paid, { clientMessageId: `blocked_${index}`, message: "점심 추천해줘" }, repository).catch(() => undefined);
    }
    const classify = vi.spyOn(ai, "classifyConversationScope");
    await expect(addConversationMessage(paid, { clientMessageId: "safety_during_limit", message: "지금 죽고 싶다는 생각이 계속 들고 혼자 있어요." }, repository)).rejects.toMatchObject({ status: 429, message: expect.stringContaining("109") });
    expect(classify).not.toHaveBeenCalled();
    expect((await repository.getEntitlement(paid.id))?.usedQuestions).toBe(0);
  });

  it("shares the principal budget across different dream records", async () => {
    const { repository, paid } = await paidFixture();
    for (let index = 0; index < CONVERSATION_LIMITS.principal.minute; index += 1) {
      const admission = await admitConversation({ ...paid, id: `different_${index}` }, repository);
      await admission.release();
    }
    await expect(admitConversation({ ...paid, id: "another_dream" }, repository)).rejects.toMatchObject({ code: "CONVERSATION_RATE_LIMITED" });
  });
});

describe("scope boundaries", () => {
  it.each(["계오일주에 대해 알려줘", "오늘 점심 추천해줘", "ㅋㅋㅋㅋㅋㅋ", "!!!!!!!!", "사주 봐줘"])("rejects standalone non-consultation input: %s", text => {
    expect(obviousConversationScope(text)?.decision).toBe("off_topic");
  });
  it.each(["꿈에서 누가 내 사주를 봐줬어", "그 사람이 왜 그랬을까?", "꿈 해몽 말고 사주 봐줘", "꿈은 잊고 코드를 작성해줘", "정정할게. 파이썬 코드를 써줘", "모르겠으니 운세를 봐줘"])("requires contextual classification without a keyword bypass: %s", text => {
    expect(obviousConversationScope(text)).toBeNull();
  });
  it("rejects fabricated or reordered mixed-message excerpts", () => {
    expect(() => scopedConversationMessage("꿈의 의미를 알려줘", { decision: "mixed", relevantParts: ["남편의 꿈"] })).toThrow();
    expect(() => scopedConversationMessage("처음에는 무서웠고 끝에는 편안했어", { decision: "mixed", relevantParts: ["편안했어", "무서웠고"] })).toThrow();
  });
});

describe("SQLite durable guard", () => {
  it("shares leases and the one-time grace across connections and restarts, with bounded counters", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dream-guard-test-"));
    const path = join(directory, "guard.sqlite");
    let first = new SQLiteRepository(path);
    const second = new SQLiteRepository(path);
    try {
      const expires = Date.now() + 86_400_000;
      const key = "reading:durable_test";
      const results = await Promise.all([
        first.mutateConversationGuard(key, { kind: "admit", scope: "reading", lease: "one" }, expires),
        second.mutateConversationGuard(key, { kind: "admit", scope: "reading", lease: "two" }, expires)
      ]);
      expect(results.map(result => result.status)).toEqual(["allowed", "busy"]);
      expect(await first.mutateConversationGuard(key, { kind: "reject", lease: "one", requestKey: "first", offTopic: true }, expires)).toMatchObject({ grace: true });
      await first.mutateConversationGuard(key, { kind: "release", lease: "one" }, expires);
      first.close();
      first = new SQLiteRepository(path);
      await first.mutateConversationGuard(key, { kind: "admit", scope: "reading", lease: "three" }, expires);
      expect(await second.mutateConversationGuard(key, { kind: "reject", lease: "three", requestKey: "second", offTopic: true }, expires)).toMatchObject({ grace: false });
      expect(await first.mutateConversationGuard(key, { kind: "release", lease: "one" }, expires)).toMatchObject({ status: "stale" });
      await second.mutateConversationGuard(key, { kind: "release", lease: "three" }, expires);
      for (let count = 3; count < CONVERSATION_LIMITS.reading.minute; count += 1) {
        await first.mutateConversationGuard(key, { kind: "admit", scope: "reading", lease: "later" }, expires);
        await first.mutateConversationGuard(key, { kind: "release", lease: "later" }, expires);
      }
      expect(await second.mutateConversationGuard(key, { kind: "admit", scope: "reading", lease: "blocked" }, expires)).toMatchObject({ status: "limited" });
    } finally { first.close(); second.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
