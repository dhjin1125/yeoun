import type { PaidCompositionPromiseV2, PaidPreview, PaidCompositionV3Content, PaidCompositionV3Payload, StagedFreeReadingV3Payload, StagedPaidV3Result } from "./types";

export function createStagedPaidOfferV2(): PaidCompositionPromiseV2 {
  return {
    variant: "grounded_remaining_perspectives_v2",
    paidCompositionVersion: 3,
    bridgeSentenceRange: [2, 3],
    newPerspectiveRange: [2, 3],
    synthesisParagraphRange: [1, 2],
    alternativeReading: "optional",
    finalIntegrationSentenceCount: 1,
    visibleBodyCodePointRange: [900, 1500]
  };
}

function distinctRemainingAxes(source: StagedFreeReadingV3Payload) {
  const candidates = [source.contentContract.discovered, ...source.contentContract.reserved];
  const deliveredEvidence = new Set(source.contentContract.delivered.evidenceQuotes.map(value => value.replace(/\s+/gu, " ").trim()));
  const seen = new Set<string>();
  return candidates.filter(item => {
    const label = item.label.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
    const evidence = item.evidenceQuotes.map(value => value.replace(/\s+/gu, " ").trim());
    if (!label || seen.has(label) || evidence.length === 0 || evidence.every(quote => deliveredEvidence.has(quote))) return false;
    seen.add(label);
    return true;
  });
}

export function buildContentContractOffer(
  source: StagedFreeReadingV3Payload,
  dreamEvidence: string,
  explicitUserContext: string[] = []
): PaidCompositionPromiseV2 | null {
  if (source.contentContractVersion !== 1) return null;
  const assessed = source.contentContract.offerEligibility;
  if (!assessed?.eligible || assessed.perspectives.length !== 2) return null;
  const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();
  const grounding = normalize([dreamEvidence, ...explicitUserContext].join(" "));
  const deliveredQuotes = new Set(source.contentContract.delivered.evidenceQuotes.map(normalize));
  const groundedAxes = assessed.perspectives.filter(axis =>
    axis.evidenceQuotes.length > 0 && axis.evidenceQuotes.every(quote => grounding.includes(normalize(quote))) &&
    axis.evidenceQuotes.some(quote => !deliveredQuotes.has(normalize(quote)))
  );
  const distinctAxes = distinctRemainingAxes({ ...source, contentContract: { ...source.contentContract, discovered: assessed.perspectives[0]!, reserved: [assessed.perspectives[1]!] } });
  if (groundedAxes.length !== 2 || distinctAxes.length !== 2) return null;
  const cards: PaidPreview[] = groundedAxes.map((_, index) => ({
    key: index === 0 ? "traditional" : "psychology",
    title: `무료에서 남긴 관점 ${index + 1}`,
    firstSentence: index === 0
      ? "무료 해석에서 남겨둔 별도의 장면을 원문 근거와 함께 확장합니다."
      : "첫 번째 관점과 겹치지 않는 다른 행동 흐름을 꿈 전체와 연결합니다.",
    evidenceSceneOrders: [],
    promisedSectionTitle: `남겨둔 관점 ${index + 1}`
  }));
  return {
    ...createStagedPaidOfferV2(),
    contentContractVersion: 1,
    eligibility: "eligible",
    newPerspectiveRange: [2, 2] as [2, 2],
    headline: "무료에서 발견한 다른 흐름까지 이어서 읽기",
    bridge: "무료에서 완결한 핵심 해석을 반복하지 않고, 아직 충분히 다루지 않은 두 장면의 흐름을 원문 근거에 따라 확장해 꿈 전체의 관계를 이어서 살핍니다.",
    cards
  };
}

export function isContentContractOffer(offer: PaidCompositionPromiseV2): offer is PaidCompositionPromiseV2 & {
  contentContractVersion: 1; eligibility: "eligible"; headline: string; bridge: string; cards: PaidPreview[];
} {
  return offer.contentContractVersion === 1 && offer.eligibility === "eligible" && Boolean(offer.headline && offer.bridge && (offer.cards?.length ?? 0) >= 2);
}

