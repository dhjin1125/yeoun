import "server-only";

import {
  analyzeDreamInput,
  classifyConversationScope,
  generateDetailedAssistant,
  generatePaidCompositionV3,
  generateFollowupAssistant,
  generateFreeAssistant,
  hasDetailedGeneratorConfiguration,
  prepareConsultation,
  PaidGenerationError,
  type AiGenerationProgressReporter,
  type AiGenerationProgressStage
} from "./ai";
import {
  createRestoreToken,
  decryptDream,
  decryptJson,
  encryptDream,
  encryptJson,
  hashToken,
  opaqueToken
} from "./crypto";
import { AppError } from "./http";
import { admitDreamRequest, assertDreamAdmission } from "./input-admission";
import { admitConversation } from "./conversation-admission";
import { scopedConversationMessage } from "./conversation-scope";
import type { InterpretationFocus } from "./interpretation-focus";
import { analyzeDreamContextLocally, applyClarificationsToContext, buildPaidOfferFromContext, freeDetailGuidance } from "./local-engine";
import { splitDreamEvidence } from "./dream-evidence";
import { activeConsultationPlan, buildConsultationOffer, classifyUserMessage, consultationGuidance, forgotDetail, reportCopyError } from "./consultation";
import { paymentMode, purchasesEnabled } from "./payment-config";
import { createPurchasePromiseSnapshot, createPurchasePromiseSnapshotV2, sourceFreePayloadSha256 } from "./purchase-promise";
import { buildContentContractOffer, isContentContractOffer } from "./paid-reading-v3";
import { formatFreeSymbolicAnswer } from "./symbolic-copy";
import type { ProgressReporter } from "./progress";
import { getRepository, type DreamRepository } from "./repository";
import { paidJobStore } from "./paid-jobs/runtime";
import { stagedFreeReadingV3PayloadSchema } from "./ai/schemas";
import type { PaidPipelinePersistence } from "./ai/paid-pipeline";
import { resolvePaidGenerationContract, type ResolvedPaidGenerationContract } from "./paid-generation-contract";
import { classifyDreamClarificationSafety, classifySafetyRoute, safetyNoticeForRoute } from "./safety";
import type {
  AssistantTurnPayload,
  ClarificationAnswer,
  ConversationTurn,
  ConversationTurnKind,
  DreamContext,
  Emotion,
  GenerationUserEvidence,
  PublicConversationTurn,
  PublicReading,
  PaidOfferV1Snapshot,
  PaidOfferV2Snapshot,
  PurchasePromiseSnapshot,
  ReadingEntitlement,
  ReadingRecord,
  SafetyNotice,
  StagedFreeReadingV3Payload,
  PublicFreeReadingV3,
  PaidCompositionV3Payload,
  PreparedPaidPreview,
  StoredConversationTurnPayload,
  UserTurnPayload
} from "./types";

type AiStageProgress = {
  percent: number;
  label: string;
  activityState: "starting" | "connected" | "responding" | "finalizing";
};

function logFreeFlowStage(requestId: string, stage: string, outcome: "started" | "completed" | "failed", startedAt: number, error?: unknown) {
  const errorCode = error instanceof AppError ? error.code : error instanceof Error ? error.name : error ? "UNKNOWN_ERROR" : null;
  try {
    console.info(JSON.stringify({ event: "dream_free_flow_stage", version: 1, requestId, stage, outcome,
      durationMs: outcome === "started" ? null : Date.now() - startedAt, errorCode }));
  } catch { /* Diagnostics are observational and must not change reading behavior. */ }
}

function reportAiStages(
  report: ProgressReporter | undefined,
  prefix: string,
  progressByStage: Record<AiGenerationProgressStage, AiStageProgress>
): AiGenerationProgressReporter {
  const activityStartedAt = new Date().toISOString();
  return (stage) => {
    const progress = progressByStage[stage];
    if (!progress) return;
    report?.({ stage: `${prefix}_${stage}`, ...progress, activityStartedAt });
  };
}

const CONSULTATION_INTAKE_PROGRESS = {
  proposal_repair_started: { percent: 28, label: "응답 형식을 다시 확인하고 있어요", activityState: "responding" },
  fact_check_repair: { percent: 28, label: "입력한 내용과 어긋난 부분을 다시 확인하고 있어요", activityState: "responding" },
  request_prepared: { percent: 10, label: "확인할 꿈의 사실을 AI 요청으로 정리했어요", activityState: "starting" },
  provider_started: { percent: 12, label: "AI 실행을 시작했어요", activityState: "starting" },
  provider_session_started: { percent: 16, label: "AI 작업 세션에 연결했어요", activityState: "connected" },
  model_started: { percent: 20, label: "꿈 내용을 읽고 있어요", activityState: "responding" },
  response_received: { percent: 24, label: "AI의 사실 확인 응답을 받았어요", activityState: "finalizing" },
  provider_completed: { percent: 26, label: "AI 응답 생성을 마쳤어요", activityState: "finalizing" },
  response_validated: { percent: 28, label: "확인할 사실과 질문 후보를 정리했어요", activityState: "finalizing" },
  quality_checked: { percent: 28, label: "확인할 사실과 질문 후보를 정리했어요", activityState: "finalizing" },
  fallback_prepared: { percent: 28, label: "확인할 사실과 질문 후보를 정리했어요", activityState: "finalizing" }
} satisfies Record<AiGenerationProgressStage, AiStageProgress>;

const CONSULTATION_MAINTENANCE_PROGRESS = {
  proposal_repair_started: { percent: 50, label: "응답 형식을 다시 확인하고 있어요", activityState: "responding" },
  fact_check_repair: { percent: 50, label: "덧붙인 내용과 어긋난 부분을 다시 확인하고 있어요", activityState: "responding" },
  request_prepared: { percent: 36, label: "정정된 사실을 AI 요청으로 정리했어요", activityState: "starting" },
  provider_started: { percent: 38, label: "AI 실행을 시작했어요", activityState: "starting" },
  provider_session_started: { percent: 41, label: "AI 작업 세션에 연결했어요", activityState: "connected" },
  model_started: { percent: 44, label: "AI가 바뀐 사실과 풀이 방향을 살피고 있어요", activityState: "responding" },
  response_received: { percent: 46, label: "AI의 사실 확인 응답을 받았어요", activityState: "finalizing" },
  provider_completed: { percent: 48, label: "AI 응답 생성을 마쳤어요", activityState: "finalizing" },
  response_validated: { percent: 50, label: "확인할 사실과 풀이 방향을 정리했어요", activityState: "finalizing" },
  quality_checked: { percent: 50, label: "확인할 사실과 풀이 방향을 정리했어요", activityState: "finalizing" },
  fallback_prepared: { percent: 50, label: "확인할 사실과 풀이 방향을 정리했어요", activityState: "finalizing" }
} satisfies Record<AiGenerationProgressStage, AiStageProgress>;

const FREE_GENERATION_PROGRESS = {
  proposal_repair_started: { percent: 86, label: "응답 형식을 다시 확인하고 있어요", activityState: "responding" },
  fact_check_repair: { percent: 86, label: "입력한 내용과 어긋난 부분을 다시 확인하고 있어요", activityState: "responding" },
  request_prepared: { percent: 56, label: "꿈 맥락과 상징 후보를 AI 요청으로 정리했어요", activityState: "starting" },
  provider_started: { percent: 60, label: "AI 실행을 시작했어요", activityState: "starting" },
  provider_session_started: { percent: 64, label: "AI 작업 세션에 연결했어요", activityState: "connected" },
  model_started: { percent: 68, label: "AI가 꿈의 장면과 상징을 읽기 시작했어요", activityState: "responding" },
  response_received: { percent: 78, label: "AI의 무료 풀이 응답을 받았어요", activityState: "finalizing" },
  provider_completed: { percent: 82, label: "AI 응답 생성을 마쳤어요", activityState: "finalizing" },
  response_validated: { percent: 86, label: "응답 형식과 필수 항목을 확인했어요", activityState: "finalizing" },
  quality_checked: { percent: 88, label: "내용의 안전성과 품질을 확인했어요", activityState: "finalizing" },
  fallback_prepared: { percent: 88, label: "응답을 점검해 안전한 해석 형식으로 정리했어요", activityState: "finalizing" }
} satisfies Record<AiGenerationProgressStage, AiStageProgress>;

const DAY_MS = 24 * 60 * 60 * 1_000;
export const RECOVERY_LIFETIME_MS = 7 * DAY_MS;
export const UNPAID_LIFETIME_MS = RECOVERY_LIFETIME_MS;
export const PAID_LIFETIME_MS = RECOVERY_LIFETIME_MS;
export const MAX_CLARIFICATIONS = 2 as const;

