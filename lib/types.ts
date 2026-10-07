import type { InterpretationFocus } from "./interpretation-focus";

export const EMOTIONS = [
  "무서웠어요",
  "기분 좋았어요",
  "찝찝했어요",
  "이상했어요",
  "잘 모르겠어요"
] as const;

export type Emotion = (typeof EMOTIONS)[number];

export type ReadingStatus =
  | "intake"
  | "clarifying"
  | "free_ready"
  | "payment_pending"
  | "paid_generating"
  | "paid_ready";

export type DetailGenerationStatus = "locked" | "generating" | "ready" | "failed";
export type OrderStatus = "pending" | "paid" | "failed" | "refunded";
export type OrderProduct = "full_reading" | "followup_pack_2";
export type SignalDirection = "긍정 신호" | "주의 신호" | "심리 반영";
export type ClarificationKind = "scene" | "relationship" | "emotion" | "recent_context" | "dreamer";

export type EncryptedPayload = {
  v: 1;
  alg: "A256GCM";
  iv: string;
  ciphertext: string;
  tag: string;
};

export type ClarificationQuestion = {
  id: string;
  kind: ClarificationKind;
  prompt: string;
  options: string[];
  placeholder: string;
};

export type ClarificationAnswer = {
  questionId: string;
  kind: ClarificationKind;
  answer: string | null;
  skipped: boolean;
};

export type GenerationUserEvidence = {
  selectedEmotion: Emotion | null;
  clarificationAnswers: ClarificationAnswer[];
};

export type DreamSymbol = {
  key: string;
  name: string;
  traditional: string;
  psychological: string;
  action: string;
};

export type DreamScene = {
  order: number;
  people: string[];
  action: string;
  place: string | null;
  emotion: string | null;
};

export type DreamContext = {
  consultation?: ConsultationPlan;
  /** Original dream evidence, retained encrypted so later corrections can rebuild facts. */
  dreamEvidence?: string;
  selectedEmotion?: Emotion | null;
  dreamer: "user" | "someone_else" | "unknown";
  dreamerDescription: string | null;
  relationshipToUser: string | null;
  /** The question category explicitly selected before submitting the dream. */
  selectedFocus?: InterpretationFocus | null;
  /** Canonicalized questions the user explicitly asked in the dream text or later context. */
  userQuestions?: string[];
  statedPersonalDetails: string[];
  people: string[];
  scenes: DreamScene[];
  places: string[];
  emotions: string[];
  symbols: DreamSymbol[];
  realityContexts: string[];
  isRecurring: boolean;
  uncertainties: string[];
};

/**
 * Kept as a compatibility alias for the small, self-authored local symbol
 * engine. New persistence and API code use DreamContext.
 */
export type DreamStructure = {
  people: string[];
  actions: string[];
  places: string[];
  emotions: string[];
  symbols: DreamSymbol[];
  recentContext: string | null;
  isRecurring: boolean;
  uncertainty: string[];
};

export type AnswerSection = {
  title: string;
  paragraphs: string[];
};

export type InterpretationChanges = {
  newlyLearned: string;
  revisedInterpretation: string;
};

export type AnswerGenerationSource = "openai" | "codex" | "local" | "local_fallback";

export const STAGED_FREE_READING_V3_INSTRUCTION_VERSION = "staged-free-v3-1" as const;
export const PAID_COMPOSITION_V3_INSTRUCTION_VERSION = "paid-composition-v3-1" as const;

export type FreeReadingCoverageItem = {
  label: string;
  evidenceQuotes: string[];
};

export type StagedFreeReadingV3Content = {
  title: string;
  primarySection: {
    heading: string;
    paragraphs: string[];
  };
  secondarySection: {
    heading: string;
    paragraphs: string[];
  };
  coverage: {
    primary: FreeReadingCoverageItem;
    secondary: FreeReadingCoverageItem;
    reserved: FreeReadingCoverageItem[];
  };
};

export type FreeContentContractV1 = {
  delivered: FreeReadingCoverageItem;
  discovered: FreeReadingCoverageItem;
  reserved: FreeReadingCoverageItem[];
  offerEligibility: {
    eligible: boolean;
    perspectives: Array<FreeReadingCoverageItem>;
  };
};

