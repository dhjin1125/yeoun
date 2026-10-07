import { describe, expect, it } from "vitest";
import { createReading, supplementFreeReading, toPublicReading, readingContext } from "@/lib/readings";
import { createOrder } from "@/lib/payments";
import { decryptDream, encryptJson } from "@/lib/crypto";
import { analyzeDreamContextLocally, freeDetailGuidance } from "@/lib/local-engine";
import { createReadingSchema } from "@/lib/validation";
import { DETAILED_DREAM, TestRepository } from "./helpers/repository";

describe("free reading enrichment", () => {
  it("persists a corrected symbol in a new revision while preserving the original", async () => {
    const repo = new TestRepository();
    const original = await createReading({dream:"뱀이 나왔어요",emotion:null},"corrected-revision",repo);
    const revised = await supplementFreeReading(original,"정정할게요, 뱀이 아니라 고양이였고 편안했어요",repo);
    const restored = await toPublicReading((await repo.getReading(revised.id))!,"http://localhost",repo);
    expect(readingContext(revised).symbols.map(symbol=>symbol.key)).toEqual(["animal"]);
    const answer=restored.timeline.find(turn=>turn.kind==="free")!.content;
    expect(JSON.stringify(answer)).not.toContain("뱀");
    expect(restored.canPurchaseFullReading).toBe(true);
    expect(decryptDream(original.encryptedDream,original.id)).toBe("뱀이 나왔어요");
  });
  it("explains a symbol without asking a question in place of its meaning", async () => {
    const repo = new TestRepository();
    const reading = await createReading({ dream: "뱀이 나왔어", emotion: null }, "symbol-only", repo);
    const result = await toPublicReading(reading, "http://localhost", repo);
    const answer = result.timeline.find((turn) => turn.kind === "free")!.content;
    expect(answer).toMatchObject({ freeReadingMode: "symbolic", directAnswerTitle: "뱀의 상징" });
    expect(JSON.stringify(answer)).toContain("경계");
    expect(JSON.stringify(answer)).not.toMatch(/적어|시작해 볼까요|상세 해몽/);
    expect(result.paidOffer).toBeNull();
    expect(result.canPurchaseFullReading).toBe(false);
  });

  it("marks input without a symbol as needing detail instead of fabricating a free answer", async () => {
    const repo = new TestRepository();
    const reading = await createReading({ dream: "기억이 안 나요", emotion: null }, "no-symbol", repo);
    const result = await toPublicReading(reading, "http://localhost", repo);
    expect(result.timeline.find((turn) => turn.kind === "free")!.content).toMatchObject({ freeReadingMode: "needs_detail", directAnswer: "", sections: [] });
    expect(result.canPurchaseFullReading).toBe(false);
    expect(result.paidOffer).toBeNull();
  });

  it.each([
    ["이상한 꿈이었어요", false], ["뱀이 나왔어", false],
    ["뱀이 나왔고 무서웠어요", true], ["뱀이 들어와서 문을 열어 내보냈어요", true]
  ])("uses scene content rather than character count: %s", (dream, ready) => {
    expect(freeDetailGuidance(analyzeDreamContextLocally(String(dream), null).context).ready).toBe(ready);
    expect(createReadingSchema.safeParse({ dream }).success).toBe(true);
  });

  it("blocks payment for thin input, then opens it for an enriched free revision without losing the original", async () => {
    const repo = new TestRepository();
    const original = await createReading({ dream: "뱀이 나왔어", emotion: null }, "supplement", repo);
    await expect(createOrder(original, "full_reading", "supplement", repo)).rejects.toMatchObject({ code: "MORE_DREAM_DETAIL_REQUIRED" });
    const before = await toPublicReading(original, "http://localhost", repo);
    expect(before.currentQuestion).toBeNull();
    expect(before.canPurchaseFullReading).toBe(false);
    const detail = "처음에는 무서워서 바라봤어요. 문을 열어 내보냈고 마지막에는 마음이 편안했어요.";
    const updated = await supplementFreeReading(original, detail, repo);
    const after = await toPublicReading(updated, "http://localhost", repo);
    expect(updated.id).not.toBe(original.id);
    expect(await repo.getReading(original.id)).toEqual(original);
    expect(decryptDream(updated.encryptedDream, updated.id)).toBe("뱀이 나왔어");
    expect(JSON.stringify(updated)).not.toContain(detail);
    expect(after.timeline.filter((turn) => turn.kind === "free")).toHaveLength(1);
    expect(after.timeline.some((turn) => "text" in turn.content && turn.content.text === detail)).toBe(true);
    expect(after.freeDetailGuidance?.ready).toBe(true);
    expect(after.canPurchaseFullReading).toBe(true);
    expect(after.entitlement.usedQuestions).toBe(0);
    const answer = after.timeline.find((turn) => turn.kind === "free")?.content;
    expect(answer).toMatchObject({ freeReadingMode: "symbolic", directAnswerTitle: "뱀의 상징" });
    expect(readingContext(updated).scenes.some((scene) => scene.emotion === "안도감")).toBe(true);
    expect((await createOrder(updated, "full_reading", "supplement", repo)).readingId).toBe(updated.id);
  });

  it("keeps thin text locked even when the analysis contains unsupported actions", async () => {
    const repo = new TestRepository();
    const reading = await createReading({ dream: "뱀이 나왔어", emotion: null }, "grounded-gate", repo);
    const poisoned = readingContext(reading);
    poisoned.scenes.push({ order: 9, people: [], action: "바라봄", place: "집", emotion: "안도감" });
    reading.encryptedContext = encryptJson(poisoned, "context", reading.id);
    expect((await toPublicReading(reading, "http://localhost", repo)).canPurchaseFullReading).toBe(false);
    await expect(createOrder(reading, "full_reading", "grounded-gate", repo)).rejects.toMatchObject({ code: "MORE_DREAM_DETAIL_REQUIRED" });
  });

  it("routes immediate danger in the added detail to support and keeps checkout closed", async () => {
    const repo = new TestRepository();
    const reading = await createReading({ dream: "뱀이 나왔어", emotion: null }, "safety-detail", repo);
    const updated = await supplementFreeReading(reading, "지금 자해하고 싶고 죽고 싶어요.", repo);
    const result = await toPublicReading(updated, "http://localhost", repo);
    expect(result.safetyNotice?.blocksInterpretation).toBe(true);
    expect(result.freeDetailGuidance).toBeNull();
    expect(result.canPurchaseFullReading).toBe(false);
    expect(result.paidOffer).toBeNull();
  });

  it("keeps explicit waking-life additions separate from dreamed scenes", async () => {
    const repo = new TestRepository();
    const original = await createReading({ dream: "뱀이 나왔어", emotion: null }, "reality-detail", repo);
    const updated = await supplementFreeReading(original, "요즘 회사에서 발표를 앞두고 불안해요.", repo);
    const context = readingContext(updated);
    expect(context.realityContexts).toContain("요즘 회사에서 발표를 앞두고 불안해요.");
    expect(context.scenes).toEqual(readingContext(original).scenes);
    expect((await toPublicReading(updated, "http://localhost", repo)).canPurchaseFullReading).toBe(false);
  });

  it("does not revise a reading while checkout is pending or after purchase", async () => {
    const repo = new TestRepository();
    const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "immutable-paid", repo);
    await createOrder(reading, "full_reading", "immutable-paid", repo);
    await expect(supplementFreeReading(reading, "편안했어요", repo)).rejects.toMatchObject({ code: "FREE_SUPPLEMENT_UNAVAILABLE" });
    const entitlement = await repo.getEntitlement(reading.id);
    await repo.saveEntitlement({ ...entitlement!, fullReadingPurchased: true });
    reading.status = "free_ready";
    await expect(supplementFreeReading(reading, "편안했어요", repo)).rejects.toMatchObject({ code: "FREE_SUPPLEMENT_UNAVAILABLE" });
  });
});