function plusMs(date: Date, duration: number) {
  return new Date(date.getTime() + duration).toISOString();
}

function blankEntitlement(readingId: string, now = new Date().toISOString()): ReadingEntitlement {
  return {
    readingId,
    fullReadingPurchased: false,
    baseQuestionAllowance: 0,
    extraQuestionAllowance: 0,
    usedQuestions: 0,
    extraPackPurchased: false,
    updatedAt: now
  };
}

function turnId(prefix: string) {
  return `turn_${prefix}_${opaqueToken(10)}`;
}

function makeTurn(
  readingId: string,
  role: ConversationTurn["role"],
  kind: ConversationTurnKind,
  content: StoredConversationTurnPayload,
  input?: { id?: string; clientMessageId?: string | null; status?: ConversationTurn["status"]; createdAt?: string }
): ConversationTurn {
  const id = input?.id ?? turnId(kind);
  return {
    id,
    readingId,
    role,
    kind,
    status: input?.status ?? "complete",
    clientMessageId: input?.clientMessageId ?? null,
    encryptedContent: encryptJson(content, "turn", id),
    createdAt: input?.createdAt ?? new Date().toISOString()
  };
}

/** Explicit storage seam for V3 experiments; it does not route V3 into product generation. */
export async function storeStagedFreeReadingV3(
  readingId: string,
  payload: StagedFreeReadingV3Payload,
  repository: DreamRepository = getRepository(),
  createdAt?: string
) {
  const validatedPayload = stagedFreeReadingV3PayloadSchema.parse(payload);
  const turn = makeTurn(readingId, "kkumgyeol", "free", validatedPayload, { createdAt });
  await repository.saveConversationTurn(turn);
  return turn;
}

function decodeAssistantTurns(turns: ConversationTurn[]) {
  return turns
    .filter(
      (turn) =>
        turn.role === "kkumgyeol" &&
        turn.status === "complete" &&
        ["free", "detailed", "followup"].includes(turn.kind)
    )
    .flatMap((turn) => {
      try { return [decryptJson<AssistantTurnPayload>(turn.encryptedContent, "turn", turn.id)]; }
      catch { return []; }
    });
}

async function resolveReadingPaidContract(
  readingId: string,
  orderId: string | undefined,
  repository: DreamRepository
): Promise<ResolvedPaidGenerationContract> {
  if (!orderId) return { kind: "legacy-v2" };
  const order = await repository.getOrder(orderId);
  if (!order) throw new Error("PAID_ORDER_NOT_FOUND");
  if (!order.purchasePromiseSnapshot) return resolvePaidGenerationContract({ readingId, orderId, order });
  const turns = await repository.getConversationTurns(readingId);
  const sourceTurn = turns.find(turn => turn.id === order.purchasePromiseSnapshot!.sourceFreeTurnId) ?? null;
  let sourcePayload: unknown;
  try {
    sourcePayload = sourceTurn ? decryptJson<unknown>(sourceTurn.encryptedContent, "turn", sourceTurn.id) : undefined;
  } catch {
    throw new Error("SOURCE_FREE_PAYLOAD_INVALID");
  }
  return resolvePaidGenerationContract({ readingId, orderId, order, sourceTurn, sourcePayload });
}

function priorFreeForContract(
  contract: ResolvedPaidGenerationContract,
  turns: ConversationTurn[]
): AssistantTurnPayload | StagedFreeReadingV3Payload | undefined {
  if (contract.kind === "legacy-v2") return decodeAssistantTurns(turns.filter(turn => turn.kind === "free")).at(-1);
  return contract.sourceFreePayload;
}

/** Internal staged dispatcher: this path has no repository or durable-job dependency and cannot publish. */
export async function generateStagedPaidV3(
  reading: ReadingRecord,
  contract: Extract<ResolvedPaidGenerationContract, { kind: "staged-v3" }>,
  generate = generatePaidCompositionV3
) {
  return generate({
    context: readingContext(reading),
    originalDream: decryptDream(reading.encryptedDream, reading.id),
    userEvidence: generationUserEvidence(reading),
    sourceFreePayload: contract.sourceFreePayload,
    purchasePromise: contract.snapshot.offer,
    sessionHash: reading.sessionHash
  });
}

function publicTurn(turn: ConversationTurn): PublicConversationTurn | null {
  if (turn.status !== "complete") return null;
  const content = decryptJson<unknown>(turn.encryptedContent, "turn", turn.id);
  if (turn.kind === "free" && isStagedFreeV3Content(content)) {
    const visible: PublicFreeReadingV3 = {
      freeCompositionVersion: 3,
      title: content.title,
      primarySection: structuredClone(content.primarySection),
      secondarySection: structuredClone(content.secondarySection)
    };
    return { id: turn.id, role: turn.role, kind: turn.kind, createdAt: turn.createdAt, content: visible };
  }
  if (turn.kind === "detailed" && isPaidCompositionV3Content(content)) {
    const visible = {
      paidCompositionVersion: 3 as const,
      title: content.title,
      bridge: content.bridge,
      newPerspectives: content.newPerspectives.map(({ heading, perspectiveLabel, paragraphs }) => ({ heading, perspectiveLabel, paragraphs: [...paragraphs] })),
      relationshipSynthesis: [...content.relationshipSynthesis],
      ...(content.alternativeReading ? { alternativeReading: { paragraph: content.alternativeReading.paragraph } } : {}),
      finalIntegration: content.finalIntegration
    };
    return { id: turn.id, role: turn.role, kind: turn.kind, createdAt: turn.createdAt, content: visible };
  }
  return {
    id: turn.id,
    role: turn.role,
    kind: turn.kind,
    createdAt: turn.createdAt,
    content: turn.kind === "free" && isAssistantPayloadV2(content) ? formatFreeSymbolicAnswer(content) : content as PublicConversationTurn["content"]
  };
}

function isAssistantPayloadV2(value: unknown): value is AssistantTurnPayload {
  return Boolean(value && typeof value === "object" && "directAnswer" in value && "sections" in value);
}

function isPaidCompositionV3Content(value: unknown): value is PaidCompositionV3Payload {
  return Boolean(value && typeof value === "object" && "paidCompositionVersion" in value &&
    (value as { paidCompositionVersion?: unknown }).paidCompositionVersion === 3 &&
    "newPerspectives" in value && "generationInstructionSha256" in value);
}

function isStagedFreeV3Content(value: unknown): value is StagedFreeReadingV3Payload {
  return stagedFreeReadingV3PayloadSchema.safeParse(value).success;
}

function meaningfulFreeTurn(turn: ConversationTurn) {
  if (turn.kind !== "free" || turn.role !== "kkumgyeol" || turn.status !== "complete") return null;
  try {
    const payload = decryptJson<unknown>(turn.encryptedContent, "turn", turn.id);
    if (payload && typeof payload === "object" && "directAnswer" in payload &&
      typeof (payload as { directAnswer?: unknown }).directAnswer === "string" &&
      (payload as { directAnswer: string }).directAnswer.trim()) return { turn, payload };
    if (isStagedFreeV3Content(payload) && payload.primarySection.paragraphs.some(paragraph => paragraph.trim())) return { turn, payload };
  } catch {
    return null;
  }
  return null;
}

/** Builds the same persisted-state offer used by the public reading and order service. */
export function purchasePromiseForReading(
  reading: ReadingRecord,
  turns: ConversationTurn[],
  captureMode: PurchasePromiseSnapshot["captureMode"] = "confirmed"
): PurchasePromiseSnapshot | null {
  const source = [...turns].reverse().map(meaningfulFreeTurn).find(Boolean);
  if (!source) return null;
  const rawVersion = source.payload && typeof source.payload === "object"
    ? (source.payload as { freeCompositionVersion?: unknown }).freeCompositionVersion
    : undefined;
  const freeCompositionVersion = rawVersion === 2 || rawVersion === 3 ? rawVersion : null;
  if (freeCompositionVersion === 3 && isStagedFreeV3Content(source.payload)) {
    const offer = buildContentContractOffer(source.payload, decryptDream(reading.encryptedDream, reading.id),
      clarificationAnswers(reading).filter(answer => !answer.skipped && answer.answer?.trim()).map(answer => answer.answer!.trim()));
    if (!offer || !isContentContractOffer(offer)) return null;
    return createPurchasePromiseSnapshotV2({
      sourceReadingId: reading.id,
      sourceFreeTurnId: source.turn.id,
      sourceFreePayloadSha256: sourceFreePayloadSha256(source.payload),
      offer,
      captureMode,
      capturedAt: source.turn.createdAt
    });
  }
  const storedContext = readingContext(reading);
  const offerContext = groundedContextForReading(reading, storedContext);
  const offer = buildConsultationOffer(offerContext, activeConsultationPlan(offerContext, clarificationAnswers(reading)));
  return createPurchasePromiseSnapshot({
    sourceReadingId: reading.id,
    sourceFreeTurnId: source.turn.id,
    sourceFreeCompositionVersion: freeCompositionVersion,
    sourceFreePayloadSha256: sourceFreePayloadSha256(source.payload),
    offer,
    captureMode
  });
}

