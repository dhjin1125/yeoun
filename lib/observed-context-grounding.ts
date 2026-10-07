import type { ClarificationAnswer, DreamContext, DreamScene, Emotion, GenerationUserEvidence } from "./types";
import { observedDreamText, splitDreamEvidence } from "./dream-evidence";

type SceneEvidence = { span: string };
const sceneEvidenceByObject = new WeakMap<object, SceneEvidence>();

/** Internal provenance only. The span is checked against raw user evidence before use. */
export function attachObservedSceneEvidence(scene: DreamScene, span: string) {
  sceneEvidenceByObject.set(scene, { span });
  return scene;
}

export function copyObservedSceneEvidence(source: DreamScene, target: DreamScene) {
  const evidence = sceneEvidenceByObject.get(source);
  if (evidence) sceneEvidenceByObject.set(target, evidence);
  return target;
}

export type ObservedContextViolationCode =
  | "OBSERVED_EMOTION_NOT_GROUNDED"
  | "OBSERVED_PLACE_NOT_GROUNDED"
  | "OBSERVED_PERSON_NOT_GROUNDED"
  | "OBSERVED_SCENE_ASSOCIATION_NOT_GROUNDED"
  | "OBSERVED_PROVENANCE_MISSING"
  | "OBSERVED_CORRECTION_STATE_AMBIGUOUS"
  | "OBSERVED_ASSERTION_AMBIGUOUS"
  | "OBSERVED_EMOTION_POLARITY_AMBIGUOUS";

export type ObservedContextViolation = { path: string; code: ObservedContextViolationCode };

export class ObservedContextViolationError extends Error {
  readonly code = "V3_OBSERVED_CONTEXT_UNGROUNDED";

  constructor(readonly issues: ObservedContextViolation[]) {
    super("Observed dream context could not be verified against explicit user evidence.");
    this.name = "ObservedContextViolationError";
  }
}

type EvidenceSource = { kind: "dream" | "clarification" | "role_clarification"; text: string };
type CorrectionCategory = "place" | "emotion" | "person";
type CorrectionAmbiguity = { answerIndex: number; category: CorrectionCategory; code: "OBSERVED_CORRECTION_STATE_AMBIGUOUS" | "OBSERVED_ASSERTION_AMBIGUOUS" };
type ClaimPolarity = "affirmed" | "negated" | "ambiguous";
type ObservedClaim = {
  normalizedValue: string;
  sourceType: "dream" | "clarification";
  evidenceSpan: string;
  polarity: ClaimPolarity;
  correctionState: "active" | "superseded" | "unresolved";
};

export type ObservedContextFailureDisposition = {
  status: "CONTEXT_PROTOCOL_FAILURE";
  protocolFailure: true;
  qualitySample: false;
  candidateProduced: false;
  errorCode: "V3_OBSERVED_CONTEXT_UNGROUNDED";
  issues: ObservedContextViolation[];
};

/** A Boundary B failure is a deterministic context protocol failure, never a quality sample. */
export function observedContextFailureDisposition(error: unknown): ObservedContextFailureDisposition | null {
  if (!(error instanceof ObservedContextViolationError)) return null;
  return {
    status: "CONTEXT_PROTOCOL_FAILURE",
    protocolFailure: true,
    qualitySample: false,
    candidateProduced: false,
    errorCode: error.code,
    issues: error.issues.map(issue => ({ path: issue.path, code: issue.code }))
  };
}

function dreamEvidencePart(text: string) {
  return splitDreamEvidence(text).dreamText.trim();
}

function activeDreamText(text: string) {
  return observedDreamText(dreamEvidencePart(text)).trim();
}

function labelRegex(pattern: string) {
  return new RegExp(pattern, "u");
}