export const PAID_COMPOSITION_V3_PROMPT = `Paid Composition V3를 작성한다. 아래 실제 꿈 입력, 주문 snapshot, 무료 결과만 근거로 사용한다.

- 사물별 상징 사전이나 무료 해석의 말바꾸기를 하지 말고, 꿈의 장면 관계를 읽는다.
- 먼저 무료의 핵심을 2~3문장 bridge로 짧게 이어받는다. 무료 내용을 다시 길게 요약하지 않는다.
- 무료가 아직 완결하지 않은 실제 행동·인물 역할·공간 변화·명시된 결말·제공된 현실 맥락·서로 반대되는 움직임 중 근거가 있는 관점만 2~3개 쓴다.
- 무료에서 이미 완결한 행동 흐름 하나를 여러 관점으로 쪼개 새 해석처럼 제시하지 않는다.
- contentContract.offerEligibility.perspectives 두 항목만 유료 새 관점의 후보로 사용한다. 각 관점은 서로 다른 원문 근거와 의미를 가져야 하며, snapshot의 공개 카드 문구는 일반 안내이므로 내부 해석 라벨·근거를 노출하지 않는다.
- coverage.reserved는 참고다. 실제 꿈 입력과 무료 visible 원문이 우선하며 구매 당시 snapshot의 계약을 따른다.
- 입력에 없는 사건, 대화, 성격, 관계, 감정, 속마음을 만들지 않는다. 모든 evidenceQuotes는 실제 입력에서 그대로 인용한다.
- relationshipSynthesis는 선택한 장면들이 어떤 관계를 이루는지 설명한다. alternativeReading은 실제로 타당할 때만 넣는다.
- 마지막 finalIntegration은 꿈 전체를 묶는 질문이 아닌 한 문장이다.
- visible body는 title 제외 900~1,500 Unicode code points를 목표로 한다. 분량을 채우기 위해 반복하지 않는다.
- 근거 있는 새 관점 두 개를 만들 수 없으면 본문을 만들지 말고 kind=insufficient_grounded_material과 고정 reasonCode를 반환한다.
- 질문형 CTA, 구매 권유, 예언, 건강 상태 판정은 쓰지 않는다.`;

export const PAID_COMPOSITION_V3_REVIEW_PROMPT = `Paid Composition V3를 독립 검수한다. 제공된 실제 꿈 입력, 구매 snapshot, 무료 visible 원문과 coverage만 비교한다.

다음 경우에만 finding을 반환한다.
1. 유료 관점이 무료 문장을 말만 바꿔 반복한다.
2. 새로운 해석이 아니라 꿈 사실을 다시 말한 내용이다.
3. 무료에서 이미 완결한 하나의 행동 흐름을 여러 paid perspective로 쪼갰다.
4. 구매 당시 snapshot이 약속한 범위를 벗어났다.
5. 꿈 입력에 없는 현실 사건·대화·속마음·감정 사실을 만들었다.

각 finding은 수정할 대상과 구체적인 근거를 제시한다. 새 관점의 수를 맞추려고 해석을 억지로 만들지 않는다. 수정 후에도 근거 있는 새 관점 두 개가 불가능하면 complete 대신 insufficient_grounded_material을 반환한다.`;

export type PaidCompositionV3ValidationIssue =
  | "AI_PAID_V3_BRIDGE_SENTENCES"
  | "AI_PAID_V3_BRIDGE_DOMINATES"
  | "AI_PAID_V3_BODY_LENGTH"
  | "AI_PAID_V3_CTA"
  | "AI_PAID_V3_FINAL_INTEGRATION"
  | "AI_PAID_V3_DUPLICATE_PERSPECTIVE"
  | "AI_PAID_V3_UNGROUNDED_EVIDENCE";

export function paidCompositionV3VisibleBodyCharacterCount(composition: PaidCompositionV3Content) {
  const visible = [
    composition.bridge,
    ...composition.newPerspectives.flatMap(item => [item.heading, ...item.paragraphs]),
    ...composition.relationshipSynthesis,
    ...(composition.alternativeReading ? [composition.alternativeReading.paragraph] : []),
    composition.finalIntegration
  ];
  return [...visible.join("")].length;
}

function sentenceCount(text: string) {
  return text.split(/[.!?。！？]+/u).filter(sentence => sentence.trim()).length;
}

function normalized(text: string) {
  return text.replace(/\s+/gu, " ").trim();
}

function allEvidence(composition: PaidCompositionV3Content) {
  return [
    ...composition.newPerspectives.flatMap(item => item.evidenceQuotes),
    ...(composition.alternativeReading?.evidenceQuotes ?? [])
  ];
}

function hasQuestionOrCta(composition: PaidCompositionV3Content) {
  const visible = [
    composition.title,
    composition.bridge,
    ...composition.newPerspectives.flatMap(item => [item.heading, ...item.paragraphs]),
    ...composition.relationshipSynthesis,
    ...(composition.alternativeReading ? [composition.alternativeReading.paragraph] : []),
    composition.finalIntegration
  ].join(" ");
  return /[?？]/u.test(visible) || /(?:결제|구매|전체 해몽 보기|더 알아보세요|확인해보세요|살펴보세요)/u.test(visible);
}