function hasRejectedStoredReport(readingId: string, turns: ConversationTurn[]) {
  const current = turns.find(turn => turn.id === `turn_detailed_${readingId}` && turn.kind === "detailed" && turn.status === "complete");
  if (!current) return false;
  try {
    const payload = decryptJson<unknown>(current.encryptedContent, "turn", current.id);
    if (payload && typeof payload === "object" && "paidCompositionVersion" in payload && (payload as { paidCompositionVersion?: unknown }).paidCompositionVersion === 3) return false;
    if (!isAssistantPayloadV2(payload)) return true;
    return payload.generationSource === "local_fallback" || Boolean(reportCopyError(payload));
  } catch { return true; }
}

function remainingQuestions(entitlement: ReadingEntitlement) {
  return Math.max(
    0,
    entitlement.baseQuestionAllowance + entitlement.extraQuestionAllowance - entitlement.usedQuestions
  );
}

export function readingContext(reading: ReadingRecord) {
  return decryptJson<DreamContext>(reading.encryptedContext, "context", reading.id);
}

function clarificationAnswers(reading: ReadingRecord) {
  return decryptJson<ClarificationAnswer[]>(
    reading.encryptedClarificationAnswers,
    "clarifications",
    reading.id
  );
}

function generationUserEvidence(reading: ReadingRecord): GenerationUserEvidence {
  return {
    selectedEmotion: reading.selectedEmotion,
    clarificationAnswers: clarificationAnswers(reading)
  };
}

function groundedContextForReading(reading: ReadingRecord, storedContext = readingContext(reading)) {
  const context = analyzeDreamContextLocally(
    decryptDream(reading.encryptedDream, reading.id), reading.selectedEmotion, storedContext.selectedFocus
  ).context;
  const enriched = applyClarificationsToContext(context, clarificationAnswers(reading));
  enriched.consultation = storedContext.consultation;
  return enriched;
}

export function readingDetailGuidance(reading: ReadingRecord) {
  const enriched = groundedContextForReading(reading);
  return consultationGuidance(enriched, clarificationAnswers(reading));
}

async function saveSafetyTurn(
  reading: ReadingRecord,
  route: ReadingRecord["safetyRoute"],
  repository: DreamRepository,
  createdAt?: string
) {
  const notice = safetyNoticeForRoute(route);
  if (!notice) return;
  const id = `turn_safety_${reading.id}_${route}`;
  await repository.saveConversationTurn(
    makeTurn(reading.id, "kkumgyeol", "safety", notice, { id, createdAt })
  );
}

async function finishFreeReading(reading: ReadingRecord, repository: DreamRepository, reportProgress?: ProgressReporter) {
  const context = readingContext(reading);
  assertDreamAdmission(context.consultation, true);
  const dream = decryptDream(reading.encryptedDream, reading.id);
  const evidence = generationUserEvidence(reading);
  const generationStartedAt = Date.now();
  logFreeFlowStage(reading.id, "free_generation_pipeline", "started", generationStartedAt);
  let payload: AssistantTurnPayload | StagedFreeReadingV3Payload;
  try {
    payload = await generateFreeAssistant(context, reading.sessionHash, dream, evidence,
      reportAiStages(reportProgress, "ai", FREE_GENERATION_PROGRESS));
    logFreeFlowStage(reading.id, "free_generation_pipeline", "completed", generationStartedAt);
  } catch (error) {
    logFreeFlowStage(reading.id, "free_generation_pipeline", "failed", generationStartedAt, error);
    throw error;
  }
  const persistenceStartedAt = Date.now();
  logFreeFlowStage(reading.id, "free_turn_persistence", "started", persistenceStartedAt);
  try {
    await repository.saveConversationTurn(makeTurn(reading.id, "kkumgyeol", "free", payload));
    reading.status = "free_ready";
    reading.updatedAt = new Date().toISOString();
    await repository.saveReading(reading);
    logFreeFlowStage(reading.id, "free_turn_persistence", "completed", persistenceStartedAt);
  } catch (error) {
    logFreeFlowStage(reading.id, "free_turn_persistence", "failed", persistenceStartedAt, error);
    throw error;
  }
}

export async function getPublicReading(
  reading: ReadingRecord,
  origin: string,
  repository: DreamRepository = getRepository()
): Promise<PublicReading> {
  const [turns, storedEntitlement] = await Promise.all([
    repository.getConversationTurns(reading.id),
    repository.getEntitlement(reading.id)
  ]);
  const entitlement = storedEntitlement ?? blankEntitlement(reading.id, reading.updatedAt);
  const rejectedReport = entitlement.fullReadingPurchased && hasRejectedStoredReport(reading.id, turns);
  const canonicalReport = turns.find(turn => turn.id === `turn_detailed_${reading.id}` && turn.kind === "detailed" && turn.status === "complete");
  const paidJob = entitlement.fullReadingPurchased ? paidJobStore(repository)?.deliveryStatus(reading.id) : null;
  const currentInputMismatch = paidJob?.current_input === false;
  const canonicalReady = Boolean(canonicalReport && !rejectedReport && !currentInputMismatch &&
    (reading.detailGenerationStatus === "ready" || paidJob?.status === "completed"));
  const detailStatus = rejectedReport || currentInputMismatch ? "failed" : canonicalReady ? "ready" : reading.detailGenerationStatus;
  const answers = clarificationAnswers(reading);
  const currentQuestion =
    reading.status === "clarifying" ? (reading.questions[reading.questionCursor] ?? null) : null;
  const timeline = turns
    .filter((turn) => {
      if (entitlement.fullReadingPurchased) return turn.kind !== "detailed" || detailStatus === "ready";
      return !["detailed", "followup"].includes(turn.kind);
    })
    .map(turn => {
      try { return publicTurn(turn); }
      catch { return null; }
    })
    .filter((turn): turn is PublicConversationTurn => Boolean(turn));
  const context = readingContext(reading);
  const notice = safetyNoticeForRoute(reading.safetyRoute);
  const remaining = remainingQuestions(entitlement);
  const canPurchaseExtraPack =
    entitlement.fullReadingPurchased && remaining === 0 && !entitlement.extraPackPurchased;
  const token = createRestoreToken(reading.id, reading.expiresAt);
  const checkoutEnabled = purchasesEnabled() && hasDetailedGeneratorConfiguration();
  const configuredPaymentMode = paymentMode();
  const detailGuidance = readingDetailGuidance(reading);
  const hasFreeMeaning = timeline.some(turn =>
    turn.kind === "free" && (
      ("directAnswer" in turn.content && Boolean(turn.content.directAnswer.trim())) ||
      ("freeCompositionVersion" in turn.content && turn.content.freeCompositionVersion === 3)
    )
  );
  const latestFreeSource = [...turns].reverse().map(meaningfulFreeTurn).find(Boolean);
  const latestFreeIsV3 = Boolean(latestFreeSource && isStagedFreeV3Content(latestFreeSource.payload));
  const promiseSnapshot = entitlement.fullReadingPurchased || notice?.blocksInterpretation || !hasFreeMeaning ||
    (!detailGuidance.ready && !latestFreeIsV3)
    ? null
    : purchasePromiseForReading(reading, turns, "confirmed");
  const paidOffer = promiseSnapshot
    ? promiseSnapshot.promiseVersion === "paid-offer-v2"
      ? {
          variant: "editorial_depth_v2" as const,
          headline: promiseSnapshot.offer.headline ?? "꿈에 남은 흐름을 더 깊게 읽기",
          bridge: promiseSnapshot.offer.bridge ?? "무료 핵심을 바탕으로 아직 풀지 않은 장면을 연결합니다.",
          checkoutTitle: "장면 관계를 잇는 상세 해몽",
          checkoutSummary: promiseSnapshot.offer.cards?.map(card => card.title).join(" · ") ?? "남은 장면의 관계와 꿈 전체 흐름",
          cta: "상세 해몽 보기",
          trustLines: [],
          riskClass: "standard" as const,
          cards: promiseSnapshot.offer.cards ?? [],
          promiseVersion: promiseSnapshot.promiseVersion,
          promiseSha256: promiseSnapshot.promiseSha256
        }
      : {
          ...promiseSnapshot.offer,
          promiseVersion: promiseSnapshot.promiseVersion,
          promiseSha256: promiseSnapshot.promiseSha256
        }
    : null;
  const eligibleV3Offer = Boolean(
    promiseSnapshot?.promiseVersion === "paid-offer-v2" && isContentContractOffer(promiseSnapshot.offer)
  );

  return {
    id: reading.id,
    recordRevision: reading.updatedAt,
    status: rejectedReport || currentInputMismatch ? "paid_generating" : canonicalReady ? "paid_ready" : reading.status,
    detailGenerationStatus: detailStatus,
    paidRecovery: paidJob ? {
      status: paidJob.status === "pending" ? "queued" : paidJob.status, reference: paidJob.id.startsWith("delivery_") ? hashToken(reading.id).slice(0,8) : paidJob.id.slice(0, 8),
      message: paidJob.status === "attention" ? "자동 복구를 마치지 못해 확인할 수 있도록 기록했어요. 결제와 남은 질문은 그대로예요."
        : paidJob.status === "retry" ? "작성한 내용을 보관했어요. 잠시 후 멈춘 단계부터 자동으로 이어갈게요."
        : "내용을 확인하며 풀이를 완성하고 있어요. 화면을 닫아도 작업은 계속됩니다."
    } : undefined,
    currentQuestion,
    answeredQuestionCount: answers.length,
    maxQuestionCount: MAX_CLARIFICATIONS,
    timeline,
    paidOffer,
    freeDetailGuidance: notice?.blocksInterpretation ? null : detailGuidance,
    paidPreviews: paidOffer?.cards ?? [],
    safetyNotice: notice,
    entitlement: {
      fullReadingPurchased: entitlement.fullReadingPurchased,
      remainingQuestions: remaining,
      usedQuestions: entitlement.usedQuestions,
      maximumQuestions: 4,
      extraPackPurchased: entitlement.extraPackPurchased,
      canPurchaseExtraPack
    },
    canPurchaseFullReading:
      checkoutEnabled &&
      !entitlement.fullReadingPurchased &&
      !notice?.blocksInterpretation &&
      (latestFreeIsV3 ? eligibleV3Offer : detailGuidance.ready) &&
      (reading.status === "free_ready" || reading.status === "payment_pending"),
    checkoutMode: checkoutEnabled ? (configuredPaymentMode === "mock" ? "mock" : "live") : "unavailable",
    canRetryDetailedReading:
      entitlement.fullReadingPurchased && detailStatus === "failed" && detailGuidance.ready,
    restoreUrl: `${origin}/reading/${encodeURIComponent(reading.id)}?token=${encodeURIComponent(token)}`,
    expiresAt: reading.expiresAt,
    canCorrectReading: entitlement.fullReadingPurchased && !notice?.blocksInterpretation,
    recoveryNotice: `이 기록은 ${new Date(reading.expiresAt).toLocaleDateString("ko-KR")}까지 열 수 있어요. 보관 기간이 끝나면 복구 링크와 구매한 풀이에도 접근할 수 없어요.`
  };
}