const EMOTION_EVIDENCE: Record<string, RegExp> = {
  "두려움": labelRegex("무서|두렵|두려웠|겁나|공포|놀랐"),
  "기쁨": labelRegex("기쁘|기뻤|행복|좋았|좋은 시간|설렜|신났|반갑"),
  "찝찝함": labelRegex("찝찝|불쾌|꺼림칙|불편"),
  "불편함": labelRegex("안 좋|별로 좋.{0,12} 아니|좋지 않|기쁘지 않|행복하지 않|편안하지 않|안도하지 않|차분하지 않"),
  "슬픔": labelRegex("슬프|슬펐|울었|서러|그리웠|그리운|마음이\\s*무거"),
  "분노": labelRegex("화가|화난|분노|짜증|억울"),
  "낯섦": labelRegex("낯설|이상한\\s*(?:기분|느낌)|(?:기분|느낌|꿈|장면|분위기|모든\\s*것)(?:이|은|가)?\\s*이상"),
  "당황스러움": labelRegex("당황|당혹|난처"),
  "혼란스러움": labelRegex("혼란"),
  "불안": labelRegex("불안|걱정|초조"),
  "안도감": labelRegex("안도|편안|편하게|차분|마음이\\s*놓|답답.{0,12}풀|무사")
};

const EXPLICIT_EMOTION_WORD = /무서|두렵|두려웠|겁나|공포|놀랐|기쁘|기뻤|행복|좋았|설렜|신났|반갑|찝찝|불쾌|꺼림칙|불편|슬프|슬펐|울었|서러|그리웠|무거웠|화가|화난|분노|짜증|억울|낯설|이상|당황|당혹|난처|혼란|불안|걱정|초조|안도|편안|편하게|차분|마음이\s*놓|긴장|실망/;

function textClauses(text: string) {
  return text.split(/[.!?\n]+/).map(part => part.trim()).filter(Boolean);
}

function countNegationMarkers(text: string) {
  // Degree adverbs such as "전혀" and "결코" strengthen a negation but do
  // not create a second one. Keep double-negation ambiguity for actual
  // operators (e.g. "않 ... 못") only.
  // `없이` is a manner adverb (e.g. "말없이 건넸다"), not a negation of the
  // nearby observed fact. Count only predicate-like forms of `없다`.
  return text.match(/않|아니|없(?:었|는|을|다|음)|못|안\s/gu)?.length ?? 0;
}

function predicateLocalTail(text: string) {
  const maximumLength = 30;
  const tail = text.slice(0, maximumLength);
  const boundary = /[,，;；.!?…\n]|지만|으나|는데|은데|ㄴ데|다가|더니|면서|거나|그리고|그러나|하지만|그런데|고(?=\s|[,，.!?;；]|$)|며(?=\s|[,，.!?;；]|$)/u.exec(tail);
  return boundary ? tail.slice(0, boundary.index) : tail;
}

function claimPolarity(text: string, start: number, end: number): ClaimPolarity {
  const before = text.slice(Math.max(0, start - 16), start);
  const after = text.slice(end, end + 38);
  const predicateTail = predicateLocalTail(after);
  const markers = countNegationMarkers(predicateTail);
  const supportedDoubleNegation = /^\s*(?:(?:감|기분|느낌|마음)(?:은|는|이|가|을|를|도|만)?\s*)?(?:(?:하(?:지|진)|하지|지)\s*않(?:은|았|는)?\s*(?:건|것은|게)\s*아니)/u;
  const simpleNegation = /^\s*(?:(?:감|기분|느낌|마음|한|했던)(?:\s*(?:적|건|것))?(?:은|는|이|가|을|를|도|만)?\s*)?(?:(?:은|는|이|가|을|를|도|만)\s*)?(?:(?:전혀|별로|하나도)\s*)?(?:없(?:었|는|을|다)|(?:하(?:지(?:는|도)?|진)|하지|지(?:는|도)?)\s*않|[가-힣]{1,7}?지\s*않|않(?:았|는|을)|아니(?:었|라|고|에요|야|다)|아닌|못(?:\s*느끼|했)?|안\s*(?:느끼|하))/u;
  const complexNegationCue = /(?:않|아니|없(?:었|는|을|다|음)|못|안\s)/u.test(predicateTail);

  if (supportedDoubleNegation.test(predicateTail)) return "affirmed";
  if (/(?:안|못)\s*$/u.test(before)) {
    return markers > 0 || /(?:건|것은|게)\s*아니/u.test(predicateTail) ? "ambiguous" : "negated";
  }
  if (simpleNegation.test(predicateTail)) return markers > 1 ? "ambiguous" : "negated";
  if (complexNegationCue) return "ambiguous";
  return "affirmed";
}

function positiveClaimAt(text: string, start: number, end: number) {
  return claimPolarity(text, start, end) === "affirmed";
}

