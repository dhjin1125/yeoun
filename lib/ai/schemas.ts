import { z } from "zod";
import { PAID_READING_LIMITS, PAID_READING_SECTIONS } from "../paid-reading-model";
import { PAID_COMPOSITION_V3_INSTRUCTION_VERSION, STAGED_FREE_READING_V3_INSTRUCTION_VERSION } from "../types";

export const aiQuestionSchema = z.object({
  kind: z.enum(["scene", "relationship", "emotion", "recent_context", "dreamer"]),
  prompt: z.string().min(5).max(100),
  options: z.array(z.string().min(1).max(40)).max(0),
  placeholder: z.string().min(2).max(80)
});

const aiSceneSchema = z.object({
  order: z.number().int().min(1).max(12),
  people: z.array(z.string().min(1).max(40)).max(6),
  action: z.string().min(1).max(100),
  place: z.string().min(1).max(50).nullable(),
  emotion: z.string().min(1).max(40).nullable()
});

export const aiContextSchema = z.object({
  dreamer: z.enum(["user", "someone_else", "unknown"]),
  dreamerDescription: z.string().min(1).max(80).nullable(),
  relationshipToUser: z.string().min(1).max(80).nullable(),
  userQuestions: z.array(z.string().min(3).max(100)).max(6),
  statedPersonalDetails: z.array(z.string().min(1).max(80)).max(8),
  people: z.array(z.string().min(1).max(40)).max(8),
  scenes: z.array(aiSceneSchema).min(1).max(12),
  places: z.array(z.string().min(1).max(50)).max(8),
  emotions: z.array(z.string().min(1).max(40)).max(8),
  realityContexts: z.array(z.string().min(1).max(240)).max(6),
  isRecurring: z.boolean(),
  uncertainties: z.array(z.string().min(1).max(120)).max(8),
  questions: z.array(aiQuestionSchema).max(1)
});

const answerSectionSchema = z.object({
  title: z.string().min(2).max(50),
  paragraphs: z.array(z.string().min(20).max(700)).min(1).max(5)
});

const interpretationChangesSchema = z.object({
  newlyLearned: z.string().min(2).max(300),
  revisedInterpretation: z.string().min(20).max(600)
});

const assistantCore = {
  directAnswer: z.string().min(20).max(700),
  interpretationChanges: interpretationChangesSchema.nullable(),
  uncertainty: z.array(z.string().min(10).max(260)).max(4),
  shareableSentences: z.array(z.string().min(5).max(260)).max(3),
  suggestedQuestions: z.array(z.string().min(3).max(80)).max(3)
};

export const freeAssistantSchema = z.object({
  ...assistantCore,
  sections: z.array(answerSectionSchema).length(3)
});

export const symbolicFreeSchema = z.object({
  symbols: z.array(z.object({
    name: z.string().min(1).max(40),
    title: z.string().min(2).max(50),
    evidence: z.string().min(1).max(100),
    meaning: z.string().min(30).max(350),
    referenceIds: z.array(z.string().min(2).max(80)).max(3)
  })).max(4),
  integratedReading: z.object({
    title: z.string().min(3).max(60),
    paragraphs: z.array(z.string().min(30).max(500)).min(1).max(2),
    evidenceQuotes: z.array(z.string().min(2).max(140)).min(1).max(6)
  }).nullable(),
  nextQuestion: z.string().min(5).max(140).nullable()
});

const freeReadingCoverageItemV3Schema = z.object({
  label: z.string().trim().min(2).max(100),
  evidenceQuotes: z.array(z.string().min(2).max(240)).min(1).max(6)
}).strict();

export const stagedFreeReadingV3Schema = z.object({
  title: z.string().trim().min(3).max(80),
  primarySection: z.object({
    heading: z.string().trim().min(2).max(70),
    paragraphs: z.tuple([
      z.string().trim().min(20).max(600),
      z.string().trim().min(20).max(600)
    ])
  }).strict(),
  secondarySection: z.object({
    heading: z.string().trim().min(2).max(70),
    paragraphs: z.array(z.string().trim().min(20).max(600)).min(1).max(2)
  }).strict(),
  coverage: z.object({
    primary: freeReadingCoverageItemV3Schema,
    secondary: freeReadingCoverageItemV3Schema,
    reserved: z.array(freeReadingCoverageItemV3Schema).max(4)
  }).strict()
}).strict();