export const toPublicReading = getPublicReading;

export async function createReading(
  input: { dream: string; emotion: Emotion | null; focus?: InterpretationFocus | null },
  sessionHash: string,
  repository: DreamRepository = getRepository(),
  reportProgress?: ProgressReporter,
  additionalAnswers: ClarificationAnswer[] = []
) {
  const now = new Date();
  const id = `dream_${opaqueToken(12)}`;
  await admitDreamRequest(sessionHash, repository);
  const analysisStartedAt = Date.now();
  logFreeFlowStage(id, "analysis", "started", analysisStartedAt);
  let analysis: Awaited<ReturnType<typeof analyzeDreamInput>>;
  try {
    analysis = await analyzeDreamInput(input.dream, input.emotion, sessionHash, input.focus ?? null);
    logFreeFlowStage(id, "analysis", "completed", analysisStartedAt);
  } catch (error) {
    logFreeFlowStage(id, "analysis", "failed", analysisStartedAt, error);
    throw error;
  }
  analysis.safetyRoute=classifyDreamClarificationSafety(input.dream);
  analysis.context = applyClarificationsToContext(analysis.context, additionalAnswers);
  if (analysis.context.dreamEvidence === undefined) analysis.context.dreamEvidence = splitDreamEvidence(input.dream).dreamText;
  for (const answer of additionalAnswers) {
    const route = classifyDreamClarificationSafety(answer.answer ?? "",answer.kind);
    if (route === "immediate_self" || (route === "third_party" && analysis.safetyRoute === "none")) analysis.safetyRoute = route;
  }
  if (analysis.safetyRoute !== "immediate_self") {
    const consultationStartedAt = Date.now();
    logFreeFlowStage(id, "fact_check_and_consultation", "started", consultationStartedAt);
    try {
      analysis.context.consultation = await prepareConsultation(analysis.context,input.dream,{selectedEmotion:input.emotion,clarificationAnswers:additionalAnswers},sessionHash,reportAiStages(reportProgress,"consultation",CONSULTATION_INTAKE_PROGRESS));
      assertDreamAdmission(analysis.context.consultation, additionalAnswers.some(answer => answer.questionId.startsWith("admission-")));
      logFreeFlowStage(id, "fact_check_and_consultation", "completed", consultationStartedAt);
    } catch (error) {
      logFreeFlowStage(id, "fact_check_and_consultation", "failed", consultationStartedAt, error);
      throw error;
    }
  }
  reportProgress?.({
    stage: "dream_analyzed",
    percent: 30,
    label: "장면·인물·감정 구조를 확인했어요"
  });
  const record: ReadingRecord = {
    id,
    status: "intake",
    detailGenerationStatus: "locked",
    detailGenerationError: null,
    sessionHash,
    ownerUserId: null,
    encryptedDream: encryptDream(input.dream, id),
    encryptedContext: encryptJson(analysis.context, "context", id),
    encryptedClarificationAnswers: encryptJson(additionalAnswers, "clarifications", id),
    selectedEmotion: input.emotion,
    questions: [],
    questionCursor: 0,
    safetyRoute: analysis.safetyRoute,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    paidAt: null,
    expiresAt: plusMs(now, RECOVERY_LIFETIME_MS)
  };

  await repository.saveReading(record);
  await repository.saveEntitlement(blankEntitlement(id, now.toISOString()));
  await repository.saveConversationTurn(
    makeTurn(id, "user", "dream", { text: input.dream, label: "처음 들려준 꿈" }, { createdAt: now.toISOString() })
  );
  for (const answer of additionalAnswers.filter((item) => item.answer)) {
    await repository.saveConversationTurn(makeTurn(id, "user", "clarification", {
      text: answer.answer!, label: answer.skipped ? "기억 여부 확인" : answer.kind === "scene" ? "확인한 꿈의 사실" : "추가로 알려준 내용", intent:classifyUserMessage(answer.answer!)
    }));
  }
  reportProgress?.({
    stage: "reading_saved",
    percent: 52,
    label: "꿈과 해석 맥락을 암호화해 저장했어요"
  });

  if (analysis.safetyRoute === "immediate_self") {
    await saveSafetyTurn(record, analysis.safetyRoute, repository, new Date(now.getTime() + 1).toISOString());
    record.status = "free_ready";
    record.updatedAt = new Date().toISOString();
    await repository.saveReading(record);
    reportProgress?.({
      stage: "safety_guidance_ready",
      percent: 92,
      label: "지금 필요한 안전 안내를 준비했어요"
    });
    return record;
  }

  if (analysis.safetyRoute === "third_party") {
    await saveSafetyTurn(record, analysis.safetyRoute, repository, new Date(now.getTime() + 1).toISOString());
  }

  if (analysis.context.consultation?.disposition === "NEEDS_CONTEXT" && analysis.context.consultation.question) {
    record.status = "clarifying";
    record.questions = [analysis.context.consultation.question];
    await repository.saveReading(record);
    reportProgress?.({ stage: "clarification_ready", percent: 92, label: "한 장면만 더 알려주세요" });
    return record;
  }

  await finishFreeReading(record, repository, reportProgress);
  reportProgress?.({ stage: "free_reading_ready", percent: 92, label: "무료 풀이가 준비됐어요" });
  return record;
}