function makeObservedClaim(
  normalizedValue: string,
  source: EvidenceSource,
  clause: string,
  start: number,
  end: number,
  polarity: ClaimPolarity,
  correctionState: ObservedClaim["correctionState"]
): ObservedClaim {
  return {
    normalizedValue,
    sourceType: source.kind === "dream" ? "dream" : "clarification",
    evidenceSpan: clause.slice(start, Math.min(clause.length, end + 38)).trim(),
    polarity,
    correctionState
  };
}

function emotionClaims(value: string, source: EvidenceSource, correctionState: "active" | "superseded" | "unresolved" = "active"): ObservedClaim[] {
  const rule = EMOTION_EVIDENCE[value];
  if (!rule || source.kind === "role_clarification") return [];
  const claims: ObservedClaim[] = [];
  for (const clause of textClauses(source.text)) {
    const matcher = new RegExp(rule.source, "gu");
    for (const match of clause.matchAll(matcher)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      // A negated action on a house fixture (e.g. "현관문을 잠그지 않았다")
      // does not negate the place itself. The fixture is direct evidence that
      // the scene is at a home, while the negation belongs to the action.
      const fixtureAffirmsHome = value === "집" && /^(?:현관문|현관)/u.test(match[0]);
      const polarity = fixtureAffirmsHome ? "affirmed" : claimPolarity(clause, start, end);
      const claim = makeObservedClaim(value, source, clause, start, end, polarity, correctionState);
      if (claim.evidenceSpan && source.text.includes(claim.evidenceSpan)) claims.push(claim);
    }
  }
  return claims;
}

function emotionClaimState(value: string, sources: EvidenceSource[], superseded: boolean): ClaimPolarity | "absent" {
  return observedClaimState(sources.flatMap(source => emotionClaims(value, source, superseded ? "superseded" : "active")));
}

function observedClaimState(claims: ObservedClaim[]): ClaimPolarity | "absent" {
  const active = claims.filter(claim => claim.correctionState === "active" && claim.evidenceSpan.length > 0);
  if (active.some(claim => claim.polarity === "affirmed")) return "affirmed";
  if (active.some(claim => claim.polarity === "ambiguous")) return "ambiguous";
  return active.some(claim => claim.polarity === "negated") ? "negated" : "absent";
}

function hasSupportedEmotion(value: string, sourceText: string) {
  if (EMOTION_EVIDENCE[value]) return emotionClaimState(value, [{ kind: "dream", text: sourceText }], false) === "affirmed";
  const label = value.trim();
  if (!label || !EXPLICIT_EMOTION_WORD.test(label)) return false;
  for (const clause of textClauses(sourceText)) {
    let from = 0;
    while (from < clause.length) {
      const at = clause.indexOf(label, from);
      if (at < 0) break;
      if (positiveClaimAt(clause, at, at + label.length)) return true;
      from = at + label.length;
    }
  }
  return false;
}

function hasKoreanPlace(text: string, words: string, suffixes: string) {
  const matcher = new RegExp(`(?<![가-힣])(?:${words})(?:${suffixes})?(?![가-힣])`, "gu");
  for (const clause of textClauses(text)) {
    for (const match of clause.matchAll(matcher)) {
      const end = (match.index ?? 0) + match[0].length;
      const after = clause.slice(end, end + 30);
      if (/^\s*(?:은|는|이|가|을|를|도|만)?\s*(?:아니(?:었|라|고)?|아닌|없(?:었|는|다)|안\s*(?:나오|있|가|들어|머물)|(?:나오|있|가|들어|도착|머물|걸)지\s*않|못\s*(?:가|들어|도착))/u.test(after)) continue;
      return true;
    }
  }
  return false;
}

const LOCATION_ENDINGS = "(?:에서(?:는|도)?|으로(?:는|도)?|로(?:는|도)?|에(?:서는|서|는|도)?|까지|부터|위(?:에서|로|에)?|안(?:에서|으로|에)?|밖(?:에서|으로|에)?|옆(?:에서|으로|에)?|근처(?:에서|에)?|이었(?:어요|다)?|였(?:어요|다)?|인|을|를|이|가|은|는|만)?";
const HOME_WORDS = "집|아파트|현관문|현관";
const SCHOOL_WORDS = "학교|교실";
const WORK_WORDS = "회사|사무실";
const WATER_WORDS = "바다|강가|강물|강변|한강|낙동강|금강|영산강|섬진강|호수|강";
const NATURE_WORDS = "산|숲";
const PATH_WORDS = "도로|골목|산책로|길";
const HOSPITAL_WORDS = "병원";

