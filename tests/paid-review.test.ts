import { describe, expect, it } from "vitest";
import { buildConsultationOffer } from "@/lib/consultation";
import { analyzeDreamContextLocally } from "@/lib/local-engine";
import { buildPaidReviewContext, canRepairNewPaidReviewFindings, type PaidReviewSnapshot } from "@/lib/ai/paid-review";
import type { AssistantTurnPayload } from "@/lib/types";

const offer = buildConsultationOffer(analyzeDreamContextLocally("꿈에서 뱀을 바라보다 문을 열어 내보냈어요.", null).context);
const report: AssistantTurnPayload = {
  generationSource: "codex",
  directAnswerTitle: "바라보고 내보낸 선택",
  directAnswer: "뱀을 바라본 뒤 문을 열어 내보낸 선택을 거리 조절과 연결해볼 수 있어요.",
  sections: offer.cards.map(card => ({ title: card.promisedSectionTitle, paragraphs: ["확인된 행동을 중심으로 가능한 읽기를 설명해요."] })),
  interpretationChanges: null, uncertainty: [], shareableSentences: [], evidenceQuotes: [],
  suggestedQuestions: ["바라본 뒤 내보낸 선택은 어떤 마음과 연결되나요?", "최근 어떤 경험을 함께 떠올려볼 수 있나요?"]
};
const decision: PaidReviewSnapshot["decision"] = {
  approved: false, semanticQuality: "minor", semanticConfidence: "high", semanticReasonCodes: [], inventedFacts: [], missingElements: ["계기 설명 보완"],
  redundantInterpretation: false, unsupportedSequenceOrRole: false, usesOmissionAsFact: false,
  addsValueBeyondFree: true, correctionApplied: true, headlineAnswered: true,
  offerCoverage: offer.cards.map(card => ({ key: card.key, fulfilled: card.key !== "pattern" })),
  revisionTargets: ["section:2"], feedback: "계기 설명을 보완하세요."
};

describe("paid review evidence and history", () => {
  it("locates two conditional examples alongside a confirmed context and questions outside the body", () => {
    const current = {
      ...report,
      sections: report.sections.map((section, index) => index === 2 ? {
        ...section,
        paragraphs: [
          "알려준 현실 맥락은 별도 문단으로 비교해요.",
          "최근 낯선 일을 앞두고 있었다면 직접 거리를 정하는 행동과 연결해볼 수 있어요.",
          "최근 뱀이 나오는 이야기를 접했다면, 그 대상의 기억이 꿈 소재와 연결됐을 가능성이 있어요."
        ]
      } : section)
    };
    const context = buildPaidReviewContext(current, offer, null);
    expect(context.contextExamples.conditionCandidates.map(item => item.paragraphIndex)).toEqual([1, 2]);
    expect(context.contextExamples).toMatchObject({ minimumExamples: 2, confirmedRealityMayBeAnAdditionalParagraph: true, syntacticCandidatesOnly: true });
    expect(context.followupSuggestions).toMatchObject({ field: "suggestedQuestions", count: 2, repeatInsideSectionRequired: false, purchasedQuestionAllowanceIsNotReportContent: true });
    expect(context.followupSuggestions.questions).toEqual(current.suggestedQuestions);
    expect(context.sectionLocations.map(item => [item.key, item.target])).toEqual([
      ["traditional", "section:0"], ["psychology", "section:1"], ["pattern", "section:2"], ["action", "section:3"]
    ]);
  });

  it("keeps the previous decision and actual field changes without treating approval as immunity", () => {
    const previous: PaidReviewSnapshot = { report, decision, correctionTargets: ["section:2"] };
    const current = { ...report, sections: report.sections.map((section, index) => index === 2 ? {
      ...section, paragraphs: ["수정 요청에 따라 구체적인 계기와 실제 꿈의 행동을 연결한 새 설명이에요."]
    } : section) };
    const context = buildPaidReviewContext(current, offer, previous);
    expect(context.previousReview?.changedTargets).toEqual(["section:2"]);
    expect(context.previousReview?.unchangedTargets).toContain("section:1");
    expect(context.previousReview?.decision).toEqual(decision);
    expect(canRepairNewPaidReviewFindings(previous, current, ["section:1", "suggestedQuestions"])).toBe(true);
    expect(canRepairNewPaidReviewFindings(previous, current, ["section:2", "suggestedQuestions"])).toBe(false);
    expect(canRepairNewPaidReviewFindings(previous, report, ["section:1"])).toBe(false);
    expect(canRepairNewPaidReviewFindings(null, current, ["section:1"])).toBe(false);
  });
});
