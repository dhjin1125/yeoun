import { describe, expect, it } from "vitest";
import { buildReadingContext } from "@/lib/reading-context";
import { analyzeDreamContextLocally, applyClarificationsToContext } from "@/lib/local-engine";
import type { GenerationUserEvidence } from "@/lib/types";

const empty: GenerationUserEvidence = { selectedEmotion: null, clarificationAnswers: [] };

describe("domain-independent reading context", () => {
  it.each([
    "도서관에서 책을 찾다가 문이 닫혔어요. 마지막에는 답답했어요.",
    "무대에서 노래하다가 목소리가 나오지 않았어요. 친구가 함께 불러줘서 안도했어요.",
    "우주선 안에서 이름 모를 기계를 고쳤어요. 결국 다시 움직였고 기뻤어요.",
    "택배를 보내려는데 주소가 자꾸 지워졌어요. 끝내 보내지 못했어요.",
    "누군가 연을 날리는 것을 조용히 지켜봤어요. 편안했어요."
  ])("preserves uncatalogued actions and the complete source: %s", dream => {
    const context = analyzeDreamContextLocally(dream, null).context;
    const before = structuredClone(context);
    const packet = buildReadingContext(context, dream, empty);
    expect(packet.evidence.originalDream).toBe(dream);
    expect(packet.evidence.dreamText).toContain(dream.split(".")[0]);
    expect(packet.engineHints.scenes).toEqual([...context.scenes].sort((a,b) => a.order-b.order));
    expect(packet.engineHints.lastRecordedSceneOrder).toBe(context.scenes.at(-1)?.order);
    expect(packet.engineHints).not.toHaveProperty("resolved");
    expect(packet.engineHints).not.toHaveProperty("meaning");
    expect(context).toEqual(before);
  });

  it("preserves different endings without a symbol-specific meaning rule", () => {
    const base = "발표할 순서를 기다렸어요. ";
    const dreams = [base + "마지막에는 무서웠어요.", base + "마지막에는 마음이 편안해졌어요."];
    const packets = dreams.map(dream => buildReadingContext(analyzeDreamContextLocally(dream,null).context, dream, empty));
    expect(packets[0].engineHints.scenes.at(-1)?.emotion).toBe("두려움");
    expect(packets[1].engineHints.scenes.at(-1)?.emotion).toBe("안도감");
    expect(packets[0].evidence.activeDreamText).not.toBe(packets[1].evidence.activeDreamText);
  });

  it("separates supplemental feelings and reality from dreamed events", () => {
    const dream = "빛나는 문양을 봤어요. 현실에서는 이사를 준비해요.";
    const evidence: GenerationUserEvidence = { selectedEmotion: null, clarificationAnswers: [
      { questionId: "feeling", kind: "emotion", answer: "깬 뒤에는 후련했어요", skipped: false },
      { questionId: "reality", kind: "recent_context", answer: "회사에서 발표를 앞두고 있어요", skipped: false },
      { questionId: "scene", kind: "scene", answer: "문양이 사라졌어요. 현실에서는 잠이 부족해요", skipped: false },
      { questionId: "skip", kind: "scene", answer: "유령이 나타났어요", skipped: true }
    ] };
    const context = applyClarificationsToContext(analyzeDreamContextLocally(dream,null).context, evidence.clarificationAnswers);
    const packet = buildReadingContext(context, dream, evidence);
    expect(packet.evidence.dreamText).toContain("문양이 사라졌어요");
    expect(packet.evidence.dreamText).not.toMatch(/회사|이사|후련|부족|유령/);
    expect(packet.evidence.realityTexts.join(" ")).toMatch(/이사.*부족.*발표/);
    expect(packet.evidence.clarifications.find(item=>item.kind === "emotion")?.text).toBe("깬 뒤에는 후련했어요");
  });

  it("preserves corrections and does not promote quoted speech into observations", () => {
    const dream = '친구가 "뱀을 봤어"라고 말했어요. 고양이가 나타났어요. 아니 사실은 강아지였어요';
    const packet = buildReadingContext(analyzeDreamContextLocally(dream,null).context, dream, empty);
    expect(packet.evidence.originalDream).toContain("뱀");
    expect(packet.evidence.activeDreamText).not.toMatch(/뱀|고양이/);
    expect(packet.evidence.activeDreamText).toContain("강아지");
  });

  it("uses retained source for callers that omit the original argument", () => {
    const context = analyzeDreamContextLocally("이름 모를 악기를 연주했어요",null).context;
    expect(buildReadingContext(context, undefined, empty).evidence.dreamText).toContain("악기를 연주");
  });

  it("does not mutate the context when a consumer edits its hints", () => {
    const context = analyzeDreamContextLocally("친구와 집에서 기다렸어요",null).context;
    const before = structuredClone(context);
    const packet = buildReadingContext(context,undefined,empty);
    packet.engineHints.scenes[0].people.push("추가 인물");
    expect(context).toEqual(before);
  });
});
