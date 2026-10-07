import "server-only";

import { decryptDream, encryptJson } from "./crypto";
import {
  analyzeDreamContextLocally,
  applyClarificationsToContext,
  buildFreeAssistantPayload
} from "./local-engine";
import { classifySafetyRoute, safetyNoticeForRoute } from "./safety";
import type {
  AssistantTurnPayload,
  ClarificationAnswer,
  ClarificationQuestion,
  ConversationTurn,
  DreamStructure,
  Emotion,
  FollowUp,
  FreeReading,
  PaidReport,
  ReadingEntitlement,
  ReadingRecord,
  SafetyNotice,
  UserTurnPayload
} from "./types";

type LegacyReadingRecord = {
  id: string;
  status: ReadingRecord["status"];
  sessionHash: string;
  ownerUserId: string | null;
  encryptedDream: ReadingRecord["encryptedDream"];
  structure?: DreamStructure;
  selectedEmotion: Emotion | null;
  questions: ClarificationQuestion[];
  questionCursor: number;
  answers?: ClarificationAnswer[];
  freeResult?: FreeReading | null;
  paidReport?: PaidReport | null;
  followUp?: FollowUp | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  expiresAt: string;
};

export type MigratedLegacyReading = {
  reading: ReadingRecord;
  entitlement: ReadingEntitlement;
  turns: ConversationTurn[];
};

export function isCurrentReadingRecord(value: unknown): value is ReadingRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ReadingRecord>;
  return Boolean(
    record.encryptedContext &&
    record.encryptedClarificationAnswers &&
    record.detailGenerationStatus &&
    record.safetyRoute
  );
}

function legacyTurn(
  readingId: string,
  id: string,
  role: ConversationTurn["role"],
  kind: ConversationTurn["kind"],
  content: UserTurnPayload | AssistantTurnPayload | SafetyNotice,
  createdAt: string
): ConversationTurn {
  return {
    id,
    readingId,
    role,
    kind,
    status: "complete",
    clientMessageId: null,
    encryptedContent: encryptJson(content, "turn", id),
    createdAt
  };
}

function freePayload(result: FreeReading | null | undefined, context: ReturnType<typeof analyzeDreamContextLocally>["context"]) {
  if (!result) return buildFreeAssistantPayload(context, "local");
  return {
    directAnswer: result.headline,
    sections: [
      {
        title: "장면을 나눠보면",
        paragraphs: result.symbols.length
          ? result.symbols.map((symbol) => `${symbol.name}: ${symbol.meaning}`)
          : ["이전 해몽의 장면 기록을 새 상담 형식으로 옮겼어요."]
      },
      { title: "심리적으로 가능한 연결", paragraphs: [result.psychology] },
      {
        title: "꿈만으로 확실히 말할 수 없는 부분",
        paragraphs: [
          result.uncertaintyNote ??
            "꿈만으로 특정 사건, 상대의 속마음이나 미래를 확정할 수는 없어요. 현실 맥락이 더해지면 해석은 달라질 수 있습니다."
        ]
      }
    ],
    interpretationChanges: null,
    uncertainty: result.uncertaintyNote ? [result.uncertaintyNote] : [],
    shareableSentences: [],
    suggestedQuestions: ["현실의 일과 연결해줘", "관계에 대한 꿈인지 봐줘", "상대에게 전할 말을 써줘"],
    generationSource: "local"
  } satisfies AssistantTurnPayload;
}

function detailedPayload(report: PaidReport) {
  return {
    directAnswer: report.lead,
    sections: report.sections.map((section) => ({ title: section.title, paragraphs: section.paragraphs })),
    interpretationChanges: null,
    uncertainty: [report.caution],
    shareableSentences: [],
    suggestedQuestions: ["현실의 일과 연결해줘", "관계에 대한 꿈인지 봐줘", "상대에게 전할 말을 써줘"],
    generationSource: "local"
  } satisfies AssistantTurnPayload;
}

function followupPayload(followup: FollowUp) {
  return {
    directAnswer: followup.answer,
    sections: [],
    interpretationChanges: null,
    uncertainty: ["이전 버전에서 이어진 답변이며, 꿈만으로 현실의 사실이나 상대의 의도를 확정하지 않습니다."],
    shareableSentences: [],
    suggestedQuestions: [],
    generationSource: "local"
  } satisfies AssistantTurnPayload;
}