export function paidCompositionV3Error(
  composition: PaidCompositionV3Content,
  dreamAndRealityEvidence: string,
  expectedPerspectiveRange: [number, number] = [2, 3]
): PaidCompositionV3ValidationIssue | null {
  if (composition.newPerspectives.length < expectedPerspectiveRange[0] || composition.newPerspectives.length > expectedPerspectiveRange[1]) return "AI_PAID_V3_DUPLICATE_PERSPECTIVE";
  if (sentenceCount(composition.bridge) < 2 || sentenceCount(composition.bridge) > 3) return "AI_PAID_V3_BRIDGE_SENTENCES";
  const bodyCount = paidCompositionV3VisibleBodyCharacterCount(composition);
  if (bodyCount < 900 || bodyCount > 1500) return "AI_PAID_V3_BODY_LENGTH";
  if ([...composition.bridge].length > bodyCount * 0.25) return "AI_PAID_V3_BRIDGE_DOMINATES";
  if (hasQuestionOrCta(composition)) return "AI_PAID_V3_CTA";
  if (!composition.finalIntegration.trim() || sentenceCount(composition.finalIntegration) !== 1) return "AI_PAID_V3_FINAL_INTEGRATION";

  const perspectiveKeys = composition.newPerspectives.map(item =>
    `${normalized(item.perspectiveLabel).toLocaleLowerCase()}|${item.evidenceQuotes.map(normalized).sort().join("|")}`
  );
  if (new Set(perspectiveKeys).size !== perspectiveKeys.length) return "AI_PAID_V3_DUPLICATE_PERSPECTIVE";

  const source = normalized(dreamAndRealityEvidence);
  if (allEvidence(composition).some(quote => !source.includes(normalized(quote)))) return "AI_PAID_V3_UNGROUNDED_EVIDENCE";
  return null;
}

export type PaidCompositionV3Review = {
  approved: boolean;
  findings: Array<{
    kind: "free_paraphrase" | "not_new_perspective" | "split_free_action" | "promise_mismatch" | "invented_fact";
    target: string;
    quote: string | null;
    explanation: string;
    requiredChange: string;
  }>;
};

export type PaidCompositionV3Adapter = {
  draft(): Promise<{ kind: "complete"; composition: PaidCompositionV3Content; provenance: Omit<PaidCompositionV3Payload, keyof PaidCompositionV3Content> } | { kind: "insufficient_grounded_material"; reasonCode: "INSUFFICIENT_GROUNDED_MATERIAL" }>;
  repair(composition: PaidCompositionV3Content, issues: string[], review: PaidCompositionV3Review): Promise<{ kind: "complete"; composition: PaidCompositionV3Content; provenance: Omit<PaidCompositionV3Payload, keyof PaidCompositionV3Content> } | { kind: "insufficient_grounded_material"; reasonCode: "INSUFFICIENT_GROUNDED_MATERIAL" }>;
  review(composition: PaidCompositionV3Content): Promise<PaidCompositionV3Review>;
};

export class PaidCompositionV3Error extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "PaidCompositionV3Error";
  }
}

export async function runPaidCompositionV3Pipeline(
  adapter: PaidCompositionV3Adapter,
  dreamAndRealityEvidence: string,
  maximumRepairs = 1,
  expectedPerspectiveRange: [number, number] = [2, 3]
): Promise<StagedPaidV3Result> {
  let draft = await adapter.draft();
  if (draft.kind === "insufficient_grounded_material") return draft;
  let composition = draft.composition;
  let provenance = draft.provenance;
  let review: PaidCompositionV3Review = { approved: false, findings: [] };

  for (let attempt = 0; attempt <= maximumRepairs; attempt += 1) {
    const issue = paidCompositionV3Error(composition, dreamAndRealityEvidence, expectedPerspectiveRange);
    review = issue ? { approved: false, findings: [] } : await adapter.review(composition);
    if (!issue && review.approved && review.findings.length === 0) {
      return {
        kind: "complete",
        composition: { ...composition, ...provenance },
        review: { approved: true }
      };
    }
    if (attempt === maximumRepairs) throw new PaidCompositionV3Error(issue ?? "AI_PAID_V3_REVIEW_FAILED");
    const repaired = await adapter.repair(composition, issue ? [issue] : [], review);
    if (repaired.kind === "insufficient_grounded_material") return repaired;
    composition = repaired.composition;
    provenance = repaired.provenance;
  }
  throw new PaidCompositionV3Error("AI_PAID_V3_REVIEW_FAILED");
}