/** Staged free contract. It is intentionally separate from the user-facing V2 payload. */
export type StagedFreeReadingV3Payload = StagedFreeReadingV3Content & {
  freeCompositionVersion: 3;
  contentContractVersion: 1;
  contentContract: FreeContentContractV1;
  instructionVersion: typeof STAGED_FREE_READING_V3_INSTRUCTION_VERSION;
  generationInstructionSha256: string;
  appInstructionsSha256: string;
  generationSource: Extract<AnswerGenerationSource, "openai" | "codex">;
};

export type PublicFreeReadingV3 = Pick<StagedFreeReadingV3Content, "title" | "primarySection" | "secondarySection"> & {
  freeCompositionVersion: 3;
};

export type PaidCompositionV3Content = {
  title: string;
  bridge: string;
  newPerspectives: Array<{
    heading: string;
    perspectiveLabel: string;
    paragraphs: string[];
    evidenceQuotes: string[];
  }>;
  relationshipSynthesis: string[];
  alternativeReading?: { paragraph: string; evidenceQuotes: string[] };
  finalIntegration: string;
};

export type PaidCompositionV3Payload = PaidCompositionV3Content & {
  paidCompositionVersion: 3;
  instructionVersion: typeof PAID_COMPOSITION_V3_INSTRUCTION_VERSION;
  generationInstructionSha256: string;
  appInstructionsSha256: string;
  generationSource: Extract<AnswerGenerationSource, "openai" | "codex">;
};

export type PublicPaidCompositionV3 = Omit<PaidCompositionV3Content, "newPerspectives" | "alternativeReading"> & {
  paidCompositionVersion: 3;
  newPerspectives: Array<Omit<PaidCompositionV3Content["newPerspectives"][number], "evidenceQuotes">>;
  alternativeReading?: { paragraph: string };
};

export type StagedPaidV3Result =
  | { kind: "complete"; composition: PaidCompositionV3Payload; review: { approved: true } }
  | { kind: "insufficient_grounded_material"; reasonCode: "INSUFFICIENT_GROUNDED_MATERIAL" };

/** Persisted-only free assistant union; the public renderer remains on V2 for now. */
export type StoredAssistantTurnPayload = AssistantTurnPayload | StagedFreeReadingV3Payload | PaidCompositionV3Payload;
export type PreparedPaidReport = { promiseSha256: string; sourceFreeTurnId: string; sourceFreePayloadSha256: string; payload: AssistantTurnPayload };
export type StoredConversationTurnPayload = UserTurnPayload | StoredAssistantTurnPayload | PreparedPaidReport | SafetyNotice;

export type ReadingSource = { id: string; symbol: string; title: string; url: string };

export type AssistantTurnPayload = {
  qualityVersion?: 2;
  paidReadingModel?: "editorial_depth_v2";
  evidenceQuotes?: string[];
  freeReadingMode?: "symbolic" | "needs_detail";
  freeCompositionVersion?: 2;
  readingQuestion?: string;
  sources?: ReadingSource[];
  directAnswerTitle?: string;
  directAnswer: string;
  sections: AnswerSection[];
  interpretationChanges: InterpretationChanges | null;
  uncertainty: string[];
  shareableSentences: string[];
  suggestedQuestions: string[];
  generationSource: AnswerGenerationSource;
};

export type ConversationRole = "user" | "kkumgyeol";
export type ConversationTurnKind =
  | "dream"
  | "clarification"
  | "free"
  | "detailed"
  | "followup"
  | "safety";
export type ConversationTurnStatus = "pending" | "complete" | "failed";

export type UserTurnPayload = {
  /** Digest of the original submission; text may contain only its accepted dream-related parts. */
  sourceMessageHash?: string;
  text: string;
  label?: string;
  intent?: "reaction" | "correction" | "dream_fact" | "reality_context" | "repair" | "question";
};

export type ConsultationPlan = {
  version: 2;
  /** Absent only on legacy records and the explicit offline review profile. */
  disposition?: "READY_DREAM" | "NEEDS_CONTEXT" | "NOT_DREAM" | "EXTERNAL_INSTRUCTION";
  sourceText: string;
  facts: string[];
  keyElements: Array<{ label: string; evidence: string }>;
  sequenceConfirmed: boolean;
  unresolved: string[];
  question: (ClarificationQuestion & { reason: string }) | null;
  ready: boolean;
  limited: boolean;
  sectionTopics: Array<"narrative" | "role" | "emotion" | "place" | "reality">;
};