export async function supplementFreeReading(
  reading: ReadingRecord, detail: string, repository: DreamRepository = getRepository(), report?: ProgressReporter, questionId?: string
) {
  const entitlement = await repository.getEntitlement(reading.id);
  if (entitlement?.fullReadingPurchased || reading.status !== "free_ready") {
    throw new AppError("FREE_SUPPLEMENT_UNAVAILABLE", "결제 전 무료 해석에서 내용을 더할 수 있어요.", 409);
  }
  const previous = clarificationAnswers(reading);
  const guidance = readingDetailGuidance(reading);
  if (questionId && questionId !== guidance.questionId) throw new AppError("QUESTION_MISMATCH", "현재 확인 질문을 다시 열어주세요.",409);
  if (classifyUserMessage(detail) === "reaction") throw new AppError("NO_NEW_DREAM_INFO", "반응은 잘 받았어요. 새로 기억난 사실이나 정정할 내용이 있을 때 추가해 주세요.",422);
  if (detail.trim().length < 2 || detail.trim().length > 600) throw new AppError("INVALID_DETAIL", "기억나는 내용을 600자 안으로 적어주세요.");
  if (previous.reduce((sum, answer) => sum + (answer.answer?.length ?? 0), 0) + detail.trim().length > 2_000) {
    throw new AppError("DETAIL_LIMIT", "추가 내용은 모두 합쳐 2,000자까지 적을 수 있어요.");
  }
  const updated = await createReading({
    dream: decryptDream(reading.encryptedDream, reading.id),
    emotion: reading.selectedEmotion,
    focus: readingContext(reading).selectedFocus
  }, reading.sessionHash, repository, report, [...previous, {
    questionId: questionId ?? `detail-${opaqueToken(8)}`,
    kind: questionId ? guidance.kind : splitDreamEvidence(detail.trim()).dreamText ? "scene" : "recent_context",
    answer: detail.trim(), skipped: forgotDetail(detail)
  }]);
  // Each revision has its own encrypted record, so a failed request or another
  // tab purchasing the previous reading cannot overwrite its interpretation.
  if (reading.ownerUserId) {
    updated.ownerUserId = reading.ownerUserId;
    await repository.saveReading(updated);
  }
  return updated;
}

export async function answerClarification(
  reading: ReadingRecord,
  input: { questionId: string; answer?: string | null; skipped: boolean },
  repository: DreamRepository = getRepository(),
  reportProgress?: ProgressReporter
) {
  if (reading.status !== "clarifying") {
    if (reading.status === "free_ready") return reading;
    throw new AppError("INVALID_READING_STATE", "추가 질문을 받을 수 없는 상태예요.", 409);
  }
  const answers = clarificationAnswers(reading);
  if (answers.length >= MAX_CLARIFICATIONS) {
    throw new AppError("QUESTION_LIMIT_REACHED", "추가 질문은 최대 두 번까지만 진행해요.", 409);
  }
  const current = reading.questions[reading.questionCursor];
  if (!current || current.id !== input.questionId) {
    throw new AppError("QUESTION_MISMATCH", "현재 질문을 새로 확인해 주세요.", 409);
  }

  const answer: ClarificationAnswer = {
    questionId: current.id,
    kind: current.kind,
    answer: input.skipped ? null : (input.answer?.trim() ?? null),
    skipped: input.skipped
  };
  const admissionQuestion = current.id.startsWith("admission-");
  if (admissionQuestion && (input.skipped || !answer.answer)) {
    throw new AppError("DREAM_INPUT_NEEDS_CONTEXT", "기억나는 장면을 한 줄만 더 적어주세요. 떠오르지 않으면 새 꿈을 적을 수 있어요.", 422);
  }
  const answerText = input.skipped ? "이 질문은 건너뛰었어요." : answer.answer ?? "";
  const safetyRoute = input.skipped ? "none" : classifyDreamClarificationSafety(answerText,current.kind);
  let context = applyClarificationsToContext(readingContext(reading), [answer]);
  if (admissionQuestion && safetyRoute !== "immediate_self") {
    await admitDreamRequest(reading.sessionHash, repository);
    context.consultation = await prepareConsultation(context, decryptDream(reading.encryptedDream, reading.id), {
      selectedEmotion: reading.selectedEmotion, clarificationAnswers: [...answers, answer]
    }, reading.sessionHash, reportAiStages(reportProgress, "consultation", CONSULTATION_INTAKE_PROGRESS));
    assertDreamAdmission(context.consultation, true);
  }
  answers.push(answer);
  await repository.saveConversationTurn(
    makeTurn(reading.id, "user", "clarification", {
      text: answerText,
      label: current.prompt
    })
  );

  reading.encryptedContext = encryptJson(context, "context", reading.id);
  reading.encryptedClarificationAnswers = encryptJson(answers, "clarifications", reading.id);
  reading.questionCursor += 1;
  reading.updatedAt = new Date().toISOString();
  reportProgress?.({
    stage: "clarification_applied",
    percent: 35,
    label: "새로 적은 내용도 같이 읽어볼게요"
  });

  if (safetyRoute === "immediate_self") {
    reading.safetyRoute = safetyRoute;
    reading.status = "free_ready";
    await saveSafetyTurn(reading, safetyRoute, repository);
    await repository.saveReading(reading);
    reportProgress?.({
      stage: "safety_guidance_ready",
      percent: 92,
      label: "지금 필요한 안전 안내를 준비했어요"
    });
    return reading;
  }
  if (safetyRoute === "third_party") {
    reading.safetyRoute = safetyRoute;
    await saveSafetyTurn(reading, safetyRoute, repository);
  }

  if (reading.questionCursor < reading.questions.length && reading.questionCursor < MAX_CLARIFICATIONS) {
    await repository.saveReading(reading);
    reportProgress?.({
      stage: "clarification_ready",
      percent: 88,
      label: "다음 확인 질문을 준비했어요"
    });
    return reading;
  }

  context = applyClarificationsToContext(context, []);
  reading.encryptedContext = encryptJson(context, "context", reading.id);
  await repository.saveReading(reading);
  await finishFreeReading(reading, repository, reportProgress);
  reportProgress?.({
    stage: "free_reading_ready",
    percent: 92,
    label: "무료 핵심 해석을 완성해 저장했어요"
  });
  return reading;
}

