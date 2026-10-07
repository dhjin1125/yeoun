import { describe, expect, it } from "vitest";
import { activeConsultationPlan, buildConsultationPlan } from "@/lib/consultation";
import { analyzeDreamContextLocally } from "@/lib/local-engine";

function fixture(dream: string, unresolved = ["스킨십 상대가 불분명해요.", "꿈속에서 남편의 역할이 불분명해요."]) {
  const { context } = analyzeDreamContextLocally(dream, null);
  context.consultation = {
    ...buildConsultationPlan(context), ready: false, limited: false, unresolved,
    question: { id: "consult-1", kind: "scene", prompt: "스킨십한 상대는 누구였나요?", options: [], reason: "상대를 확인해요.", placeholder: "기억나는 상대" }
  };
  return context;
}

describe("grounding a saved partner question", () => {
  it("uses the explicit dream actor and separates the waking bed companion", () => {
    const context = fixture("전에 사귀던 남자애가 나와서 함께 소파에 앉고 스킨십한 꿈을 꿨어. 남편과 옆에서 자고 있었어.");
    const plan = activeConsultationPlan(context);
    expect(plan.ready).toBe(true);
    expect(plan.question).toBeNull();
    expect(plan.unresolved).toEqual([]);
  });

  it.each([
    "낯선 남자애가 나와서 함께 소파에 앉고 스킨십한 꿈을 꿨어. 남편과 옆에서 자고 있었어.",
    "친구와 동료가 나와서 함께 소파에 앉고 스킨십한 꿈을 꿨어. 남편과 옆에서 자고 있었어.",
    "친구가 나와서 함께 앉고 스킨십했지만 상대가 누구인지 기억이 안 나.",
    "친구가 소파에 앉아 있었고 누군가와 함께 스킨십한 꿈을 꿨어.",
  ])("keeps a question when the actor is not unambiguous", dream => {
    expect(activeConsultationPlan(fixture(dream)).ready).toBe(false);
  });

  it("preserves an unrelated unresolved fact", () => {
    const context = fixture("친구가 나와서 함께 앉고 스킨십한 꿈을 꿨어.", ["스킨십 상대가 불분명해요.", "누가 누구를 때렸는지 불분명해요."]);
    expect(activeConsultationPlan(context).ready).toBe(false);
  });

  it("preserves a skipped answer", () => {
    const context = fixture("친구가 나와서 함께 앉고 스킨십한 꿈을 꿨어.", ["스킨십 상대가 불분명해요."]);
    const plan = activeConsultationPlan(context, [{ questionId: "consult-1", kind: "scene", answer: null, skipped: true }]);
    expect(plan.ready).toBe(false);
    expect(plan.limited).toBe(true);
  });
});
