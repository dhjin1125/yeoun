import { describe, expect, it } from "vitest";
import { formatFreeSymbolicAnswer, formatSymbolMeaning } from "@/lib/symbolic-copy";
import { createReading, toPublicReading } from "@/lib/readings";
import { encryptJson } from "@/lib/crypto";
import type { AssistantTurnPayload } from "@/lib/types";
import { TestRepository } from "./helpers/repository";

const attack = "전통적 관점에서는 공격받는 장면이 갈등이나 위협의 상징으로 여겨지기도 해요. 상징적 해석으로는 거친 자극이나 압박을 드러낸 장면으로 볼 수 있지만, 현실의 사건을 예고하지는 않아요.";
const blood = "전통적 관점에서는 피가 생명력이나 강한 에너지의 상징으로 해석되기도 해요. 상징적으로는 장면의 긴장감이나 소모감을 강조하는 표현으로 볼 수 있으며, 건강이나 미래를 뜻한다고 단정할 수는 없어요.";
const saved: AssistantTurnPayload = {
  freeReadingMode: "symbolic", generationSource: "codex", directAnswerTitle: "공격받는 장면",
  directAnswer: attack, sections: [{ title: "피가 나는 장면", paragraphs: [blood] }],
  interpretationChanges: null, uncertainty: [], shareableSentences: [], suggestedQuestions: []
};

describe("saved symbolic copy", () => {
  it("finishes both reported passages at their possible meaning", () => {
    const result = formatFreeSymbolicAnswer(saved);
    expect(result.directAnswer).toContain("내 의지와 상관없이");
    expect(result.sections[0].paragraphs[0]).toContain("선명한 흔적");
    expect(JSON.stringify(result)).not.toMatch(/전통적 관점에서는|예고하지|단정할 수/);
    expect(formatFreeSymbolicAnswer(result)).toEqual(result);
    expect(saved.directAnswer).toBe(attack);
  });

  it("uses the saved action title to correct the known reversed legacy template", () => {
    const result = formatFreeSymbolicAnswer({ ...saved, directAnswerTitle: "때리는 장면" });
    expect(result.directAnswer).toContain("누가 행동하고 누가 당했는지");
    expect(result.directAnswer).not.toContain("공격받");
    expect(formatFreeSymbolicAnswer(result)).toEqual(result);
    const bespoke = { ...saved, directAnswer: "문을 두드리는 소리가 오래 남았다면, 답을 기다리는 마음과 연결해볼 수 있어요." };
    expect(formatFreeSymbolicAnswer(bespoke).directAnswer).toBe(bespoke.directAnswer);
  });

  it("leaves actual safety guidance and other kinds of answers alone", () => {
    expect(formatSymbolMeaning("지금 위험하다면 안전한 곳으로 이동하고 112에 연락해 주세요.")).toBe("지금 위험하다면 안전한 곳으로 이동하고 112에 연락해 주세요.");
    const legacy = { ...saved, freeReadingMode: undefined };
    expect(formatFreeSymbolicAnswer(legacy)).toBe(legacy);
    expect(formatSymbolMeaning("피는 생명력의 상징으로 볼 수 있어요.")).toBe("피는 생명력의 상징으로 볼 수 있어요.");
  });

  it("updates restored output without rewriting the encrypted saved record", async () => {
    const repo = new TestRepository();
    const reading = await createReading({ dream: "뱀이 나왔어", emotion: null }, "legacy-copy", repo);
    const free = (await repo.getConversationTurns(reading.id)).find(turn => turn.kind === "free")!;
    free.encryptedContent = encryptJson(saved, "turn", free.id);
    await repo.saveConversationTurn(free);
    const encryptedBefore = JSON.stringify(free.encryptedContent);
    const result = await toPublicReading(reading, "http://localhost", repo);
    expect(result.timeline.find(turn => turn.kind === "free")?.content).toEqual(formatFreeSymbolicAnswer(saved));
    expect(JSON.stringify((await repo.getConversationTurns(reading.id)).find(turn => turn.kind === "free")!.encryptedContent)).toBe(encryptedBefore);
  });
});
