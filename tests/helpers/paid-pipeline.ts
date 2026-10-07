import type { AssistantTurnPayload } from "@/lib/types";
import type { GroundedPaidReview, PaidPipelineState } from "@/lib/ai/paid-pipeline";
import { PAID_PIPELINE_VERSION } from "@/lib/ai/paid-pipeline";
export const pipelineReport: AssistantTurnPayload = {
  generationSource: "codex",
  directAnswerTitle: "꿈에서 문을 열었던 이유", directAnswer: "문을 열고 나니 마음이 편안해졌다고 했어요.",
  sections: ["장면 연결", "가능한 마음", "일상 계기", "풀이 구별"].map(title => ({ title, paragraphs: ["낯선 대상을 바라본 행동에서 거리를 조절하려는 마음을 살펴볼 수 있어요."] })),
  interpretationChanges: null, uncertainty: [], shareableSentences: [], suggestedQuestions: ["문을 연 이유가 궁금해요."], evidenceQuotes: ["문을 열었어요"], sources: []
};
export const pipelineApproval: GroundedPaidReview = {
  approved: true, headlineAnswered: true, correctionApplied: true, addsValueBeyondFree: true,
  offerCoverage: ["traditional", "psychology", "pattern", "action"].map(key => ({ key: key as "traditional", fulfilled: true })), findings: []
};
export function acceptedCheckpoint(report = pipelineReport): PaidPipelineState {
  return { version: PAID_PIPELINE_VERSION, stage: "accepted", report, review: pipelineApproval, findings: [], repairs: 0, reviewCorrections: 0, reviewProblems: [], localError: null };
}
