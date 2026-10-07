import type { z } from "zod";
import type { AssistantTurnPayload, PaidOffer } from "../types";
import type { reportReviewSchema } from "./schemas";

export type PaidReviewSnapshot = {
  report: AssistantTurnPayload;
  decision: z.infer<typeof reportReviewSchema>;
  correctionTargets: string[];
};

function reviewableFields(report: AssistantTurnPayload): Record<string, unknown> {
  return {
    directAnswer: report.directAnswer,
    directAnswerTitle: report.directAnswerTitle,
    ...Object.fromEntries(report.sections.map((section, index) => [`section:${index}`, section])),
    interpretationChanges: report.interpretationChanges,
    suggestedQuestions: report.suggestedQuestions,
    evidenceQuotes: report.evidenceQuotes,
    referenceIds: (report.sources ?? []).map(source => source.id)
  };
}

export function changedPaidReviewFields(previous: AssistantTurnPayload, current: AssistantTurnPayload) {
  const before = reviewableFields(previous);
  const after = reviewableFields(current);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(target => JSON.stringify(before[target]) !== JSON.stringify(after[target]));
}

/** Reading aids, never an approval decision or a substitute for fact checking. */
export function buildPaidReviewContext(
  report: AssistantTurnPayload,
  offer: PaidOffer,
  previous: PaidReviewSnapshot | null
) {
  const contextIndex = offer.cards.findIndex(card => card.key === "pattern");
  const paragraphs = report.sections[contextIndex]?.paragraphs ?? [];
  const conditionCandidates = paragraphs.flatMap((text, paragraphIndex) => {
    // Both "했다면, ..." and "했다면 ..." express a condition. This only
    // locates candidates; the reviewer must still inspect their entire meaning.
    const condition = text.match(/^[^.!?。！？\n]{1,240}?(?:다면|라면|경우에는|경우엔|경우에)\s*[,，]?/u)?.[0];
    return condition ? [{ paragraphIndex, condition: condition.trim() }] : [];
  });
  const changedTargets = previous ? changedPaidReviewFields(previous.report, report) : [];
  return {
    sectionLocations: offer.cards.map((card, index) => ({
      key: card.key, target: `section:${index}`, title: card.promisedSectionTitle,
      paragraphCount: report.sections[index]?.paragraphs.length ?? 0
    })),
    contextExamples: {
      target: `section:${contextIndex}`,
      minimumExamples: 2,
      maximumExamples: 3,
      confirmedRealityMayBeAnAdditionalParagraph: true,
      syntacticCandidatesOnly: true,
      conditionCandidates
    },
    followupSuggestions: {
      field: "suggestedQuestions",
      count: report.suggestedQuestions.length,
      questions: report.suggestedQuestions,
      minimumSuggestions: 1,
      maximumSuggestions: 2,
      repeatInsideSectionRequired: false,
      purchasedQuestionAllowanceIsNotReportContent: true
    },
    previousReview: previous ? {
      ...previous,
      changedTargets,
      unchangedTargets: Object.keys(reviewableFields(report)).filter(target => !changedTargets.includes(target))
    } : null
  };
}

/** Use the existing final slot only when the old corrections were made and
 * re-review identified different fields. A repeated unresolved failure stops. */
export function canRepairNewPaidReviewFindings(
  previous: PaidReviewSnapshot | null,
  current: AssistantTurnPayload,
  currentTargets: string[]
) {
  if (!previous?.correctionTargets.length || !currentTargets.length) return false;
  const changedTargets = changedPaidReviewFields(previous.report, current);
  return previous.correctionTargets.every(target => changedTargets.includes(target)) &&
    currentTargets.every(target => !previous.correctionTargets.includes(target));
}