export type SafetyRoute = "none" | "immediate_self" | "third_party" | "dream_only";

export type SafetyNotice = {
  route: Exclude<SafetyRoute, "none" | "dream_only">;
  title: string;
  message: string;
  resources: Array<{ label: string; phone: "109" | "112" | "119" | "1366" }>;
  blocksInterpretation: boolean;
};

export type ConversationTurn = {
  id: string;
  readingId: string;
  role: ConversationRole;
  kind: ConversationTurnKind;
  status: ConversationTurnStatus;
  clientMessageId: string | null;
  encryptedContent: EncryptedPayload;
  createdAt: string;
};

export type PublicConversationTurn = {
  id: string;
  role: ConversationRole;
  kind: ConversationTurnKind;
  createdAt: string;
  content: UserTurnPayload | AssistantTurnPayload | PublicFreeReadingV3 | PublicPaidCompositionV3 | SafetyNotice;
};

export type ReadingEntitlement = {
  readingId: string;
  fullReadingPurchased: boolean;
  baseQuestionAllowance: 0 | 2;
  extraQuestionAllowance: 0 | 2;
  usedQuestions: number;
  extraPackPurchased: boolean;
  updatedAt: string;
};

export type QuestionReservationStatus =
  | "reserved"
  | "duplicate_complete"
  | "duplicate_pending"
  | "not_entitled"
  | "credits_exhausted";

export type QuestionReservation = {
  status: QuestionReservationStatus;
  remainingQuestions: number;
};

export type ReadingRecord = {
  id: string;
  status: ReadingStatus;
  detailGenerationStatus: DetailGenerationStatus;
  detailGenerationError: string | null;
  sessionHash: string;
  ownerUserId: string | null;
  encryptedDream: EncryptedPayload;
  encryptedContext: EncryptedPayload;
  encryptedClarificationAnswers: EncryptedPayload;
  selectedEmotion: Emotion | null;
  questions: ClarificationQuestion[];
  questionCursor: number;
  safetyRoute: SafetyRoute;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  /** Write-once full-reading order used to resume the exact purchase contract. */
  fullReadingOrderId?: string;
  expiresAt: string;
};

export type OrderRecord = {
  id: string;
  readingId: string;
  sessionHash: string;
  product: OrderProduct;
  amount: 990;
  status: OrderStatus;
  paymentKey: string | null;
  /** Provider key recorded before verification so an interrupted confirmation can be retried idempotently. */
  verificationPaymentKey?: string | null;
  providerTransactionKey: string | null;
  /** Immutable copy of the paid offer shown when this order was created. Absent on legacy orders. */
  purchasePromiseSnapshot?: PurchasePromiseSnapshot;
  contentConsentAt: string;
  createdAt: string;
  updatedAt: string;
};

export type PaidPreviewKey = "traditional" | "psychology" | "pattern" | "action";
export type PaidPreview = {
  key: PaidPreviewKey;
  title: string;
  firstSentence: string;
  evidenceSceneOrders: number[];
  promisedSectionTitle: string;
};

/** Public projection of a reviewed report prepared before checkout. Hidden copy never leaves the server. */
export type PreparedPaidPreview = {
  title: string;
  lead: string;
  opening: { title: string; paragraphs: string[] };
  lockedSections: Array<{ title: string; paragraphCount: number }>;
};

export type OfferRiskClass = "standard" | "sensitive" | "blocked";

export type PaidOffer = {
  variant: "contextual_questions_v1" | "editorial_depth_v2";
  headline: string;
  bridge: string;
  checkoutTitle: string;
  checkoutSummary: string;
  cta: string;
  trustLines: string[];
  riskClass: OfferRiskClass;
  cards: PaidPreview[];
};