function hasExplicitSchoolScenePredicate(clause: string) {
  return /(?:학교|교실)(?:에서(?:는|도)?|에(?:서는|서|는|도)?|로(?:는|도)?|까지|안에서|안에).{0,18}(?:있|도착|들어|갔|왔|돌아|나왔|나갔|머물|걸|뛰|앉|서\s*있|만났|봤|공부|수업|기다)/u.test(clause);
}

function hasExplicitWorkScenePredicate(clause: string) {
  return /(?:회사|사무실)(?:에서(?:는|도)?|에(?:서는|서|는|도)?|로(?:는|도)?|까지|안에서|안에).{0,22}(?:있|도착|들어|갔|왔|돌아|나왔|나갔|머물|일하|근무|출근|퇴근|만났|봤|기다)/u.test(clause);
}

function temporalOrBackgroundSchoolClause(clause: string) {
  const historical = /(?:학교|교실).{0,28}(?:다니던|다녔던|학창|시절|때|예전|옛날|당시)|(?:다니던|다녔던|학창|시절|때|예전|옛날|당시).{0,28}(?:학교|교실)/u.test(clause);
  return historical && !hasExplicitSchoolScenePredicate(clause);
}

function temporalOrBackgroundWorkClause(clause: string) {
  const historical = /(?:회사|사무실).{0,28}(?:다니던|다녔던|근무하던|일하던|시절|때|예전|옛날|당시)|(?:다니던|다녔던|근무하던|일하던|시절|때|예전|옛날|당시).{0,28}(?:회사|사무실)/u.test(clause);
  return historical && !hasExplicitWorkScenePredicate(clause);
}

function explicitPlaceMention(value: string, text: string) {
  const support = (clause: string) => {
    if (value === "집") return hasKoreanPlace(clause, HOME_WORDS, LOCATION_ENDINGS);
    if (value === "학교") return !temporalOrBackgroundSchoolClause(clause) && hasKoreanPlace(clause, SCHOOL_WORDS, LOCATION_ENDINGS);
    if (value === "일터") return !temporalOrBackgroundWorkClause(clause) && hasKoreanPlace(clause, WORK_WORDS, LOCATION_ENDINGS);
    if (value === "물가") return hasKoreanPlace(clause, WATER_WORDS, LOCATION_ENDINGS);
    if (value === "자연") return hasKoreanPlace(clause, NATURE_WORDS, LOCATION_ENDINGS);
    if (value === "길") return hasKoreanPlace(clause, PATH_WORDS, LOCATION_ENDINGS);
    if (value === "병원") return hasKoreanPlace(clause, HOSPITAL_WORDS, LOCATION_ENDINGS);
    return false;
  };
  return textClauses(text).some(support);
}

function placeClaims(value: string, source: EvidenceSource, correctionState: ObservedClaim["correctionState"] = "active"): ObservedClaim[] {
  if (source.kind === "role_clarification") return [];
  const words: Record<string, string> = {
    "집": HOME_WORDS, "학교": SCHOOL_WORDS, "일터": WORK_WORDS, "물가": WATER_WORDS,
    "자연": NATURE_WORDS, "길": PATH_WORDS, "병원": HOSPITAL_WORDS
  };
  const alternatives = words[value];
  if (!alternatives) return [];
  const matcher = new RegExp(`(?<![가-힣])(?:${alternatives})(?:${LOCATION_ENDINGS})?(?![가-힣])`, "gu");
  const claims: ObservedClaim[] = [];
  for (const clause of textClauses(source.text)) {
    if (value === "학교" && temporalOrBackgroundSchoolClause(clause)) continue;
    if (value === "일터" && temporalOrBackgroundWorkClause(clause)) continue;
    for (const match of clause.matchAll(matcher)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const claim = makeObservedClaim(value, source, clause, start, end, claimPolarity(clause, start, end), correctionState);
      if (claim.evidenceSpan && source.text.includes(claim.evidenceSpan)) claims.push(claim);
    }
  }
  return claims;
}

function placeClaimState(value: string, sources: EvidenceSource[], superseded: boolean): ClaimPolarity | "absent" {
  return observedClaimState(sources.flatMap(source => placeClaims(value, source, superseded ? "superseded" : "active")));
}

