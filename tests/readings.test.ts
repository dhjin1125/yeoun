import { describe, expect, it } from "vitest";
import { decryptJson } from "@/lib/crypto";
import {
  answerClarification,
  createReading,
  generateAndStoreDetailedReading,
  readingContext,
  toPublicReading
} from "@/lib/readings";
import type { AssistantTurnPayload } from "@/lib/types";
import { DETAILED_DREAM, TestRepository } from "./helpers/repository";

function assistantAnswer(publicReading: Awaited<ReturnType<typeof toPublicReading>>, kind: "free" | "detailed") {
  const turn = publicReading.timeline.findLast((candidate) => candidate.kind === kind);
  if (!turn || !("directAnswer" in turn.content)) throw new Error(`Missing ${kind} assistant turn`);
  return turn.content;
}

describe("reading lifecycle", () => {
  it("reports only completed analysis milestones in monotonic order", async () => {
    const repository = new TestRepository();
    const progress: Array<{ stage: string; percent: number }> = [];

    await createReading(
      { dream: DETAILED_DREAM, emotion: null },
      "session-progress",
      repository,
      (update) => progress.push({ stage: update.stage, percent: update.percent })
    );

    expect(progress.map((update) => update.stage)).toEqual([
      "dream_analyzed",
      "reading_saved",
      "ai_fallback_prepared",
      "free_reading_ready"
    ]);
    expect(progress.map((update) => update.percent)).toEqual([30, 52, 88, 92]);
    expect(progress.every((update, index) => index === 0 || update.percent >= progress[index - 1]!.percent)).toBe(true);
  });

  it("stores raw dream text only as ciphertext and returns a complete free timeline answer", async () => {
    const repository = new TestRepository();
    const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "session-a", repository);
    const publicReading = await toPublicReading(reading, "https://dream.example", repository);

    expect(reading.status).toBe("free_ready");
    expect(JSON.stringify(reading.encryptedDream)).not.toContain(DETAILED_DREAM);
    expect(publicReading.restoreUrl).toMatch(/^https:\/\/dream\.example\/reading\//);
    expect(publicReading.timeline.map((turn) => turn.kind)).toEqual(["dream", "free"]);
    expect(assistantAnswer(publicReading, "free").sections.map((section) => section.title)).toEqual([
      "장면을 나눠보면",
      "심리적으로 가능한 연결",
      "꿈만으로 확실히 말할 수 없는 부분"
    ]);
    expect(publicReading).not.toHaveProperty("paidReport");
    expect(JSON.stringify(publicReading)).not.toContain("꿈이 움직인 방향");
  });

  it("persists the selected interpretation focus for detail while free explains symbols", async () => {
    const repository = new TestRepository();
    const reading = await createReading(
      { dream: DETAILED_DREAM, emotion: null, focus: "good_or_bad" },
      "session-focus",
      repository
    );
    const publicReading = await toPublicReading(reading, "https://dream.example", repository);

    expect(readingContext(reading).selectedFocus).toBe("good_or_bad");
    expect(readingContext(reading).userQuestions?.[0]).toBe("좋은 꿈인지 나쁜 꿈인지");
    expect(JSON.stringify(reading.encryptedContext)).not.toContain("좋은 꿈인지 나쁜 꿈인지");
    expect(assistantAnswer(publicReading, "free").directAnswer).toMatch(/좋은 꿈인지 나쁜 꿈인지|좋은 일을 보장/u);
  });

  it("shows a brief free result before asking for optional detail", async () => {
    const repository = new TestRepository();
    let reading = await createReading(
      {
        dream: "뱀이 조용히 나타났다가 금방 사라지는 꿈을 꾸었어요.",
        emotion: null,
        focus: "repetition"
      },
      "session-b",
      repository
    );

    expect(reading.status).toBe("free_ready");
    expect(reading.questions).toHaveLength(0);
    for (const current of reading.questions) {
      reading = await answerClarification(
        reading,
        { questionId: current.id, answer: null, skipped: true },
        repository
      );
    }

    const publicReading = await toPublicReading(reading, "https://dream.example", repository);
    expect(reading.status).toBe("free_ready");
    expect(publicReading.answeredQuestionCount).toBe(0);
    expect(publicReading.currentQuestion).toBeNull();
    expect(publicReading.freeDetailGuidance?.ready).toBe(false);
    expect(publicReading.canPurchaseFullReading).toBe(false);
    expect(publicReading.paidOffer).toBeNull();
    expect(readingContext(reading).selectedFocus).toBe("repetition");
    expect(assistantAnswer(publicReading, "free").directAnswer).toContain("이 꿈이 반복됐다는 정보가 없어요");
    expect(assistantAnswer(publicReading, "free").uncertainty).toEqual([]);
  });

  it("keeps a recent-context clarification out of the dream scene parser", async () => {
    const repository = new TestRepository();
    let reading = await createReading(
      { dream: DETAILED_DREAM, emotion: null },
      "session-typed-context",
      repository
    );
    const current = { id: "legacy-recent-context", kind: "recent_context" as const, prompt: "최근 마음에 걸리는 일", placeholder: "최근 있었던 일", options: [] };
    reading.status = "clarifying";
    reading.questions = [current];
    await repository.saveReading(reading);

    reading = await answerClarification(
      reading,
      {
        questionId: current.id,
        answer: "회사에서 큰 발표를 앞두고 있어요.",
        skipped: false
      },
      repository
    );

    const context = readingContext(reading);
    const publicReading = await toPublicReading(reading, "https://dream.example", repository);
    const freeText = JSON.stringify(assistantAnswer(publicReading, "free"));
    expect(context.realityContexts).toContain("회사에서 큰 발표를 앞두고 있어요.");
    expect(context.places).not.toContain("일터");
    expect(context.scenes.some((scene) => scene.place === "일터")).toBe(false);
    expect(freeText).not.toContain("장소 ‘일터’");
  });

  it("keeps immediate safety support ahead of a selected relationship focus", async () => {
    const repository = new TestRepository();
    const reading = await createReading(
      {
        dream: "악몽에서 깬 뒤에도 지금 죽고 싶다는 생각이 계속 들고 혼자 있어요.",
        emotion: null,
        focus: "relationship"
      },
      "session-safety-focus",
      repository
    );
    const publicReading = await toPublicReading(reading, "https://dream.example", repository);

    expect(readingContext(reading).selectedFocus).toBe("relationship");
    expect(publicReading.safetyNotice?.route).toBe("immediate_self");
    expect(publicReading.timeline.some((turn) => turn.kind === "free")).toBe(false);
    expect(publicReading.paidOffer).toBeNull();
    expect(publicReading.canPurchaseFullReading).toBe(false);
  });

  it("never serializes a stored detailed body before purchase", async () => {
    const repository = new TestRepository();
    const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "session-c", repository);
    await generateAndStoreDetailedReading(reading, repository);
    const detailedTurn = (await repository.getConversationTurns(reading.id)).find((turn) => turn.kind === "detailed");
    if (!detailedTurn) throw new Error("Missing generated detailed turn");
    const detailed = decryptJson<AssistantTurnPayload>(detailedTurn.encryptedContent, "turn", detailedTurn.id);

    const publicReading = await toPublicReading(reading, "https://dream.example", repository);
    const publicJson = JSON.stringify(publicReading);

    expect(publicReading.timeline.some((turn) => turn.kind === "detailed")).toBe(false);
    expect(publicJson).not.toContain(detailed.directAnswer);
    expect(publicJson).not.toContain("paidReport");
    expect(publicJson).toContain("firstSentence");
  });
});
