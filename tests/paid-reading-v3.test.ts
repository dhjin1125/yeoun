import { describe, expect, it, vi } from "vitest";
import {
  PAID_COMPOSITION_V3_PROMPT,
  PAID_COMPOSITION_V3_REVIEW_PROMPT,
  paidCompositionV3Error,
  paidCompositionV3VisibleBodyCharacterCount,
  runPaidCompositionV3Pipeline,
  type PaidCompositionV3Adapter
} from "@/lib/paid-reading-v3";
import type { PaidCompositionV3Content } from "@/lib/types";

const source = "가글하다가 피가 나서 주치의에게 전화했다. 집에서 응급실로 가려고 했다. 수술 뒤 회복 중이었다.";

function validComposition(): PaidCompositionV3Content {
  return {
    title: "가글 뒤 응급상황으로 바뀐 꿈",
    bridge: "무료 해석은 평범한 회복 행동이 위급한 장면으로 뒤집힌 흐름을 짚었어요. 여기서는 그 뒤 도움을 찾는 행동이 어떤 방향을 더하는지 이어서 살펴봐요.",
    newPerspectives: [
      {
        heading: "집에서 시작된 위기",
        perspectiveLabel: "익숙한 공간의 역할 변화",
        paragraphs: ["집은 꿈의 시작에서 평범한 회복 행동을 하는 장소였지만, 출혈 뒤에는 곧 응급실로 이동해야 할 출발점이 되었어요. 같은 공간이 안정의 상징이라고 단정할 수는 없고, 일상적인 회복과 급한 대응이 한 장면 안에서 이어진다는 변화가 먼저 보여요.".repeat(2)],
        evidenceQuotes: ["집에서 응급실로 가려고 했다"]
      },
      {
        heading: "주치의를 먼저 찾음",
        perspectiveLabel: "도움의 대상을 구체적으로 선택함",
        paragraphs: ["꿈속에서 막연히 누군가를 찾은 것이 아니라 주치의에게 전화했어요. 최근 수술을 맡은 사람이라는 구체성이 있어, 위기 앞에서 필요한 도움을 어디에 구할지 이미 알고 있는 흐름으로 읽을 수 있어요. 이것은 실제 성격에 대한 판단이 아니라 꿈속 행동의 순서에 대한 해석이에요.".repeat(2)],
        evidenceQuotes: ["주치의에게 전화했다"]
      }
    ],
    relationshipSynthesis: [
      "출혈은 평범한 회복 장면을 갑자기 끊지만, 전화와 이동 계획은 그 장면을 그대로 끝내지 않아요. 위기가 생긴 뒤 꿈의 중심이 놀람에서 구체적인 대응으로 옮겨갑니다. 이 순서는 장면의 긴장을 키우는 데서 멈추지 않고 다음 행동으로 이어져요.",
      "집에서 주치의에게 연락하고 응급실로 향하려는 순서는, 낯선 재난을 구경하는 장면보다 실제 회복 중의 걱정이 어디로 이어지는지를 보여줘요. 도움을 찾는 움직임이 출혈 장면의 결말을 바꿔 놓습니다. 꿈은 위험을 보여준 뒤 그 위험을 어떻게 다룰지까지 이어서 배치해요."
    ],
    finalIntegration: "이 꿈은 회복 중 갑작스러운 위기를 두려워하는 마음과 그때 도움을 찾으려는 움직임이 함께 놓인 이야기예요."
  };
}

function provenance() {
  return {
    paidCompositionVersion: 3 as const,
    instructionVersion: "paid-composition-v3-1" as const,
    generationInstructionSha256: "a".repeat(64),
    appInstructionsSha256: "b".repeat(64),
    generationSource: "codex" as const
  };
}

function adapter(overrides: Partial<PaidCompositionV3Adapter> = {}): PaidCompositionV3Adapter {
  return {
    async draft() { return { kind: "complete", composition: validComposition(), provenance: provenance() }; },
    async repair(composition) { return { kind: "complete", composition, provenance: provenance() }; },
    async review() { return { approved: true, findings: [] }; },
    ...overrides
  };
}