export async function generateAndStoreDetailedReading(
  reading: ReadingRecord,
  repository: DreamRepository = getRepository(),
  reportProgress?: ProgressReporter,
  orderId?: string
) {
  const jobs = paidJobStore(repository);
  if (jobs) {
    jobs.enqueue(reading.id, orderId ?? reading.fullReadingOrderId);
    return (await repository.getReading(reading.id))!;
  }
  reading.status = "paid_generating";
  reading.detailGenerationStatus = "generating";
  reading.detailGenerationError = null;
  reading.updatedAt = new Date().toISOString();
  await repository.saveReading(reading);
  reportProgress?.({
    stage: "detailed_generation_started",
    percent: 52,
    label: "상세 해몽 생성 상태를 안전하게 기록했어요"
  });

  try {
    const activityStartedAt = new Date().toISOString();
    const aiProgress = {
      proposal_repair_started: {
        percent: 86,
        label: "응답 형식을 다시 확인하고 있어요",
        activityState: "responding"
      },
      fact_check_repair: {
        percent: 86,
        label: "입력한 내용과 어긋난 부분을 다시 확인하고 있어요",
        activityState: "responding"
      },
      request_prepared: {
        percent: 56,
        label: "꿈 맥락과 남은 질문을 AI 요청으로 정리했어요",
        activityState: "starting"
      },
      provider_started: {
        percent: 60,
        label: "AI 실행을 시작했어요",
        activityState: "starting"
      },
      provider_session_started: {
        percent: 64,
        label: "AI 작업 세션에 연결했어요",
        activityState: "connected"
      },
      model_started: {
        percent: 68,
        label: "AI가 꿈의 장면과 질문을 읽기 시작했어요",
        activityState: "responding"
      },
      response_received: {
        percent: 80,
        label: "AI의 상세 해몽 응답을 받았어요",
        activityState: "finalizing"
      },
      provider_completed: {
        percent: 83,
        label: "AI 응답 생성을 마쳤어요",
        activityState: "finalizing"
      },
      response_validated: {
        percent: 86,
        label: "응답 형식과 필수 항목을 확인했어요",
        activityState: "finalizing"
      },
      quality_checked: {
        percent: 88,
        label: "내용의 안전성과 품질을 확인했어요",
        activityState: "finalizing"
      },
      fallback_prepared: {
        percent: 88,
        label: "응답을 점검해 안전한 해석 형식으로 정리했어요",
        activityState: "finalizing"
      }
    } satisfies Record<AiGenerationProgressStage, {
      percent: number;
      label: string;
      activityState: "starting" | "connected" | "responding" | "finalizing";
    }>;
    const storedTurns = await repository.getConversationTurns(reading.id);
    const contract = await resolveReadingPaidContract(reading.id, orderId ?? reading.fullReadingOrderId, repository);
    const previousFree = contract.kind === "staged-v3" ? contract.sourceFreePayload : priorFreeForContract(contract, storedTurns);
    const lastUserTurn = storedTurns.findLast(turn=>turn.role === "user" && turn.kind === "followup");
    const lastUserContent = lastUserTurn ? decryptJson<UserTurnPayload>(lastUserTurn.encryptedContent,"turn",lastUserTurn.id) : null;
    const prepared = await preparedPaidPayload(reading.id, orderId ?? reading.fullReadingOrderId, storedTurns, repository, contract);
    const payload: AssistantTurnPayload | PaidCompositionV3Payload = prepared ?? (contract.kind === "staged-v3"
      ? await (async () => {
          const result = await generateStagedPaidV3(reading, contract);
          if (result.kind !== "complete") throw new PaidGenerationError("INSUFFICIENT_GROUNDED_MATERIAL");
          return result.composition;
        })()
      : await generateDetailedAssistant(
      readingContext(reading),
      reading.sessionHash,
      reading.safetyRoute,
      decryptDream(reading.encryptedDream, reading.id),
      generationUserEvidence(reading),
      (stage) => {
        const progress = aiProgress[stage];
        reportProgress?.({
          stage: `ai_${stage}`,
          ...progress,
          activityStartedAt
        });
      }, previousFree, lastUserContent?.intent === "repair" ? lastUserContent.text : undefined,
      { save: async () => undefined }, contract
    ));
    reportProgress?.({
      stage: "detailed_reading_generated",
      percent: 90,
      label: "장면별 상세 해몽 본문을 완성했어요"
    });
    const id = `turn_detailed_${reading.id}`;
    await repository.saveConversationTurn(
      makeTurn(reading.id, "kkumgyeol", "detailed", payload, { id })
    );
    reportProgress?.({
      stage: "detailed_turn_saved",
      percent: 94,
      label: "상세 해몽을 상담 기록에 저장했어요"
    });
    reading.status = "paid_ready";
    reading.detailGenerationStatus = "ready";
    reading.detailGenerationError = null;
    reading.updatedAt = new Date().toISOString();
    await repository.saveReading(reading);
    reportProgress?.({
      stage: "detailed_reading_saved",
      percent: 97,
      label: "결과 상태와 질문 이용권을 연결했어요"
    });
    return reading;
  } catch (error) {
    reading.status = "paid_generating";
    reading.detailGenerationStatus = "failed";
    reading.detailGenerationError =
      error instanceof Error ? error.message : "상세 해몽을 완성하지 못했어요.";
    reading.updatedAt = new Date().toISOString();
    await repository.saveReading(reading);
    if (error instanceof PaidGenerationError) throw error;
    throw new PaidGenerationError();
  }
}

/** Worker entry point: returns validated content; fenced publication happens in the job transaction. */
export async function generatePaidJobPayload(reading: ReadingRecord, repository: DreamRepository, recovery: PaidPipelinePersistence, orderId?: string) {
  const storedTurns = await repository.getConversationTurns(reading.id);
  const contract = await resolveReadingPaidContract(reading.id, orderId, repository);
  const prepared = await preparedPaidPayload(reading.id, orderId, storedTurns, repository, contract);
  if (prepared) return prepared;
  if (contract.kind === "staged-v3") {
    const result = await generateStagedPaidV3(reading, contract);
    if (result.kind !== "complete") throw new PaidGenerationError("INSUFFICIENT_GROUNDED_MATERIAL");
    return result.composition;
  }
  const previousFree = priorFreeForContract(contract, storedTurns);
  const lastUserTurn = storedTurns.findLast(turn => turn.role === "user" && turn.kind === "followup");
  const lastUserContent = lastUserTurn ? decryptJson<UserTurnPayload>(lastUserTurn.encryptedContent, "turn", lastUserTurn.id) : null;
  return generateDetailedAssistant(readingContext(reading), reading.sessionHash, reading.safetyRoute,
    decryptDream(reading.encryptedDream, reading.id), generationUserEvidence(reading), undefined,
    previousFree, lastUserContent?.intent === "repair" ? lastUserContent.text : undefined, recovery, contract);
}

async function preparedPaidPayload(
  readingId: string, orderId: string | undefined, turns: ConversationTurn[], repository: DreamRepository,
  contract: ResolvedPaidGenerationContract
): Promise<AssistantTurnPayload | null> {
  if (!orderId || contract.kind === "staged-v3") return null;
  const order = await repository.getOrder(orderId);
  const savedTurn = turns.find(turn => turn.id === `turn_prepared_${readingId}` && turn.kind === "detailed" && turn.status === "pending");
  if (!order?.purchasePromiseSnapshot || order.status !== "paid" || !savedTurn) return null;
  if (turns.some(turn => turn.role === "user" && turn.kind === "followup" && turn.createdAt > savedTurn.createdAt)) return null;
  try {
    const saved = decryptJson<{ promiseSha256: string; sourceFreeTurnId: string; sourceFreePayloadSha256: string; payload: AssistantTurnPayload }>(savedTurn.encryptedContent, "turn", savedTurn.id);
    const promise = order.purchasePromiseSnapshot;
    if (saved.promiseSha256 !== promise.promiseSha256 || saved.sourceFreeTurnId !== promise.sourceFreeTurnId ||
        saved.sourceFreePayloadSha256 !== promise.sourceFreePayloadSha256 ||
        !saved.payload?.directAnswer || !Array.isArray(saved.payload.sections)) return null;
    return saved.payload;
  } catch { return null; }
}

function publicPreparedPreview(payload: AssistantTurnPayload): PreparedPaidPreview {
  const [opening, ...locked] = payload.sections;
  return {
    title: payload.directAnswerTitle || "상세 해몽",
    lead: payload.directAnswer,
    opening: { title: opening?.title ?? "첫 장면", paragraphs: opening?.paragraphs ?? [] },
    lockedSections: locked.map(section => ({ title: section.title, paragraphCount: section.paragraphs.length }))
  };
}

/** Prepare one reviewed, encrypted report for the current free result and offer. */
export async function preparePaidPreview(reading: ReadingRecord, repository: DreamRepository = getRepository()): Promise<PreparedPaidPreview> {
  const publicReading = await getPublicReading(reading, "", repository);
  if (!publicReading.canPurchaseFullReading || !publicReading.paidOffer || publicReading.paidOffer.promiseVersion === "paid-offer-v2") {
    throw new AppError("PAID_PREVIEW_UNAVAILABLE", "이 꿈의 상세 미리보기를 준비할 수 없어요.", 409);
  }
  const turns = await repository.getConversationTurns(reading.id);
  const promise = purchasePromiseForReading(reading, turns, "confirmed");
  if (!promise || promise.promiseVersion !== "paid-offer-v1") throw new AppError("PAID_PREVIEW_UNAVAILABLE", "최신 무료 풀이를 다시 확인해 주세요.", 409);
  const id = `turn_prepared_${reading.id}`;
  const existing = turns.find(turn => turn.id === id && turn.status === "pending");
  if (existing) {
    try {
      const saved = decryptJson<{ promiseSha256: string; sourceFreeTurnId: string; sourceFreePayloadSha256: string; payload: AssistantTurnPayload }>(existing.encryptedContent, "turn", id);
      if (saved.promiseSha256 === promise.promiseSha256 && saved.sourceFreeTurnId === promise.sourceFreeTurnId &&
          saved.sourceFreePayloadSha256 === promise.sourceFreePayloadSha256 &&
          saved.payload?.directAnswer && Array.isArray(saved.payload.sections)) return publicPreparedPreview(saved.payload);
    } catch { /* Generate a new report if this private checkpoint is unreadable. */ }
  }
  const source = turns.find(turn => turn.id === promise.sourceFreeTurnId);
  if (!source) throw new AppError("PAID_PREVIEW_UNAVAILABLE", "무료 풀이 기록을 찾지 못했어요.", 409);
  const previousFree = decryptJson<AssistantTurnPayload>(source.encryptedContent, "turn", source.id);
  const payload = await generateDetailedAssistant(readingContext(reading), reading.sessionHash, reading.safetyRoute,
    decryptDream(reading.encryptedDream, reading.id), generationUserEvidence(reading), undefined,
    previousFree, undefined, { save: async () => undefined }, { kind: "legacy-v2" });
  const current = await repository.getReading(reading.id);
  if (!current) throw new AppError("READING_NOT_FOUND", "해몽 기록을 찾지 못했어요.", 404);
  const currentPromise = purchasePromiseForReading(current, await repository.getConversationTurns(reading.id), "confirmed");
  if (currentPromise?.promiseSha256 !== promise.promiseSha256 || currentPromise.sourceFreeTurnId !== promise.sourceFreeTurnId) {
    throw new AppError("PAID_PREVIEW_STALE", "무료 풀이가 갱신됐어요. 최신 결과에서 다시 준비해 주세요.", 409);
  }
  await repository.saveConversationTurn(makeTurn(reading.id, "kkumgyeol", "detailed", {
    promiseSha256: promise.promiseSha256, sourceFreeTurnId: promise.sourceFreeTurnId,
    sourceFreePayloadSha256: promise.sourceFreePayloadSha256!, payload
  }, { id, status: "pending" }));
  return publicPreparedPreview(payload);
}