/** Provider-compatible shape for Codex Structured Outputs; final parsing still uses stagedFreeReadingV3Schema. */
export const stagedFreeReadingV3CodexTransportSchema = stagedFreeReadingV3Schema.extend({
  primarySection: stagedFreeReadingV3Schema.shape.primarySection.extend({
    paragraphs: z.array(z.string().trim().min(20).max(600)).min(2).max(2)
  })
});
export const STAGED_FREE_READING_V3_CODEX_TRANSPORT_SCHEMA_VERSION = 1 as const;

export const stagedFreeReadingV3PayloadSchema = stagedFreeReadingV3Schema.extend({
  freeCompositionVersion: z.literal(3),
  contentContractVersion: z.literal(1),
  contentContract: z.object({
    delivered: freeReadingCoverageItemV3Schema,
    discovered: freeReadingCoverageItemV3Schema,
    reserved: z.array(freeReadingCoverageItemV3Schema).max(4),
    offerEligibility: z.object({
      eligible: z.boolean(),
      perspectives: z.array(freeReadingCoverageItemV3Schema).max(2)
    }).strict()
  }).strict(),
  instructionVersion: z.literal(STAGED_FREE_READING_V3_INSTRUCTION_VERSION),
  generationInstructionSha256: z.string().regex(/^[a-f0-9]{64}$/),
  appInstructionsSha256: z.string().regex(/^[a-f0-9]{64}$/),
  generationSource: z.enum(["openai", "codex"])
}).strict().superRefine((payload, context) => {
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  if (!same(payload.contentContract.delivered, payload.coverage.primary)) {
    context.addIssue({ code: "custom", path: ["contentContract", "delivered"], message: "content contract must match the generated coverage" });
  }
  if (!same(payload.contentContract.discovered, payload.coverage.secondary)) {
    context.addIssue({ code: "custom", path: ["contentContract", "discovered"], message: "content contract must match the generated coverage" });
  }
  if (!same(payload.contentContract.reserved, payload.coverage.reserved)) {
    context.addIssue({ code: "custom", path: ["contentContract", "reserved"], message: "content contract must match the generated coverage" });
  }
  if (payload.contentContract.offerEligibility.eligible !== (payload.contentContract.offerEligibility.perspectives.length === 2)) {
    context.addIssue({ code: "custom", path: ["contentContract", "offerEligibility"], message: "eligible offers require exactly two assessed perspectives" });
  }
});

const paidCompositionV3PerspectiveSchema = z.object({
  heading: z.string().trim().min(2).max(80),
  perspectiveLabel: z.string().trim().min(2).max(100),
  paragraphs: z.array(z.string().trim().min(20).max(800)).min(1).max(2),
  evidenceQuotes: z.array(z.string().trim().min(2).max(240)).min(1).max(6)
}).strict();

export const paidCompositionV3ContentSchema = z.object({
  title: z.string().trim().min(3).max(100),
  bridge: z.string().trim().min(30).max(800),
  newPerspectives: z.array(paidCompositionV3PerspectiveSchema).min(2).max(3),
  relationshipSynthesis: z.array(z.string().trim().min(20).max(800)).min(1).max(2),
  alternativeReading: z.object({
    paragraph: z.string().trim().min(20).max(800),
    evidenceQuotes: z.array(z.string().trim().min(2).max(240)).min(1).max(6)
  }).strict().optional(),
  finalIntegration: z.string().trim().min(15).max(240)
}).strict();

export const paidCompositionV3DraftSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("complete"), composition: paidCompositionV3ContentSchema }).strict(),
  z.object({
    kind: z.literal("insufficient_grounded_material"),
    reasonCode: z.literal("INSUFFICIENT_GROUNDED_MATERIAL")
  }).strict()
]);

export const paidCompositionV3PayloadSchema = paidCompositionV3ContentSchema.extend({
  paidCompositionVersion: z.literal(3),
  instructionVersion: z.literal(PAID_COMPOSITION_V3_INSTRUCTION_VERSION),
  generationInstructionSha256: z.string().regex(/^[a-f0-9]{64}$/),
  appInstructionsSha256: z.string().regex(/^[a-f0-9]{64}$/),
  generationSource: z.enum(["openai", "codex"])
}).strict();