describe("Paid Composition V3 staged contract", () => {
  it("accepts the grounded two-perspective structure without an alternative reading", () => {
    const composition = validComposition();
    expect(paidCompositionV3VisibleBodyCharacterCount(composition)).toBeGreaterThanOrEqual(900);
    expect(paidCompositionV3VisibleBodyCharacterCount(composition)).toBeLessThanOrEqual(1500);
    expect(paidCompositionV3Error(composition, source)).toBeNull();
  });

  it("rejects an ungrounded quote, duplicate perspective axis, invalid bridge, and question CTA", () => {
    const ungrounded = validComposition();
    ungrounded.newPerspectives[0]!.evidenceQuotes = ["혼자 집에서 떨었다"];
    expect(paidCompositionV3Error(ungrounded, source)).toBe("AI_PAID_V3_UNGROUNDED_EVIDENCE");

    const duplicate = validComposition();
    duplicate.newPerspectives[1] = { ...duplicate.newPerspectives[0]! };
    expect(paidCompositionV3Error(duplicate, source)).toBe("AI_PAID_V3_DUPLICATE_PERSPECTIVE");

    const bridge = validComposition();
    bridge.bridge = "무료 해석의 핵심을 이어받아요.";
    expect(paidCompositionV3Error(bridge, source)).toBe("AI_PAID_V3_BRIDGE_SENTENCES");

    const question = validComposition();
    question.finalIntegration = "이 꿈은 무슨 의미일까요?";
    expect(paidCompositionV3Error(question, source)).toBe("AI_PAID_V3_CTA");
  });

  it("keeps insufficient grounded material as an empty internal state", async () => {
    const review = vi.fn();
    const repair = vi.fn();
    const result = await runPaidCompositionV3Pipeline(adapter({
      async draft() { return { kind: "insufficient_grounded_material", reasonCode: "INSUFFICIENT_GROUNDED_MATERIAL" }; },
      repair,
      review
    }), source);
    expect(result).toEqual({ kind: "insufficient_grounded_material", reasonCode: "INSUFFICIENT_GROUNDED_MATERIAL" });
    expect(result).not.toHaveProperty("composition");
    expect(review).not.toHaveBeenCalled();
    expect(repair).not.toHaveBeenCalled();
  });

  it("uses the separate semantic review to repair free paraphrase and returns provenance", async () => {
    const reviewed: string[] = [];
    const pipeline = await runPaidCompositionV3Pipeline(adapter({
      async review(composition) {
        reviewed.push(composition.newPerspectives[0]!.paragraphs[0]!);
        return reviewed.length === 1
          ? { approved: false, findings: [{ kind: "free_paraphrase", target: "newPerspective:0", quote: "같은 말", explanation: "무료 핵심을 다시 말했어요.", requiredChange: "실제 입력의 다른 관계를 해석하세요." }] }
          : { approved: true, findings: [] };
      },
      async repair(composition) {
        const repaired = structuredClone(composition);
        repaired.newPerspectives[0]!.paragraphs[0] = "집에서 시작한 평범한 회복 행동과 갑작스러운 출혈은 한 공간의 기능을 바꿔 놓아요. 여기에 주치의에게 전화하고 응급실로 가려는 움직임이 더해져, 꿈은 놀람만 남기지 않고 실제 대응의 순서까지 이어집니다.".repeat(2);
        return { kind: "complete", composition: repaired, provenance: provenance() };
      }
    }), source);
    expect(pipeline.kind).toBe("complete");
    if (pipeline.kind !== "complete") throw new Error("Expected complete result");
    expect(reviewed).toHaveLength(2);
    expect(pipeline.composition).toMatchObject({ paidCompositionVersion: 3, instructionVersion: "paid-composition-v3-1", generationInstructionSha256: "a".repeat(64) });
  });

  it("does not publish missing or overlapping promised perspectives after its single repair", async () => {
    const review = vi.fn(async () => ({
      approved: false,
      findings: [{ kind: "not_new_perspective" as const, target: "newPerspective:1", quote: "무료 핵심", explanation: "두 번째 관점이 무료 핵심을 반복합니다.", requiredChange: "구매 계약의 다른 근거 축을 새로 해석하세요." }]
    }));
    const repair = vi.fn(async (composition: PaidCompositionV3Content) => ({ kind: "complete" as const, composition, provenance: provenance() }));
    await expect(runPaidCompositionV3Pipeline(adapter({ review, repair }), source)).rejects.toMatchObject({ code: "AI_PAID_V3_REVIEW_FAILED" });
    expect(repair).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledTimes(2);
  });

  it("keeps writer and semantic-review instructions separate from the existing V2 paid pipeline", () => {
    expect(PAID_COMPOSITION_V3_PROMPT).toContain("insufficient_grounded_material");
    expect(PAID_COMPOSITION_V3_REVIEW_PROMPT).toContain("무료에서 이미 완결한 하나의 행동 흐름");
    expect(PAID_COMPOSITION_V3_REVIEW_PROMPT).toContain("구매 당시 snapshot");
  });
});
