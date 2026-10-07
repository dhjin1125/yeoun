import { z } from "zod";
import { INTERPRETATION_FOCUS_VALUES } from "./interpretation-focus";
import { ANALYTICS_EVENTS, EMOTIONS, PURCHASE_PROMISE_VERSION } from "./types";
import { DREAM_ENTRY_SOURCES } from "./dream-entry";
import { getDreamTopic } from "./seo-topics";

const entryTopicSchema = z.string().max(40).refine(slug => Boolean(getDreamTopic(slug)));

export const createReadingSchema = z.object({
  dream: z.string().trim().min(1, "기억나는 장면이나 느낌을 적어주세요.").max(2_000, "꿈 내용은 2,000자까지 적을 수 있어요."),
  emotion: z.enum(EMOTIONS).nullable().optional(),
  focus: z.enum(INTERPRETATION_FOCUS_VALUES).nullable().optional(),
  source: z.enum(DREAM_ENTRY_SOURCES).optional(),
  topic: entryTopicSchema.optional()
});

export const clarificationSchema = z
  .object({
    questionId: z.string().min(1).max(80),
    answer: z.string().trim().max(240).nullable().optional(),
    skipped: z.boolean().default(false),
    restoreToken: z.string().max(800).optional()
  })
  .superRefine((value, context) => {
    if (!value.skipped && (!value.answer || value.answer.length < 1)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "답을 선택하거나 건너뛰어 주세요.", path: ["answer"] });
    }
  });

export const orderSchema = z.object({
  readingId: z.string().min(8).max(80),
  product: z.enum(["full_reading", "followup_pack_2"]),
  contentConsent: z.literal(true),
  promiseVersion: z.literal(PURCHASE_PROMISE_VERSION).optional(),
  promiseSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  restoreToken: z.string().max(800).optional()
}).superRefine((value, context) => {
  if (Boolean(value.promiseVersion) !== Boolean(value.promiseSha256)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "구매 약속 식별값을 함께 보내야 해요.", path: ["promiseSha256"] });
  }
  if (value.product === "followup_pack_2" && (value.promiseVersion || value.promiseSha256)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "추가 질문 주문에는 해몽 약속을 연결할 수 없어요.", path: ["promiseVersion"] });
  }
});

export const freeSupplementSchema = z.object({
  questionId: z.string().max(80).optional(),
  detail: z.string().trim().min(2, "기억나는 내용을 조금만 더 적어주세요.").max(600, "추가 내용은 600자까지 적을 수 있어요."),
  restoreToken: z.string().max(800).optional()
});

export const paymentConfirmationSchema = z.object({
  paymentKey: z.string().min(6).max(200),
  orderId: z.string().min(6).max(64),
  amount: z.number().int().positive()
});

export const followUpSchema = z.object({
  question: z.string().trim().min(2, "질문을 조금만 더 자세히 적어주세요.").max(1_200),
  clientMessageId: z.string().min(8).max(100).optional(),
  restoreToken: z.string().max(800).optional()
});

export const conversationMessageSchema = z.object({
  clientMessageId: z
    .string()
    .trim()
    .min(8, "메시지 식별자가 필요해요.")
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/, "메시지 식별자 형식이 올바르지 않아요."),
  message: z.string().trim().min(2, "질문을 조금만 더 적어주세요.").max(1_200, "질문은 1,200자까지 적을 수 있어요."),
  restoreToken: z.string().max(800).optional()
});

export const retryReadingSchema = z.object({
  restoreToken: z.string().max(800).optional()
});

export const analyticsSchema = z.object({
  event: z.enum(ANALYTICS_EVENTS),
  readingId: z.string().max(80).nullable().optional(),
  context: z
    .object({
      source: z.string().max(40).optional(),
      topic: entryTopicSchema.optional(),
      step: z.string().max(40).optional(),
      paymentMode: z.enum(["mock", "toss"]).optional(),
      product: z.enum(["full_reading", "followup_pack_2"]).optional(),
      offerVariant: z.enum(["contextual_questions_v1"]).optional(),
      riskClass: z.enum(["standard", "sensitive", "blocked"]).optional(),
      cardKey: z.enum(["traditional", "psychology", "pattern", "action", "offer_cta"]).optional(),
      focus: z.enum(INTERPRETATION_FOCUS_VALUES).optional(),
      rating: z.enum(["helpful", "not_helpful"]).optional(),
      reason: z.enum(["misread", "generic", "no_paid_value", "awkward"]).optional(),
      dimension: z.enum(["helpfulness", "question_resolved"]).optional(),
      turnId: z.string().min(1).max(80).optional()
    })
    .optional()
});

export async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new Error("INVALID_JSON");
  }
}