export async function retryDetailedReading(
  reading: ReadingRecord,
  repository: DreamRepository = getRepository(),
  reportProgress?: ProgressReporter
) {
  const entitlement = await repository.getEntitlement(reading.id);
  if (!entitlement?.fullReadingPurchased) {
    throw new AppError("PAID_READING_REQUIRED", "전체 해몽 구매를 확인할 수 없어요.", 403);
  }
  // A stale browser can still show the retry button after another tab or a
  // recovery process has completed the reading. Return the finished result so
  // retry remains idempotent instead of showing a misleading error.
  const storedTurns = await repository.getConversationTurns(reading.id);
  const rejectedReport = hasRejectedStoredReport(reading.id,storedTurns);
  const durableJobs = paidJobStore(repository);
  const staleJobInput = durableJobs?.deliveryStatus(reading.id)?.current_input === false;
  if (storedTurns.some(turn => turn.id === `turn_detailed_${reading.id}` && turn.kind === "detailed" && turn.status === "complete") && !rejectedReport && !staleJobInput) return reading;
  if (reading.detailGenerationStatus === "ready" && !rejectedReport && !staleJobInput) return reading;
  if (reading.detailGenerationStatus !== "failed" && !rejectedReport && !staleJobInput) {
    throw new AppError("RETRY_NOT_AVAILABLE", "재시도할 상세 해몽이 없어요.", 409);
  }
  reportProgress?.({
    stage: "retry_authorized",
    percent: 10,
    label: "결제 내역과 재시도 가능 상태를 확인했어요"
  });
  if (!readingDetailGuidance(reading).ready) throw new AppError("FACT_CONFIRMATION_REQUIRED", "아래 확인 질문에 답하면 추가 비용 없이 풀이를 완성할게요.", 409);
  if (durableJobs) {
    durableJobs.retry(reading.id, reading.fullReadingOrderId);
    return (await repository.getReading(reading.id)) ?? reading;
  }
  const retryId = `retry_${hashToken(`${reading.id}:${reading.updatedAt}`).slice(0, 28)}`;
  const reservation = await repository.reserveQuestion(reading.id, retryId, false);
  if (reservation.status === "duplicate_complete") return (await repository.getReading(reading.id)) ?? reading;
  if (reservation.status !== "reserved") throw new AppError("MESSAGE_IN_PROGRESS", "진행 중인 요청이 끝난 뒤 다시 확인해 주세요.", 409);
  try {
    const result = await generateAndStoreDetailedReading(reading, repository, reportProgress);
    await repository.completeQuestionReservation(reading.id, retryId);
    return result;
  } catch (error) {
    await repository.releaseQuestionReservation(reading.id, retryId);
    throw error;
  }
}

function deterministicMessageTurnId(readingId: string, clientMessageId: string) {
  return `turn_message_${hashToken(`${readingId}:${clientMessageId}`).slice(0, 28)}`;
}

function deterministicAssistantMessageTurnId(readingId: string, clientMessageId: string) {
  return `turn_reply_${hashToken(`${readingId}:${clientMessageId}`).slice(0, 28)}`;
}

export async function addConversationMessage(
  reading: ReadingRecord,
  input: { clientMessageId: string; message: string },
  repository: DreamRepository = getRepository(),
  reportProgress?: ProgressReporter
) {
  const entitlement = await repository.getEntitlement(reading.id);
  if (!entitlement?.fullReadingPurchased) throw new AppError("PAID_READING_REQUIRED", "상세 해몽 구매를 확인한 뒤에 질문할 수 있어요.", 403);
  const intent = classifyUserMessage(input.message);
  const safety = intent === "correction" || intent === "dream_fact" ? classifyDreamClarificationSafety(input.message) : classifySafetyRoute(input.message);
  const admission = await admitConversation(reading, repository).catch(error => {
    // Safety guidance remains visible even when rate limiting stops storage/generation.
    if (safety === "immediate_self" && error instanceof AppError) {
      throw new AppError(error.code, safetyNoticeForRoute(safety)!.message, error.status, error.retryAfterSeconds);
    }
    throw error;
  });
  try {
    const current = await repository.getReading(reading.id);
    if (!current) throw new AppError("READING_NOT_FOUND", "해몽 결과가 없거나 보관 기간이 지났어요.", 404);
    reading = current;
    if (safetyNoticeForRoute(reading.safetyRoute)?.blocksInterpretation) {
      throw new AppError("SAFETY_ROUTE_ACTIVE", safetyNoticeForRoute(reading.safetyRoute)!.message, 409);
    }
    const sourceMessageHash = hashToken(input.message);
    const turns = await repository.getConversationTurns(reading.id);
    const previous = turns.find(turn => turn.role === "user" && turn.clientMessageId === input.clientMessageId);
    const previousContent = previous ? decryptJson<UserTurnPayload>(previous.encryptedContent, "turn", previous.id) : null;
    if (previousContent && (previousContent.sourceMessageHash ?? hashToken(previousContent.text)) !== sourceMessageHash) {
      throw new AppError("MESSAGE_CLIENT_ID_CONFLICT", "내용이 바뀌었어요. 새 질문으로 다시 보내주세요.", 409);
    }
    // Do not spend classification calls on new paid questions that cannot be answered.
    // Existing requests still reach reservation deduplication, including the last credit.
    if (!previous && intent === "question" && safety !== "immediate_self" && safety !== "third_party") {
      if (entitlement.usedQuestions >= entitlement.baseQuestionAllowance + entitlement.extraQuestionAllowance) {
        throw new AppError("QUESTION_CREDITS_EXHAUSTED", "이용 가능한 질문을 모두 사용했어요.", 409);
      }
      if (reading.detailGenerationStatus !== "ready" || reading.status !== "paid_ready") {
        throw new AppError("PAID_READING_REQUIRED", "상세 해몽이 열린 뒤에 질문할 수 있어요.", 403);
      }
    }
    let message = input.message;
    if (previousContent?.sourceMessageHash) message = previousContent.text;
    else if (safety !== "immediate_self") {
      const scope = await classifyConversationScope({
        message: input.message,
        originalDream: decryptDream(reading.encryptedDream, reading.id),
        clarificationAnswers: clarificationAnswers(reading),
        recentConversation: turns.filter(turn => turn.status === "complete").slice(-6).map(turn => {
          const content = decryptJson<UserTurnPayload | AssistantTurnPayload>(turn.encryptedContent, "turn", turn.id);
          return { role: turn.role, text: ("text" in content ? content.text : content.directAnswer).slice(0, 1200) };
        }),
        pendingQuestion: readingDetailGuidance(reading).question ?? null,
        sessionHash: reading.sessionHash
      });
      const scoped = scopedConversationMessage(input.message, scope);
      if (scoped === null) await admission.reject(hashToken(`${input.clientMessageId}:${sourceMessageHash}`), scope.decision === "off_topic");
      message = scoped!;
    }
    await admission.assertActive();
    return await addScopedConversationMessage(reading, { ...input, message, sourceMessageHash }, repository, reportProgress);
  } finally {
    await admission.release();
  }
}

