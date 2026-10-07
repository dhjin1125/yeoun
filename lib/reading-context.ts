import { observedDreamText, splitDreamEvidence } from "./dream-evidence";
import type { DreamContext, GenerationUserEvidence } from "./types";
import { interpretationQuestionForFocus } from "./interpretation-focus";

/** Shared evidence envelope, not a dictionary of dream → meaning rules.
 * Engine summaries remain hints: only the separately retained user evidence
 * can establish a dreamed event, motive, feeling, or ending.
 */
export function buildReadingContext(context: DreamContext, originalDream: string | undefined, userEvidence: GenerationUserEvidence) {
  const original = originalDream?.trim() || context.dreamEvidence || "";
  const clarifications = userEvidence.clarificationAnswers
    .filter(answer => !answer.skipped && answer.answer?.trim())
    .map(answer => ({ kind: answer.kind, text: answer.answer!.trim() }));
  const originalParts = splitDreamEvidence(original);
  const sceneParts = clarifications.filter(answer => answer.kind === "scene")
    .map(answer => splitDreamEvidence(answer.text));
  const dreamText = [originalParts.dreamText, ...sceneParts.map(part => part.dreamText)].filter(Boolean).join("\n");
  const scenes = [...context.scenes].sort((a, b) => a.order - b.order)
    .map(scene => ({ ...scene, people: [...scene.people] }));
  return {
    version: 1 as const,
    evidence: {
      originalDream: original,
      dreamText,
      activeDreamText: observedDreamText(dreamText),
      selectedEmotion: userEvidence.selectedEmotion ?? context.selectedEmotion ?? null,
      selectedFocusQuestion: interpretationQuestionForFocus(context.selectedFocus),
      // An unscoped feeling must not silently become the dream's final emotion.
      clarifications,
      realityTexts: [...originalParts.realityTexts, ...sceneParts.flatMap(part => part.realityTexts),
        ...clarifications.filter(answer => answer.kind === "recent_context").map(answer => answer.text)]
    },
    engineHints: {
      dreamer: context.dreamer,
      dreamerDescription: context.dreamerDescription,
      relationshipToUser: context.relationshipToUser,
      userQuestions: [...(context.userQuestions ?? [])],
      scenes,
      emotions: [...context.emotions],
      // Last remembered scene is not necessarily a resolved story ending.
      lastRecordedSceneOrder: scenes.at(-1)?.order ?? null,
      uncertainties: [...context.uncertainties]
    }
  };
}