const PERSON_LABEL_EVIDENCE: Record<string, RegExp> = {
  "1번 인물": /(?:1\s*번|첫\s*번째)\s*(?:오빠|남자|사람)/u,
  "2번 인물": /(?:2\s*번|두\s*번째)\s*(?:오빠|남자|사람)/u,
  "얼굴이 보이지 않는 사람": /(?:얼굴(?:이|은)?\s*(?:안\s*보|보이지\s*않|없는)|정체를\s*알\s*수\s*없는)/u,
  "어머니": /엄마|어머니/u,
  "아버지": /아빠|아버지/u,
  "가족": /가족|식구/u,
  "친구·동료": /(?<!여자)(?<!남자)친구|동료/u,
  "가까운 관계": /남편|아내|배우자|연인|남친|여친/u,
  "연인으로 인식한 사람": /오빠|남자친구|여자친구/u,
  "정체가 모호한 사람": /누군가|낯선\s*(?:사람|남자|여자)|모르는\s*사람/u,
  "아이": /(?:(?<![가-힣])아이(?!스크림|디어|템|돌)|아기)/u,
  "가족 어른": /할머니|할아버지|조상/u
};

function hasSupportedPerson(value: string, sourceTexts: string[]) {
  return sourceTexts.some(text => personClaimState(value, [{ kind: "dream", text }], false) === "affirmed");
}

function personClaimPolarityAt(clause: string, start: number, end: number): ClaimPolarity {
  const after = clause.slice(end, end + 40);
  const personNegation = /^\s*(?:(?:은|는|이|가|을|를|도|만)\s*)?(?:(?:꿈(?:속)?(?:에서|에)?|거기서)\s*)?(?:안\s*(?:나오|나타나|등장|보이|오|있)|(?:나오|나타나|등장|보이|오)지\s*않|없(?:었|어|는|다)|아니(?:었|라|고)|아닌|존재하지\s*않|보지\s*못|못\s*(?:보|만나))/u;
  if (personNegation.test(after)) return "negated";
  return claimPolarity(clause, start, end);
}