async function addScopedConversationMessage(
  reading: ReadingRecord,
  input: { clientMessageId: string; message: string; sourceMessageHash: string },
  repository: DreamRepository,
  reportProgress?: ProgressReporter
) {
  const intent = classifyUserMessage(input.message);
  const safetyRoute = intent === "correction" || intent === "dream_fact" ? classifyDreamClarificationSafety(input.message) : classifySafetyRoute(input.message);
  const maintenance = intent !== "question" || safetyRoute === "immediate_self" || safetyRoute === "third_party";
  const entitlement = await repository.getEntitlement(reading.id);
  if (!entitlement?.fullReadingPurchased || (!maintenance && (reading.detailGenerationStatus !== "ready" || reading.status !== "paid_ready"))) {
    throw new AppError("PAID_READING_REQUIRED", "상세 해몽이 열린 뒤에 질문할 수 있어요.", 403);
  }
  if (safetyNoticeForRoute(reading.safetyRoute)?.blocksInterpretation) {
    throw new AppError(
      "SAFETY_ROUTE_ACTIVE",
      "지금은 해몽보다 안전 확인을 우선해요. 안내된 도움과 가까운 사람에게 먼저 연결해 주세요.",
      409
    );
  }

  const userTurnId = deterministicMessageTurnId(reading.id, input.clientMessageId);
  let userTurn = makeTurn(
    reading.id,
    "user",
    "followup",
    { text: input.message, sourceMessageHash: input.sourceMessageHash, intent, label: intent === "reaction" ? "추가 대화" : intent === "correction" ? "꿈의 사실 정정" : intent === "dream_fact" ? "추가로 확인한 사실" : intent === "repair" ? "풀이 수정 요청" : "이어진 질문" },
    { id: userTurnId, clientMessageId: input.clientMessageId, status: "pending" }
  );
  const reservation = await repository.reserveQuestion(reading.id, input.clientMessageId, !maintenance, userTurn, input.sourceMessageHash);
  if (reservation.status === "duplicate_complete") {
    reportProgress?.({
      stage: "duplicate_message_found",
      percent: 94,
      label: "이미 처리한 같은 요청을 확인했어요"
    });
    return (await repository.getReading(reading.id)) ?? reading;
  }
  if (reservation.status === "duplicate_pending") {
    throw new AppError("MESSAGE_IN_PROGRESS", "진행 중인 요청이 있어요. 완료된 뒤 다시 보내주세요.", 409);
  }
  if (reservation.status === "not_entitled") {
    throw new AppError("PAID_READING_REQUIRED", "질문 이용권을 확인할 수 없어요.", 403);
  }
  if (reservation.status === "credits_exhausted") {
    throw new AppError("QUESTION_CREDITS_EXHAUSTED", "이용 가능한 질문을 모두 사용했어요.", 409);
  }
  reportProgress?.({
    stage: "question_reserved",
    percent: 18,
    label: "질문 이용권을 확인하고 이 요청에 확보했어요"
  });

  reportProgress?.({
    stage: "question_saved",
    percent: 32,
    label: "질문을 상담 기록에 안전하게 남겼어요"
  });

  if (safetyRoute === "immediate_self") {
    userTurn = { ...userTurn, status: "complete" };
    await repository.saveConversationTurn(userTurn);
    reading.safetyRoute = safetyRoute;
    reading.updatedAt = new Date().toISOString();
    await saveSafetyTurn(reading, safetyRoute, repository);
    await repository.saveReading(reading);
    await repository.releaseQuestionReservation(reading.id, input.clientMessageId);
    reportProgress?.({
      stage: "safety_guidance_ready",
      percent: 94,
      label: "해몽보다 먼저 볼 안전 안내를 준비했어요"
    });
    return reading;
  }

  const reservationHeartbeat = setInterval(() => {
    void repository.heartbeatQuestionReservation(reading.id, input.clientMessageId).catch(error => {
      const code = error instanceof Error ? error.message.split(":", 1)[0] : "QUESTION_RESERVATION_HEARTBEAT_FAILED";
      console.error(JSON.stringify({ event: "question_reservation_heartbeat_failed", code }));
    });
  }, 60_000);
  reservationHeartbeat.unref?.();
  try {
    if (maintenance) {
      const current = (await repository.getReading(reading.id)) ?? reading;
      if (intent === "reaction") {
        await repository.saveConversationTurn({...userTurn,status:"complete"});
        await repository.completeQuestionReservation(reading.id,input.clientMessageId);
        return current;
      }
      const answers = clarificationAnswers(current);
      if (intent === "correction" || intent === "dream_fact" || intent === "reality_context") {
        const pending = readingDetailGuidance(current);
        const addition: ClarificationAnswer = {questionId:pending.questionId ?? `correction-${input.clientMessageId}`,kind:pending.questionId ? pending.kind : intent === "reality_context" ? "recent_context" : "scene",answer:input.message,skipped:forgotDetail(input.message)};
        if (answers.reduce((sum,a)=>sum+(a.answer?.length ?? 0),0)+input.message.length > 6000) throw new AppError("CORRECTION_LIMIT","이 기록에 보탠 내용이 길어졌어요. 고객센터에 풀이 수정을 요청해 주세요.",422);
        if (!answers.some(answer=>answer.questionId===addition.questionId && answer.answer===addition.answer)) answers.push(addition);
        const base = analyzeDreamContextLocally(decryptDream(current.encryptedDream,current.id),current.selectedEmotion,readingContext(current).selectedFocus).context;
        const nextContext = applyClarificationsToContext(base,answers);
        // Commit the user's correction before any provider call. A failed
        // planner must not lose the correction or keep displaying the old report.
        current.encryptedContext = encryptJson(nextContext,"context",current.id);
        current.encryptedClarificationAnswers = encryptJson(answers,"clarifications",current.id);
        current.detailGenerationStatus="failed";
        current.status="paid_generating";
        current.detailGenerationError="추가한 사실을 반영해 풀이를 다시 완성하고 있어요.";
        current.updatedAt = new Date().toISOString();
        await repository.saveReading(current);
        nextContext.consultation = await prepareConsultation(nextContext,decryptDream(current.encryptedDream,current.id),{selectedEmotion:current.selectedEmotion,clarificationAnswers:answers},current.sessionHash,reportAiStages(reportProgress,"consultation",CONSULTATION_MAINTENANCE_PROGRESS));
        current.encryptedContext = encryptJson(nextContext,"context",current.id);
        current.encryptedClarificationAnswers = encryptJson(answers,"clarifications",current.id);
        current.updatedAt = new Date().toISOString();
        await repository.saveReading(current);
      }
      await repository.saveConversationTurn({...userTurn,status:"complete"});
      if (safetyRoute === "third_party") { current.safetyRoute=safetyRoute; await saveSafetyTurn(current,safetyRoute,repository); }
      if (!readingDetailGuidance(current).ready) {
        current.detailGenerationStatus="failed";
        current.detailGenerationError="핵심 사실을 확인한 뒤 추가 비용 없이 풀이를 완성할게요.";
        current.status="paid_generating";
        await repository.saveReading(current);
      } else {
        // A correction completes the purchased report, not a new paid follow-up.
        Object.assign(current, await generateAndStoreDetailedReading(current,repository,reportProgress));
      }
      await repository.completeQuestionReservation(reading.id,input.clientMessageId);
      return current;
    }
    const turns = await repository.getConversationTurns(reading.id);
    const generated = await generateFollowupAssistant(
      readingContext(reading),
      decodeAssistantTurns(turns),
      input.message,
      reading.sessionHash,
      decryptDream(reading.encryptedDream, reading.id),
      generationUserEvidence(reading)
    );
    reportProgress?.({
      stage: "followup_generated",
      percent: 82,
      label: "앞선 해석과 이어지는 답변을 완성했어요"
    });
    reading.encryptedContext = encryptJson(generated.context, "context", reading.id);
    userTurn = { ...userTurn, status: "complete" };
    const assistantTurn = makeTurn(reading.id, "kkumgyeol", "followup", generated.payload, {
      id: deterministicAssistantMessageTurnId(reading.id,input.clientMessageId)
    });
    await repository.completeQuestionWithTurns(reading.id,input.clientMessageId,userTurn,assistantTurn,reading.encryptedContext);
    reading.updatedAt = new Date().toISOString();
    reportProgress?.({
      stage: "followup_saved",
      percent: 94,
      label: "답변을 저장하고 질문 횟수를 반영했어요"
    });
    return reading;
  } catch (error) {
    userTurn = { ...userTurn, status: maintenance ? "complete" : "failed" };
    await repository.releaseQuestionReservation(reading.id, input.clientMessageId, userTurn);
    throw new AppError(
      "FOLLOWUP_GENERATION_FAILED",
      error instanceof Error ? error.message : "답을 완성하지 못했어요. 질문 횟수는 차감하지 않았어요.",
      502
    );
  } finally {
    clearInterval(reservationHeartbeat);
  }
}

export async function claimReading(
  reading: ReadingRecord,
  userId: string,
  repository: DreamRepository = getRepository()
) {
  reading.ownerUserId = userId;
  reading.updatedAt = new Date().toISOString();
  if (reading.paidAt) reading.expiresAt = plusMs(new Date(), 365 * DAY_MS);
  await repository.saveReading(reading);
  return reading;
}