export const paidCompositionV3ReviewSchema = z.object({
  approved: z.boolean(),
  findings: z.array(z.object({
    kind: z.enum(["free_paraphrase", "not_new_perspective", "split_free_action", "promise_mismatch", "invented_fact"]),
    target: z.enum(["bridge", "newPerspective:0", "newPerspective:1", "newPerspective:2", "relationshipSynthesis", "alternativeReading", "finalIntegration"]),
    quote: z.string().max(700).nullable(),
    explanation: z.string().min(8).max(600),
    requiredChange: z.string().min(8).max(600)
  })).max(8)
}).strict();

export const detailedAssistantSchema = z.object({
  ...assistantCore,
  directAnswerTitle:z.string().min(6).max(70),
  referenceIds: z.array(z.string().min(2).max(80)).max(8),
  evidenceQuotes: z.array(z.string().min(2).max(240)).min(1).max(12),
  sections: z.array(z.object({
    title: z.string().min(2).max(50),
    paragraphs: z.array(z.string().min(20).max(PAID_READING_LIMITS.paragraphCharacters)).min(1).max(PAID_READING_LIMITS.sectionParagraphs)
  })).length(PAID_READING_SECTIONS.length)
});

export const consultationPlanSchema = z.object({
  facts: z.array(z.string().min(2).max(240)).min(1).max(12),
  keyElements: z.array(z.object({label:z.string().min(1).max(40), evidence:z.string().min(1).max(100)})).min(1).max(8),
  supportedTopics: z.array(z.object({topic:z.enum(["role", "emotion", "place", "reality"]), evidence:z.string().min(1).max(120)})).max(4),
  sequenceConfirmed: z.boolean(),
  unresolved: z.array(z.string().min(2).max(120)).max(4),
  ready: z.boolean(),
  question: z.object({kind:z.enum(["scene", "emotion", "relationship", "dreamer"]), prompt:z.string().min(5).max(120), options:z.array(z.string().min(1).max(60)).max(5), reason:z.string().min(5).max(140), placeholder:z.string().max(100)}).nullable()
});

export const reportReviewSchema = z.object({
  approved: z.boolean(),
  semanticQuality: z.enum(["pass", "minor", "major"]),
  semanticConfidence: z.enum(["low", "adequate", "high"]),
  semanticReasonCodes: z.array(z.enum([
    "repeats_free",
    "fewer_than_two_new_perspectives",
    "perspectives_not_distinct",
    "missing_narrative_synthesis",
    "report_like_repetition",
    "invented_advice_or_situation"
  ])).max(6),
  inventedFacts: z.array(z.string()).max(8),
  missingElements: z.array(z.string()).max(8),
  redundantInterpretation: z.boolean(),
  unsupportedSequenceOrRole: z.boolean(),
  usesOmissionAsFact: z.boolean(),
  addsValueBeyondFree: z.boolean(),
  correctionApplied: z.boolean(),
  headlineAnswered: z.boolean(),
  offerCoverage: z.array(z.object({
    key: z.enum(["traditional", "pattern", "psychology", "action"]),
    fulfilled: z.boolean()
  })).max(PAID_READING_SECTIONS.length),
  revisionTargets: z.array(z.enum([
    "directAnswer", "directAnswerTitle", "section:0", "section:1", "section:2", "section:3",
    "interpretationChanges", "suggestedQuestions", "evidenceQuotes", "referenceIds"
  ])).max(8),
  feedback: z.string().max(600)
});

export const paidFormatRevisionSchema = z.object({
  replacement: z.string().min(20).max(PAID_READING_LIMITS.paragraphCharacters * PAID_READING_LIMITS.sectionParagraphs + 6)
});

export const followupAssistantSchema = z.object({
  ...assistantCore,
  sections: z.array(answerSectionSchema).max(3)
});

export const contextUpdateSchema = z.object({
  context: aiContextSchema.omit({ questions: true }),
  answer: followupAssistantSchema
});

// Compatibility exports for code that imported the first MVP schemas.
export const aiStructureSchema = aiContextSchema;