function personClaims(value: string, source: EvidenceSource, correctionState: ObservedClaim["correctionState"] = "active"): ObservedClaim[] {
  const normalized = value.trim();
  const rule = PERSON_LABEL_EVIDENCE[value];
  const matcher = rule ?? (normalized ? new RegExp(normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u") : null);
  if (!matcher) return [];
  const claims: ObservedClaim[] = [];
  for (const clause of textClauses(source.text)) {
    const globalMatcher = new RegExp(matcher.source, `${matcher.flags.includes("u") ? "u" : ""}g`);
    for (const match of clause.matchAll(globalMatcher)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const claim = makeObservedClaim(value, source, clause, start, end, personClaimPolarityAt(clause, start, end), correctionState);
      if (claim.evidenceSpan && source.text.includes(claim.evidenceSpan)) claims.push(claim);
    }
  }
  return claims;
}

function personClaimState(value: string, sources: EvidenceSource[], superseded: boolean): ClaimPolarity | "absent" {
  return observedClaimState(sources.flatMap(source => personClaims(value, source, superseded ? "superseded" : "active")));
}

function correctionClaimPolarity(category: CorrectionCategory, label: string, text: string): ClaimPolarity | "absent" {
  const source: EvidenceSource = { kind: "clarification", text };
  if (category === "place") return placeClaimState(label, [source], false);
  if (category === "emotion") return emotionClaimState(label, [source], false);
  return personClaimState(label, [source], false);
}

function emotionLabelForSelection(emotion: Emotion | null) {
  if (!emotion) return null;
  const labels: Partial<Record<Emotion, string>> = {
    "무서웠어요": "두려움",
    "기분 좋았어요": "기쁨",
    "찝찝했어요": "찝찝함",
    "이상했어요": "낯섦"
  };
  return labels[emotion] ?? null;
}

function supportedLabels(category: CorrectionAmbiguity["category"], text: string) {
  if (category === "place") return ["집", "학교", "일터", "물가", "자연", "길", "병원"].filter(label => explicitPlaceMention(label, text));
  if (category === "emotion") return Object.keys(EMOTION_EVIDENCE).filter(label => hasSupportedEmotion(label, text));
  return Object.keys(PERSON_LABEL_EVIDENCE).filter(label => hasSupportedPerson(label, [text]));
}

function sourcesFor(rawDream: string, answers: ClarificationAnswer[]) {
  let activeDream = activeDreamText(rawDream);
  const dreamSources: EvidenceSource[] = activeDream ? [{ kind: "dream", text: activeDream }] : [];
  const roleSources: EvidenceSource[] = [];
  const ambiguousCorrections = new Map<CorrectionCategory, CorrectionAmbiguity>();
  const retiredLabels: Record<CorrectionCategory, Set<string>> = {
    place: new Set(), emotion: new Set(), person: new Set()
  };
  const activeLabels = (category: CorrectionCategory, text: string) =>
    supportedLabels(category, text).filter(label => !retiredLabels[category].has(label));
  const correctionIntent = (answer: ClarificationAnswer) => answer.questionId.startsWith("correction-")
    || /^\s*(?:아니(?:[,，]|\s)|정정|정확히(?:는|하면)?)/u.test(answer.answer ?? "")
    || /[가-힣](?:이|가|은|는)?\s*아니라/u.test(answer.answer ?? "");

  answers.forEach((answer, answerIndex) => {
    if (answer.skipped || !answer.answer?.trim()) return;
    const answerText = answer.answer.trim();
    if (answer.kind === "scene" || answer.kind === "emotion") {
      const answerDream = dreamEvidencePart(answerText);
      if (!answerDream) return;
      const answerActive = observedDreamText(answerDream).trim();
      if (answerActive) dreamSources.push({ kind: "clarification", text: answerActive });
      const nextActive = observedDreamText(activeDream ? `${activeDream}. ${answerDream}` : answerDream).trim();
      if (correctionIntent(answer)) {
        const categories: CorrectionCategory[] = answer.kind === "emotion" ? ["emotion"] : ["place", "emotion", "person"];
        for (const category of categories) {
          const priorLabels = activeLabels(category, activeDream);
          const correctionLabels = supportedLabels(category, answerActive);
          const claimStates = priorLabels.map(label => ({ label, polarity: correctionClaimPolarity(category, label, answerText) }));
          const invalidatedLabels = claimStates.filter(item => item.polarity === "negated" && !correctionLabels.includes(item.label)).map(item => item.label);
          const ambiguousInvalidation = claimStates.some(item => item.polarity === "ambiguous" && !correctionLabels.includes(item.label));
          for (const label of invalidatedLabels) retiredLabels[category].add(label);
          for (const label of correctionLabels) retiredLabels[category].delete(label);
          const nextLabels = activeLabels(category, nextActive);
          const oldClaimRemains = priorLabels.some(label => !invalidatedLabels.includes(label) && !correctionLabels.includes(label) && nextLabels.includes(label));
          const replacementIntroduced = correctionLabels.some(label => !priorLabels.includes(label));
          if (ambiguousInvalidation) {
            ambiguousCorrections.set(category, { answerIndex, category, code: "OBSERVED_ASSERTION_AMBIGUOUS" });
          } else if ((invalidatedLabels.length > 0 && !replacementIntroduced) || (oldClaimRemains && replacementIntroduced)) {
            if (oldClaimRemains && replacementIntroduced) {
              for (const label of priorLabels) retiredLabels[category].add(label);
            }
            ambiguousCorrections.set(category, { answerIndex, category, code: "OBSERVED_CORRECTION_STATE_AMBIGUOUS" });
          } else if (correctionLabels.length > 0 && !oldClaimRemains) {
            ambiguousCorrections.delete(category);
          }
        }
      }
      activeDream = nextActive;
      return;
    }
    if (answer.kind === "relationship" || answer.kind === "dreamer") {
      roleSources.push({ kind: "role_clarification", text: answerText });
    }
  });

  return {
    dreamSources,
    personEvidenceSources: [...dreamSources, ...roleSources],
    ambiguousCorrections: [...ambiguousCorrections.values()],
    retiredLabels
  };
}

/** Apply only explicit V3 correction supersession before the independent gate. */
export function applyObservedCorrectionState(context: DreamContext, evidence: { rawDream: string; userEvidence: GenerationUserEvidence }) {
  const { retiredLabels } = sourcesFor(evidence.rawDream, evidence.userEvidence.clarificationAnswers);
  if (!Object.values(retiredLabels).some(labels => labels.size > 0)) return context;

  context.places = context.places.filter(value => !retiredLabels.place.has(value));
  context.emotions = context.emotions.filter(value => !retiredLabels.emotion.has(value));
  context.people = context.people.filter(value => !retiredLabels.person.has(value));
  for (const scene of context.scenes) {
    if (scene.place !== null && retiredLabels.place.has(scene.place)) scene.place = null;
    if (scene.emotion !== null && retiredLabels.emotion.has(scene.emotion)) scene.emotion = null;
    scene.people = scene.people.filter(value => !retiredLabels.person.has(value));
  }
  if (context.relationshipToUser && retiredLabels.person.has(context.relationshipToUser)) context.relationshipToUser = null;
  if (context.dreamerDescription && retiredLabels.person.has(context.dreamerDescription)) context.dreamerDescription = null;
  return context;
}

/**
 * Verifies observed fields against active user evidence without re-running the
 * extractor. A scene span is private in-memory provenance, not a public type.
 */
export function assertObservedContextGrounded(
  context: DreamContext,
  evidence: { rawDream: string; userEvidence: GenerationUserEvidence }
) {
  const { dreamSources, personEvidenceSources, ambiguousCorrections, retiredLabels } = sourcesFor(evidence.rawDream, evidence.userEvidence.clarificationAnswers);
  const issues: ObservedContextViolation[] = [];
  const add = (path: string, code: ObservedContextViolationCode) => issues.push({ path, code });

  for (const correction of ambiguousCorrections) {
    add(`clarificationAnswers[${correction.answerIndex}]`, correction.code);
  }

  const selectedLabel = emotionLabelForSelection(evidence.userEvidence.selectedEmotion);
  for (const [index, value] of context.emotions.entries()) {
    const supportedByMetadata = value === selectedLabel;
    const state = emotionClaimState(value, dreamSources, retiredLabels.emotion.has(value));
    if (!supportedByMetadata && state === "ambiguous") add(`emotions[${index}]`, "OBSERVED_EMOTION_POLARITY_AMBIGUOUS");
    else if (!supportedByMetadata && state !== "affirmed") add(`emotions[${index}]`, "OBSERVED_EMOTION_NOT_GROUNDED");
  }

  for (const [index, value] of context.places.entries()) {
    const state = placeClaimState(value, dreamSources, retiredLabels.place.has(value));
    if (state === "ambiguous") add(`places[${index}]`, "OBSERVED_ASSERTION_AMBIGUOUS");
    else if (state !== "affirmed") add(`places[${index}]`, "OBSERVED_PLACE_NOT_GROUNDED");
  }

  for (const [index, value] of context.people.entries()) {
    const state = personClaimState(value, personEvidenceSources, retiredLabels.person.has(value));
    if (state === "ambiguous") add(`people[${index}]`, "OBSERVED_ASSERTION_AMBIGUOUS");
    else if (state !== "affirmed") add(`people[${index}]`, "OBSERVED_PERSON_NOT_GROUNDED");
  }

  for (const [index, scene] of context.scenes.entries()) {
    const source = sceneEvidenceByObject.get(scene)?.span;
    const sourceEvidence = source ? dreamSources.find(candidate => candidate.text.includes(source)) : undefined;
    const sourceIsExplicit = Boolean(sourceEvidence);
    const sceneHasObservedFacts = scene.place !== null || scene.emotion !== null || scene.people.length > 0;
    if (sceneHasObservedFacts && !source) {
      add(`scenes[${index}]`, "OBSERVED_PROVENANCE_MISSING");
      continue;
    }
    if (scene.place !== null) {
      if (!sourceIsExplicit) {
        add(`scenes[${index}].place`, "OBSERVED_SCENE_ASSOCIATION_NOT_GROUNDED");
      } else {
        const sceneSources: EvidenceSource[] = [{ kind: sourceEvidence!.kind, text: source! }];
        const state = placeClaimState(scene.place, sceneSources, retiredLabels.place.has(scene.place));
        if (state === "ambiguous") add(`scenes[${index}].place`, "OBSERVED_ASSERTION_AMBIGUOUS");
        else if (state !== "affirmed") {
          const existsElsewhere = !retiredLabels.place.has(scene.place) && placeClaimState(scene.place, dreamSources, false) === "affirmed";
          add(`scenes[${index}].place`, existsElsewhere ? "OBSERVED_SCENE_ASSOCIATION_NOT_GROUNDED" : "OBSERVED_PLACE_NOT_GROUNDED");
        }
      }
    }
    if (scene.emotion !== null) {
      const sourceState = sourceEvidence
        ? emotionClaimState(scene.emotion, [{ kind: sourceEvidence.kind, text: source! }], retiredLabels.emotion.has(scene.emotion))
        : "absent";
      if (sourceIsExplicit && !retiredLabels.emotion.has(scene.emotion) && sourceState === "ambiguous") {
        add(`scenes[${index}].emotion`, "OBSERVED_EMOTION_POLARITY_AMBIGUOUS");
      } else if (!sourceIsExplicit || retiredLabels.emotion.has(scene.emotion) || sourceState !== "affirmed") {
        if (!sourceIsExplicit) add(`scenes[${index}].emotion`, "OBSERVED_SCENE_ASSOCIATION_NOT_GROUNDED");
        else {
          const existsElsewhere = (!retiredLabels.emotion.has(scene.emotion!) && emotionClaimState(scene.emotion!, dreamSources, false) === "affirmed") || scene.emotion === selectedLabel;
          add(`scenes[${index}].emotion`, existsElsewhere ? "OBSERVED_SCENE_ASSOCIATION_NOT_GROUNDED" : "OBSERVED_EMOTION_NOT_GROUNDED");
        }
      }
    }
    for (const [personIndex, person] of scene.people.entries()) {
      if (!sourceIsExplicit) {
        add(`scenes[${index}].people[${personIndex}]`, "OBSERVED_SCENE_ASSOCIATION_NOT_GROUNDED");
      } else {
        const sceneSources: EvidenceSource[] = [{ kind: sourceEvidence!.kind, text: source! }];
        const state = personClaimState(person, sceneSources, retiredLabels.person.has(person));
        if (state === "ambiguous") add(`scenes[${index}].people[${personIndex}]`, "OBSERVED_ASSERTION_AMBIGUOUS");
        else if (state !== "affirmed") add(`scenes[${index}].people[${personIndex}]`, "OBSERVED_PERSON_NOT_GROUNDED");
      }
    }
  }

  if (context.relationshipToUser) {
    const state = personClaimState(context.relationshipToUser, personEvidenceSources, retiredLabels.person.has(context.relationshipToUser));
    if (state === "ambiguous") add("relationshipToUser", "OBSERVED_ASSERTION_AMBIGUOUS");
    else if (state !== "affirmed") add("relationshipToUser", "OBSERVED_PERSON_NOT_GROUNDED");
  }
  if (context.dreamer === "someone_else" && context.dreamerDescription) {
    const state = personClaimState(context.dreamerDescription, personEvidenceSources, retiredLabels.person.has(context.dreamerDescription));
    if (state === "ambiguous") add("dreamerDescription", "OBSERVED_ASSERTION_AMBIGUOUS");
    else if (state !== "affirmed") add("dreamerDescription", "OBSERVED_PERSON_NOT_GROUNDED");
  }

  // The extractor may intentionally omit unsupported polarity. Still fail
  // closed when raw active evidence contains an ambiguous supported emotion
  // claim that did not become an observed context field.
  const representedEmotions = new Set([
    ...context.emotions,
    ...context.scenes.flatMap(scene => scene.emotion ? [scene.emotion] : [])
  ]);
  for (const value of Object.keys(EMOTION_EVIDENCE)) {
    if (retiredLabels.emotion.has(value) || representedEmotions.has(value)) continue;
    if (emotionClaimState(value, dreamSources, false) === "ambiguous") {
      add(`evidence.emotions[${value}]`, "OBSERVED_EMOTION_POLARITY_AMBIGUOUS");
    }
  }

  if (issues.length) throw new ObservedContextViolationError(issues);
}

/** Run a successful-artifact writer only after the independent gate passes. */
export function archiveObservedContextIfGrounded<T>(
  context: DreamContext,
  evidence: { rawDream: string; userEvidence: GenerationUserEvidence },
  archivePreparedContext: () => T
): T {
  const correctedContext = applyObservedCorrectionState(context, evidence);
  assertObservedContextGrounded(correctedContext, evidence);
  return archivePreparedContext();
}