export function migrateLegacyReading(value: unknown): MigratedLegacyReading | null {
  if (isCurrentReadingRecord(value)) return null;
  if (!value || typeof value !== "object") throw new Error("LEGACY_READING_INVALID");
  const legacy = value as LegacyReadingRecord;
  if (!legacy.id || !legacy.encryptedDream || !legacy.sessionHash || !legacy.createdAt || !legacy.expiresAt) {
    throw new Error("LEGACY_READING_INVALID");
  }

  const dream = decryptDream(legacy.encryptedDream, legacy.id);
  const analyzed = analyzeDreamContextLocally(dream, legacy.selectedEmotion ?? null);
  const answers = Array.isArray(legacy.answers) ? legacy.answers.slice(0, 2) : [];
  const context = applyClarificationsToContext(analyzed.context, answers);
  if (legacy.structure?.recentContext && !context.realityContexts.includes(legacy.structure.recentContext)) {
    context.realityContexts.push(legacy.structure.recentContext);
  }
  const safetyRoute = classifySafetyRoute(dream);
  const purchased = Boolean(legacy.paidAt || legacy.paidReport || legacy.status === "paid_ready" || legacy.status === "paid_generating");
  const detailGenerationStatus: ReadingRecord["detailGenerationStatus"] = legacy.paidReport
    ? "ready"
    : purchased
      ? "failed"
      : "locked";
  const status: ReadingRecord["status"] = legacy.paidReport
    ? "paid_ready"
    : purchased
      ? "paid_generating"
      : legacy.status === "clarifying"
        ? "clarifying"
        : legacy.status === "payment_pending"
          ? "payment_pending"
          : "free_ready";

  const reading: ReadingRecord = {
    id: legacy.id,
    status,
    detailGenerationStatus,
    detailGenerationError: purchased && !legacy.paidReport ? "이전 상세 해몽을 새 형식으로 다시 만들어야 해요." : null,
    sessionHash: legacy.sessionHash,
    ownerUserId: legacy.ownerUserId ?? null,
    encryptedDream: legacy.encryptedDream,
    encryptedContext: encryptJson(context, "context", legacy.id),
    encryptedClarificationAnswers: encryptJson(answers, "clarifications", legacy.id),
    selectedEmotion: legacy.selectedEmotion ?? null,
    questions: Array.isArray(legacy.questions) ? legacy.questions.slice(0, 2) : [],
    questionCursor: Math.min(legacy.questionCursor ?? answers.length, 2),
    safetyRoute,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
    paidAt: legacy.paidAt ?? null,
    expiresAt: legacy.expiresAt
  };

  const entitlement: ReadingEntitlement = {
    readingId: legacy.id,
    fullReadingPurchased: purchased,
    baseQuestionAllowance: purchased ? 2 : 0,
    extraQuestionAllowance: 0,
    usedQuestions: legacy.followUp ? 1 : 0,
    extraPackPurchased: false,
    updatedAt: legacy.updatedAt
  };

  const turns: ConversationTurn[] = [];
  let offset = 0;
  const timestamp = () => new Date(new Date(legacy.createdAt).getTime() + offset++).toISOString();
  turns.push(
    legacyTurn(legacy.id, `turn_legacy_dream_${legacy.id}`, "user", "dream", { text: dream, label: "처음 들려준 꿈" }, timestamp())
  );
  const safetyNotice = safetyNoticeForRoute(safetyRoute);
  if (safetyNotice) {
    turns.push(legacyTurn(legacy.id, `turn_legacy_safety_${legacy.id}`, "kkumgyeol", "safety", safetyNotice, timestamp()));
  }
  for (const [index, answer] of answers.entries()) {
    const question = legacy.questions?.find((candidate) => candidate.id === answer.questionId);
    turns.push(
      legacyTurn(
        legacy.id,
        `turn_legacy_clarification_${legacy.id}_${index + 1}`,
        "user",
        "clarification",
        {
          text: answer.skipped ? "이 질문은 건너뛰었어요." : (answer.answer ?? ""),
          label: question?.prompt ?? "이전에 덧붙인 정보"
        },
        timestamp()
      )
    );
  }
  if (!safetyNotice?.blocksInterpretation && legacy.status !== "clarifying") {
    turns.push(
      legacyTurn(legacy.id, `turn_legacy_free_${legacy.id}`, "kkumgyeol", "free", freePayload(legacy.freeResult, context), timestamp())
    );
  }
  if (legacy.paidReport) {
    turns.push(
      legacyTurn(legacy.id, `turn_legacy_detailed_${legacy.id}`, "kkumgyeol", "detailed", detailedPayload(legacy.paidReport), timestamp())
    );
  }
  if (legacy.followUp) {
    const followupAt = legacy.followUp.createdAt || timestamp();
    turns.push(
      legacyTurn(legacy.id, `turn_legacy_followup_user_${legacy.id}`, "user", "followup", { text: legacy.followUp.question }, followupAt),
      legacyTurn(legacy.id, `turn_legacy_followup_answer_${legacy.id}`, "kkumgyeol", "followup", followupPayload(legacy.followUp), new Date(new Date(followupAt).getTime() + 1).toISOString())
    );
  }

  return { reading, entitlement, turns };
}