export const PURCHASE_PROMISE_VERSION = "paid-offer-v1" as const;
export const PURCHASE_PROMISE_V2_VERSION = "paid-offer-v2" as const;
export type PurchasePromiseIdentity = {
  promiseVersion: typeof PURCHASE_PROMISE_VERSION | typeof PURCHASE_PROMISE_V2_VERSION;
  promiseSha256: string;
};
type PurchasePromiseSnapshotBase = {
  sourceReadingId: string;
  sourceFreeTurnId: string;
  captureMode: "confirmed" | "legacy_server_snapshot";
  capturedAt: string;
};
export type PaidOfferV1Snapshot = PurchasePromiseIdentity & PurchasePromiseSnapshotBase & {
  promiseVersion: typeof PURCHASE_PROMISE_VERSION;
  offer: PaidOffer;
  sourceFreeCompositionVersion: 2 | 3 | null;
  /** Optional integrity metadata; excluded from the paid-offer-v1 promise hash. */
  sourceFreePayloadSha256?: string;
};
export type PaidCompositionPromiseV2 = {
  variant: "grounded_remaining_perspectives_v2";
  paidCompositionVersion: 3;
  bridgeSentenceRange: [2, 3];
  newPerspectiveRange: [number, number];
  synthesisParagraphRange: [1, 2];
  alternativeReading: "optional";
  finalIntegrationSentenceCount: 1;
  visibleBodyCodePointRange: [900, 1500];
  contentContractVersion?: 1;
  eligibility?: "eligible";
  headline?: string;
  bridge?: string;
  cards?: PaidPreview[];
};
export type PaidOfferV2Snapshot = {
  promiseVersion: typeof PURCHASE_PROMISE_V2_VERSION;
  promiseSha256: string;
  sourceReadingId: string;
  sourceFreeTurnId: string;
  sourceFreeCompositionVersion: 3;
  sourceFreePayloadSha256: string;
  captureMode: "confirmed" | "legacy_server_snapshot";
  capturedAt: string;
  offer: PaidCompositionPromiseV2;
};
export type PurchasePromiseSnapshot = PaidOfferV1Snapshot | PaidOfferV2Snapshot;

export type PublicReading = {
  paidRecovery?: { status: "queued" | "running" | "retry" | "completed" | "attention" | "cancelled"; reference: string; message: string };
  id: string;
  recordRevision?: string;
  status: ReadingStatus;
  detailGenerationStatus: DetailGenerationStatus;
  currentQuestion: ClarificationQuestion | null;
  answeredQuestionCount: number;
  maxQuestionCount: 2;
  timeline: PublicConversationTurn[];
  paidOffer: (PaidOffer & PurchasePromiseIdentity) | null;
  freeDetailGuidance: { ready: boolean; kind: ClarificationKind; question: string; placeholder: string; questionId?: string; options?: string[]; reason?: string; limited?: boolean } | null;
  /** Compatibility alias for clients deployed before contextual offers. */
  paidPreviews: PaidPreview[];
  safetyNotice: SafetyNotice | null;
  entitlement: {
    fullReadingPurchased: boolean;
    remainingQuestions: number;
    usedQuestions: number;
    maximumQuestions: 4;
    extraPackPurchased: boolean;
    canPurchaseExtraPack: boolean;
  };
  canPurchaseFullReading: boolean;
  checkoutMode: "mock" | "live" | "unavailable";
  canRetryDetailedReading: boolean;
  restoreUrl: string;
  expiresAt: string;
  canCorrectReading?: boolean;
  recoveryNotice?: string;
};

// Legacy output types remain available to the local catalog tests and any
// previously linked code, but are no longer persisted or rendered by the app.
export type FreeReading = {
  headline: string;
  directions: SignalDirection[];
  symbols: Array<{ name: string; meaning: string }>;
  psychology: string;
  uncertaintyNote: string | null;
};

export type PaidSection = {
  key: PaidPreviewKey | "overview";
  eyebrow: string;
  title: string;
  paragraphs: string[];
};

export type PaidReport = {
  title: string;
  lead: string;
  sections: PaidSection[];
  positive: string;
  caution: string;
  actions: string[];
  reflectionQuestions: string[];
  generatedAt: string;
};

export type FollowUp = {
  question: string;
  answer: string;
  createdAt: string;
};

export const ANALYTICS_EVENTS = [
  "input_started",
  "focus_selected",
  "analysis_submitted",
  "clarification_answered",
  "clarification_skipped",
  "free_result_viewed",
  "paywall_viewed",
  "preview_card_clicked",
  "paywall_clicked",
  "checkout_started",
  "payment_succeeded",
  "paid_result_viewed",
  "followup_used",
  "share_created",
  "deep_reading_viewed",
  "conversation_message_sent",
  "conversation_reply_viewed",
  "credits_exhausted",
  "followup_pack_purchased",
  "safety_route_shown",
  "answer_rated"
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];
