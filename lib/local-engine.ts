import { classifySafetyRoute, detectSafetyNotice } from "./safety";
import { extractSymbols } from "./symbols";
import { culturalReferencesForDream, referenceMatchesSymbol, resolveReadingSources } from "./cultural-references";
import { splitDreamEvidence, observedDreamText, emotionEvidence, unquotedText, isDreamCorrection } from "./dream-evidence";
import {
  interpretationQuestionForFocus,
  type InterpretationFocus
} from "./interpretation-focus";
import type {
  ClarificationAnswer,
  ClarificationQuestion,
  AssistantTurnPayload,
  AnswerGenerationSource,
  DreamContext,
  DreamScene,
  DreamStructure,
  Emotion,
  FreeReading,
  PaidOffer,
  PaidPreview,
  PaidReport,
  SafetyNotice,
  SafetyRoute,
  SignalDirection
} from "./types";
import { attachObservedSceneEvidence, copyObservedSceneEvidence } from "./observed-context-grounding";

const STRANGENESS_EMOTION_PATTERN =
  /(?:낯설|이상한\s*(?:기분|느낌)|(?:뭔가|왠지|모든\s*게)\s*이상|(?:기분|느낌|꿈|장면|분위기|모든\s*것)(?:이|은|가)?\s*이상(?:했|해|한|하다고|하게)|(?:^|[.!?]\s*)(?:그냥\s*)?이상(?:했|하다고\s*느))/;
const EMBARRASSMENT_EMOTION_PATTERN = /(?:당황|당혹|난처)/;
const CONFUSION_EMOTION_PATTERN = /혼란/;

// Keep extraction independent from the observed-context validator. These
// narrow guards suppress only an explicitly negated occurrence of the same
// emotion; negation elsewhere in the sentence must not erase a positive one.
const NEGATED_EMOTION_MENTION: Record<string, RegExp> = {
  "두려움": /(?:안\s*(?:무서|두렵)|(?:무섭|두렵)(?:지(?:는|도)?|진)\s*않)/u,
  "기쁨": /(?:(?:기쁘|행복|좋|설레|신나|반갑)(?:지(?:는|도)?|진)\s*않)|(?:안\s*좋|별로\s*좋.{0,12}아니)/u,
  "슬픔": /(?:슬프|서럽|그립)(?:지(?:는|도)?|진)\s*않/u,
  "분노": /(?:화(?:가\s*)?나|짜증(?:이\s*)?나|억울)(?:지(?:는|도)?|진)\s*않/u,
  "낯섦": /(?:낯설|이상하)(?:지(?:는|도)?|진)\s*않/u,
  "당황스러움": /당황(?:하(?:지(?:는|도)?|진)|지(?:는|도)?)\s*않/u,
  "혼란스러움": /혼란스럽?(?:지(?:는|도)?|진)\s*않/u,
  "불안": /(?:불안(?:감)?(?:은|는|이|가|도|만)?\s*(?:(?:전혀|결코)\s*)?(?:없|아니)|(?:불안|걱정|초조)(?:하(?:지(?:는|도)?|진)|지(?:는|도)?)\s*않)/u,
  "안도감": /(?:안도|편안|차분)(?:하지(?:는|도)?|하지|지(?:는|도)?)\s*않|마음이\s*놓이(?:지(?:는|도)?|진)\s*않/u
};

function hasOnlyExplicitlyNegatedEmotionMentions(text: string, label: string) {
  const negativeMention = NEGATED_EMOTION_MENTION[label];
  if (!negativeMention?.test(text)) return false;
  const positivePattern = EMOTION_PATTERNS.find(([, candidate]) => candidate === label)?.[0];
  if (!positivePattern) return false;
  const withoutExplicitNegatives = text.replace(new RegExp(negativeMention.source, "gu"), " ");
  return !positivePattern.test(withoutExplicitNegatives);
}

const EMOTION_PATTERNS: Array<[RegExp, string]> = [
  [/(?<!안\s)(?<!안)(?:무서(?!운\s*게\s*아니)|두려(?!운\s*게\s*아니)|겁나|공포|놀랐)/, "두려움"],
  [/(?:안\s*좋|별로\s*좋.{0,12}아니|좋지\s*않|기쁘지\s*않|행복하지\s*않|편안하지\s*않|안도하지\s*않|차분하지\s*않)/, "불편함"],
  [/(?:기쁘(?!지\s*않)|기뻤|행복(?!하지\s*않)|(?<!안\s)(?<!안)(?<!별로\s)좋았|좋은\s*시간|설렜|신났|반갑)/, "기쁨"],
  [/(?:찝찝|불쾌|꺼림칙|불편)/, "찝찝함"],
  [/(?:슬프|슬펐|울었|서러|그리웠|그리운|마음이\s*무거)/, "슬픔"],
  [/(?:화가|분노|짜증|억울)/, "분노"],
  [EMBARRASSMENT_EMOTION_PATTERN, "당황스러움"],
  [CONFUSION_EMOTION_PATTERN, "혼란스러움"],
  [STRANGENESS_EMOTION_PATTERN, "낯섦"],
  [/(?:불안|걱정|초조)/, "불안"],
  [/(?:안도(?!하지\s*않)|편안(?!하지\s*않)|편하게|차분(?!하지\s*않)|마음이\s*놓|답답.{0,12}풀|무사)/, "안도감"]
];

const PEOPLE_PATTERNS: Array<[RegExp, string]> = [
  [/(?:1\s*번|첫\s*번째)\s*(?:오빠|남자|사람)/, "1번 인물"],
  [/(?:2\s*번|두\s*번째)\s*(?:오빠|남자|사람)/, "2번 인물"],
  [/(?:얼굴(?:이|은)?\s*(?:안\s*보|보이지\s*않|없는)|정체를\s*알\s*수\s*없는)/, "얼굴이 보이지 않는 사람"],
  [/(?:엄마|어머니)/, "어머니"],
  [/(?:아빠|아버지)/, "아버지"],
  [/(?:가족|식구)/, "가족"],
  [/(?:(?<!여자)(?<!남자)친구|동료)/, "친구·동료"],
  [/(?:남편|아내|배우자|연인|남친|여친)/, "가까운 관계"],
  [/(?:오빠|남자친구|여자친구)/, "연인으로 인식한 사람"],
  [/(?:누군가|낯선\s*(?:사람|남자|여자)|모르는\s*사람)/, "정체가 모호한 사람"],
  [/(?:(?<![가-힣])아이(?!스크림|디어|템|돌)|아기)/, "아이"],
  [/(?:할머니|할아버지|조상)/, "가족 어른"]
];

const LOCATION_SUFFIX = "(?:에서(?:는|도)?|으로(?:는|도)?|로(?:는|도)?|에(?:서는|서|는|도)?|까지|부터|위(?:에서|로|에)?|안(?:에서|으로|에)?|밖(?:에서|으로|에)?|옆(?:에서|으로|에)?|근처(?:에서|에)?|이었(?:어요|다)?|였(?:어요|다)?|인|을|를|이|가|은|는|만)?";
function lexicalLocation(terms: string) {
  return new RegExp(`(?<![가-힣])(?:${terms})${LOCATION_SUFFIX}(?![가-힣])`, "u");
}

const PLACE_PATTERNS: Array<[RegExp, string]> = [
  [lexicalLocation("아파트|현관문|현관|집"), "집"],
  [lexicalLocation("학교|교실"), "학교"],
  [lexicalLocation("회사(?:\\s*복도)?|사무실"), "일터"],
  [lexicalLocation("바다|강가|강물|강변|한강|낙동강|금강|영산강|섬진강|호수|강"), "물가"],
  [lexicalLocation("산|숲"), "자연"],
  [lexicalLocation("도로|골목|산책로|길"), "길"],
  [lexicalLocation("병원"), "병원"]
];

const ACTION_PATTERNS: Array<[RegExp, string]> = [
  [/(?:때렸|때리(?:고|는|다가)|폭행했)/, "때림"],
  [/(?:맞았|맞고|맞는|폭행당)/, "맞음"],
  [/(?:올라갔|올라가(?:고|는)|상승했)/, "올라감"],
  [/(?:내려갔|내려가(?:고|는)|하강했)/, "내려감"],
  [/피(?:가)?\s*(?:나왔|나오(?:고|는)|났|나는|나고)/, "피가 남"],
  [/(?:좋은\s*시간을?\s*(?:보내|보냈|보낸)|즐거운\s*시간을?\s*(?:보내|보냈|보낸)|함께\s*즐겁게)/, "함께 좋은 시간을 보냄"],
  [/(?:같은\s*사람|(?:나|저)인\s*줄|남친인\s*줄|오빠인\s*줄|그\s*사람인\s*줄|착각)/, "같은 사람이라고 믿음"],
  [/(?:얼굴(?:이|은)?\s*(?:안\s*보|보이지\s*않|없는))/, "얼굴을 확인하지 못함"],
  [/(?:알고\s*보니|생각해\s*보니).{0,24}(?:아니|다른)/, "다른 사람임을 알아차림"],
  [/(?:새벽\s*1\s*시|늦은\s*밤|맨날\s*새벽).{0,24}(?:들어오|귀가)/, "늦은 귀가가 반복됨"],
  [/(?:화(?:를)?\s*내|소리\s*지르|폭언)/, "화를 마주함"],
  [/(?:말(?:을|도)?\s*(?:안|않)\s*(?:듣|들어)|대화가\s*안\s*통)/, "말이 닿지 않음"],
  [/(?:가족|식구).{0,16}(?:다\s*(?:있|잇)|모여|함께)/, "가족과 함께 있음"],
  [/(?:좀비|괴물).{0,24}(?:공격|달려들|쫓아|물)/, "좀비 공격의 위험을 마주함"],
  [/(?:문|출구).{0,12}(?:찾다가|찾고|찾았).{0,28}(?:밖|바깥).{0,12}(?:나오|나왔|나갔)/, "출구를 찾아 밖으로 나감"],
  [/(?:높은\s*곳|위층|옥상).{0,20}(?:이동|올라)/, "안전한 곳으로 이동함"],
  [/(?:손을?\s*잡고).{0,24}(?:걷|걸)/, "손을 잡고 함께 걸음"],
  [/(?:문을?\s*열).{0,30}(?:안으로\s*들어|들였|받아들)/, "문을 열어 안으로 받아들임"],
  [/(?:우산|도움|손).{0,18}(?:건네|내밀어|도와)/, "도움을 받음"],
  [/(?:(?:길|거리|복도|골목|산책로|숲길|강변|해변)(?:을|를|에서)\s*(?:걸었|걸으며|걸어(?:갔|가|오|왔|다녔))|(?:천천히|계속|한참|함께|같이|혼자)\s*(?:걸었|걸으며|걸어(?:갔|가|오|왔|다녔))|걸어(?:갔|왔|다녔)|걷고|걷다가|걷는|걸음을\s*(?:옮|재촉))/, "걸어감"],
  [/(?:문|창문|서랍)(?:을|를)?\s*열(?:었|고|며|어|기)/, "문을 엶"],
  [/(?:꼭\s*)?(?:쥐고|쥐었|들고\s*있)/, "무언가를 쥠"],
  [/(?:함께|같이).{0,12}(?:걸어|걷|이동)/, "함께 이동함"],
  [/(?:멀리\s*(?:걸어|가버|떠나)|점점\s*멀어)/, "상대가 멀어짐"],
  [/(?:달렸|도망(?!치지|가지)|쫓겼)/, "달아남"],
  [/(?:떨어졌|떨어질|떨어지는|추락)/, "떨어짐"],
  [/(?:날았|날아)/, "날아오름"],
  [/(?:계속.{0,12})?찾다가|찾아다(?:녔|니|님)/, "찾아다님"],
  [/(?:찾았|발견)/, "발견함"],
  [/(?:잃어버|잃었|잃고|길을\s*잃)/, "잃어버림"],
  [/(?:싸웠|다퉜)/, "맞섬"],
  [/(?:숨었|숨는|숨고)/, "숨음"],
  [/(?:잡았|잡고|잡아|붙잡(?!지\s*않))/, "붙잡음"],
  [/(?:바라봤|바라보|지켜봤|지켜보)/, "바라봄"],
  [/(?:내보냈|내보내|밖으로\s*보냈)/, "밖으로 내보냄"],
  [/(?:울었|울고|울어)/, "울음"],
  [/(?:웃었|웃고|웃으며)/, "웃음"],
  [/(?:함께|같이).{0,12}(?:앉았|머물|있었)/, "함께 머묾"]
];

function collect(text: string, rules: Array<[RegExp, string]>, normalizeObservedEmotions = true) {
  const observedEmotion = rules === EMOTION_PATTERNS;
  text = observedEmotion && normalizeObservedEmotions ? emotionEvidence(text) : text;
  return rules
    .map(([pattern, label]) => ({ index: text.search(pattern), label }))
    .filter((match) => match.index >= 0)
    .sort((left, right) => left.index - right.index)
    .map((match) => match.label)
    .filter((label) => !observedEmotion || !hasOnlyExplicitlyNegatedEmotionMentions(text, label));
}

/** V3-only raw-evidence fallback; V2 keeps the legacy emotion normalization path. */
export function extractObservedEmotionsFromRawDream(dream: string) {
  const evidence = splitDreamEvidence(dream);
  const observed = observedDreamText(evidence.dreamText);
  return collect(observed, EMOTION_PATTERNS, false);
}

function collectPlaces(text: string) {
  const matches = PLACE_PATTERNS.flatMap(([pattern, label]) =>
    [...text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))].map(match => ({ index: match.index ?? -1, label }))
  );
  return matches
    .filter(({ index }) => index >= 0)
    .filter(({ index, label }) => {
      if (label !== "학교" && label !== "일터") return true;
      const start = Math.max(text.lastIndexOf(".", index), text.lastIndexOf("!", index), text.lastIndexOf("?", index), text.lastIndexOf("\n", index)) + 1;
      const stops = [".", "!", "?", "\n"].map(mark => text.indexOf(mark, index)).filter(value => value >= 0);
      const end = stops.length ? Math.min(...stops) : text.length;
      const clause = text.slice(start, end);
      const historicalReference = /(?:다니던|다녔던|학창\s*시절|시절|때|예전|옛날|당시)/u.test(clause);
      if (!historicalReference) return true;
      const terms = label === "학교" ? "학교|교실" : "회사|사무실";
      const explicitScenePredicate = new RegExp(`(?:${terms})(?:에서(?:는|도)?|에(?:서는|서|는|도)?|로(?:는|도)?|까지|안에서|안에).{0,18}(?:있|도착|들어|갔|왔|돌아|나왔|나갔|머물|걸|뛰|앉|서\\s*있|만났|봤|공부|수업|기다)`, "u").test(clause);
      return explicitScenePredicate;
    })
    .sort((left, right) => left.index - right.index)
    .map(({ label }) => label)
    .filter((label, index, values) => values.indexOf(label) === index);
}

function selectedEmotionLabel(emotion: Emotion | null) {
  const labels: Record<Emotion, string | null> = {
    "무서웠어요": "두려움",
    "기분 좋았어요": "기쁨",
    "찝찝했어요": "찝찝함",
    "이상했어요": "낯섦",
    "잘 모르겠어요": null
  };
  return emotion ? labels[emotion] : null;
}

function unique(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function question(id: string, kind: ClarificationQuestion["kind"], prompt: string, placeholder: string) {
  return { id, kind, prompt, options: [], placeholder } satisfies ClarificationQuestion;
}

export function analyzeDreamLocally(dream: string, selectedEmotion: Emotion | null) {
  const emotions = unique([selectedEmotionLabel(selectedEmotion), ...collect(dream, EMOTION_PATTERNS)]);
  const structure: DreamStructure = {
    people: collect(dream, PEOPLE_PATTERNS),
    actions: collect(dream, ACTION_PATTERNS).slice(0, 1),
    places: collectPlaces(dream),
    emotions,
    symbols: extractSymbols(dream),
    recentContext: null,
    isRecurring: /(?:반복|또\s*같은|자주\s*꾸|계속\s*나오)/.test(dream),
    uncertainty: []
  };

  const safetyNotice = detectSafetyNotice(dream);
  if (safetyNotice) return { structure, questions: [], safetyNotice };

  const questions: ClarificationQuestion[] = [];
  const hasConcreteScene = structure.actions.length > 0 || dream.length >= 55;
  if (!hasConcreteScene) {
    questions.push(
      question(
        "scene",
        "scene",
        "지금 떠오르는 한 조각만 더 적어볼까요?",
        "예: 창문 밖에 누군가 서 있었어요"
      )
    );
  }

  if (emotions.length === 0 && questions.length === 0) {
    questions.push(
      question(
        "emotion",
        "emotion",
        "깨고 난 뒤, 몸이나 마음에 남은 느낌이 있었나요?",
        "예: 이유 없이 답답했어요"
      )
    );
  }

  const identityAlreadyDescribed = /(?:얼굴(?:이|은)?\s*(?:안\s*보|보이지\s*않|없는)|알고\s*보니.{0,20}(?:아니|다른))/.test(dream);
  if (
    structure.people.some((person) => /정체가 모호한|얼굴이 보이지 않는/.test(person)) &&
    !identityAlreadyDescribed &&
    questions.length === 0
  ) {
    questions.push(
      question(
        "relationship",
        "relationship",
        "그 사람이 누구처럼 느껴졌는지 떠오르는 만큼만 알려주세요.",
        "예: 얼굴은 달랐지만 친구처럼 느껴졌어요"
      )
    );
  }

  return { structure, questions: questions.slice(0, 1), safetyNotice: null as SafetyNotice | null };
}

export function applyClarifications(structure: DreamStructure, answers: ClarificationAnswer[]) {
  const next: DreamStructure = {
    ...structure,
    people: [...structure.people],
    actions: [...structure.actions],
    emotions: [...structure.emotions],
    uncertainty: [...structure.uncertainty]
  };

  for (const item of answers) {
    if (item.skipped || !item.answer) {
      next.uncertainty.push(item.kind);
      continue;
    }
    if (item.kind === "emotion") next.emotions = unique([...next.emotions, item.answer]);
    if (item.kind === "scene") next.actions = unique([...next.actions, item.answer]);
    if (item.kind === "relationship") next.people = unique([...next.people, item.answer]);
    if (item.kind === "recent_context") next.recentContext = item.answer;
  }
  return next;
}

function signalDirections(structure: DreamStructure): SignalDirection[] {
  const directions: SignalDirection[] = ["심리 반영"];
  if (structure.emotions.some((emotion) => /기쁨|설렘|평온/.test(emotion))) directions.unshift("긍정 신호");
  if (
    structure.emotions.some((emotion) => /두려움|찝찝|분노|슬픔/.test(emotion)) ||
    structure.actions.some((action) => /달아|떨어|숨/.test(action))
  ) {
    directions.unshift("주의 신호");
  }
  return unique(directions).slice(0, 2) as SignalDirection[];
}

function normalizedFeelingLabel(value: string | null | undefined) {
  if (!value) return "꿈에서 남은 느낌";
  const trimmed = value.trim();
  const clean = trimmed.replace(/[.!?。！？]+$/g, "");
  const labels: Array<[RegExp, string]> = [
    [/(?:무서|두려)/, "두려움"],
    [/(?:불안|초조|긴장)/, "불안"],
    [/(?:답답|숨\s*(?:이\s*)?차)/, "답답함"],
    [/(?:찝찝|꺼림)/, "찝찝함"],
    [/(?:슬프|슬펐|서럽|눈물)/, "슬픔"],
    [/(?:화가|화났|분노|짜증)/, "분노"],
    [/(?:안\s*좋|별로\s*좋.{0,12}아니|좋지\s*않|기쁘지\s*않|행복하지\s*않|편안하지\s*않|안도하지\s*않|차분하지\s*않)/, "불편함"],
    [/(?:기쁘|기뻤|좋았|행복|신나)/, "기쁨"],
    [/(?:안도|차분|편안|평온)/, "안도감"],
    [/(?:그립|그리운|그리웠)/, "그리움"],
    [/(?:놀라|놀랐|당황)/, "놀람"],
    [/(?:낯설|당황|혼란|이상)/, "낯섦"],
    [/(?:후련|시원)/, "후련함"]
  ];
  const matched = labels.find(([pattern]) => pattern.test(clean));
  if (matched) return matched[1];
  const looksLikeShortNounLabel =
    clean.length <= 12 &&
    !/\s/.test(clean) &&
    !/(?:요|습니다|니다|했다|였다|같다|겠어|했어|였어|았어|었어)$/.test(clean);
  if (trimmed === clean && looksLikeShortNounLabel) {
    return clean;
  }
  return "꿈에서 남은 느낌";
}

function primaryFeeling(structure: DreamStructure) {
  return normalizedFeelingLabel(structure.emotions[0]);
}

function symbolNames(structure: DreamStructure) {
  return structure.symbols.map((symbol) => symbol.name).join("·");
}

export function buildFreeReading(structure: DreamStructure, safetyNotice: SafetyNotice | null): FreeReading {
  const primary = structure.symbols[0];
  const feeling = primaryFeeling(structure);
  const lacksSpecificScene = primary.key === "scene" && structure.actions.length === 0 && structure.people.length === 0;
  const headline = safetyNotice
    ? "이 꿈의 의미를 단정하기보다, 지금 마음이 보내는 도움 요청을 먼저 살펴야 해요."
    : lacksSpecificScene
      ? "지금 내용만으로는 나쁜 징조나 특정한 심리라고 볼 근거가 없어요. 인물·장소·행동·감정 중 하나만 더 있으면 뜻을 구체적으로 좁힐 수 있습니다."
    : `${primary.name}의 장면은 ‘${feeling}’${objectParticle(feeling)} 지나며 변화의 속도와 내 경계를 다시 맞추려는 꿈으로 읽혀요.`;

  const contextSentence = structure.recentContext
    ? `특히 최근의 ‘${structure.recentContext}’ 맥락과 연결하면, 꿈은 답을 예언하기보다 지금 무엇이 마음을 차지하는지 선명하게 보여줍니다.`
    : "최근 현실의 구체적인 맥락은 확인되지 않았으므로, 한 가지 사건에 맞춘 단정 대신 장면과 감정이 만나는 지점을 중심으로 살폈어요.";

  return {
    headline,
    directions: safetyNotice ? ["심리 반영"] : signalDirections(structure),
    symbols: structure.symbols.slice(0, 3).map((symbol) => ({
      name: symbol.name,
      meaning: `${symbol.traditional} 이 꿈에서는 ${feeling}${connectiveParticle(feeling)} 함께 나타나, ${symbol.psychological.replace(/^심리적으로는\s*/, "")}`
    })),
    psychology: safetyNotice
      ? `${contextSentence} 꿈속의 강한 이미지가 현재의 마음과 이어진다면 혼자 의미를 견디려 하지 말고, 실제 사람과 연결되는 것이 먼저입니다.`
      : lacksSpecificScene
        ? "없는 상징이나 장면 순서를 만들어내지 않았어요. 깨고 난 뒤 가장 먼저 든 느낌과 꿈에서 누가 무엇을 했는지 한 문장만 더 적으면, 현실의 어떤 고민과 닿는지부터 다시 볼 수 있습니다."
      : `${contextSentence} ${symbolNames(structure)} 같은 상징보다 더 중요한 단서는 꿈속에서 내가 무엇을 피하고, 붙잡고, 바라봤는지예요. 이 꿈은 미래를 확정하는 예고가 아니라 최근의 감정과 경험을 정리하는 하나의 가능성으로 보는 편이 안전합니다.`,
    uncertaintyNote:
      structure.uncertainty.length > 0
        ? "건너뛴 정보가 있어 관계나 현실 맥락에 대한 해석은 가능성의 범위로 남겨두었어요."
        : null
  };
}

export function buildPaidPreviews(structure: DreamStructure): PaidPreview[] {
  const first = structure.symbols[0];
  const feeling = primaryFeeling(structure);
  return [
    {
      key: "traditional",
      title: "장면별 전통 해몽",
      firstSentence: `${first.name}이 등장한 방식과 꿈속의 행동을 함께 보면, 단순한 길몽·흉몽보다 ‘변화가 들어오는 방향’이 먼저 보입니다.`,
      evidenceSceneOrders: [],
      promisedSectionTitle: "장면의 흐름에서 먼저 보이는 것"
    },
    {
      key: "psychology",
      title: "최근 경험과 심리적 연결",
      firstSentence: `${feeling}${subjectParticle(feeling)} 가장 강했다는 점은 최근 현실에서 눌러두거나 서둘러 정리한 감정과 이어질 가능성이 있어요.`,
      evidenceSceneOrders: [],
      promisedSectionTitle: "현실 정보가 더해질 때 달라지는 해석"
    },
    {
      key: "pattern",
      title: "이 꿈이 보여주는 반복 패턴",
      firstSentence: structure.isRecurring
        ? "비슷한 꿈이 되풀이된다는 것은 해결되지 않은 주제가 형태만 바꿔 다시 주의를 요청하고 있다는 뜻일 수 있어요."
        : "한 번의 꿈이라도 내가 취한 행동을 따라가면 평소 압박 앞에서 반복하는 대응 방식이 드러납니다.",
      evidenceSceneOrders: [],
      promisedSectionTitle: "전통 해몽은 이렇게만 참고하기"
    },
    {
      key: "action",
      title: "지금 해볼 수 있는 행동과 질문",
      firstSentence: `오늘은 ${first.action.replace(/보세요\.$/, "보는 것부터 시작해도 좋아요.")}`,
      evidenceSceneOrders: [],
      promisedSectionTitle: "현실에서 확인할 질문과 대화법"
    }
  ];
}

export function buildPaidReport(structure: DreamStructure, now = new Date()): PaidReport {
  const first = structure.symbols[0];
  const symbols = structure.symbols.map((symbol) => symbol.name).join(", ");
  const feeling = primaryFeeling(structure);
  const people = structure.people.length ? structure.people.join(", ") : "뚜렷하게 특정되지 않은 등장 대상";
  const action = structure.actions.length ? structure.actions.join(", ") : "장면을 지켜보는 태도";
  const context = structure.recentContext ?? "아직 구체적으로 말하지 않은 최근의 생활 변화";

  return {
    title: `${first.name}이 남긴 결을 따라 읽은 꿈`,
    lead: `이 꿈의 중심은 ${symbols} 자체의 고정된 뜻보다, 그 장면에서 느낀 ${feeling}${connectiveParticle(feeling)} 내가 취한 ${action}의 조합에 있습니다. 전통 해몽은 상징의 오래된 쓰임을 참고하고, 심리 해석은 최근 경험을 정리하는 가능성으로 나누어 읽었습니다. 어느 쪽도 미래의 사건을 확정하거나 진단하는 말은 아닙니다.`,
    sections: [
      {
        key: "overview",
        eyebrow: "01 / 전체 흐름",
        title: "꿈이 움직인 방향",
        paragraphs: [
          `꿈은 ${people}와 ${symbols}의 장면을 지나며 ${feeling}${objectParticle(feeling)} 남겼습니다. 현실에서도 사건 자체보다 ‘그 뒤에 어떻게 될까’라는 예상이 마음을 차지할 수 있어요. 반대로 장면을 직접 움직였다면 변화 앞에서 주도권을 되찾으려는 힘도 보입니다.`,
          "핵심은 길흉을 서둘러 정하기보다 내 경계와 속도를 다시 조절하라는 데 가깝습니다. 꿈은 정답보다 낮에 미뤄둔 감각을 크게 펼쳐 보이곤 합니다."
        ]
      },
      {
        key: "traditional",
        eyebrow: "02 / 전통 해몽",
        title: "상징과 장면을 함께 읽기",
        paragraphs: structure.symbols.map(
          (symbol) =>
            `${symbol.name}: ${symbol.traditional} 같은 상징도 다가왔는지 멀어졌는지, 내가 피했는지 맞섰는지에 따라 방향이 달라집니다. 이 꿈의 ${action}은 결과의 예고보다 변화에 대응하는 태도를 보여줍니다.`
        )
      },
      {
        key: "psychology",
        eyebrow: "03 / 심리적 가능성",
        title: "최근 경험과 감정의 연결",
        paragraphs: [
          `${context}라는 맥락에서 ${feeling}${topicParticle(feeling)} 아직 말로 정리되지 않은 신호일 수 있습니다. ${first.psychological} 꿈의 크기는 실제 위험보다 내가 체감하는 부담을 보여줄 때가 많아요.`,
          "감정을 없애기보다 이름 붙여보세요. ‘왜 이런 꿈을 꿨지’에서 ‘언제 이 감정이 다시 올라오지’로 질문을 옮기면, 꿈은 예언이 아니라 현재를 알아차리는 기록이 됩니다."
        ]
      },
      {
        key: "pattern",
        eyebrow: "04 / 반복 패턴",
        title: structure.isRecurring ? "되풀이되는 꿈이 붙잡는 것" : "장면 속에서 드러난 대응 방식",
        paragraphs: [
          structure.isRecurring
            ? `반복되는 꿈은 같은 사건의 예고가 아니라, 끝내지 못한 과제를 비슷한 감정으로 다시 펼치는 경우가 많습니다. 세부가 달라도 ${feeling}${choiceParticle(feeling)} ${action}${subjectParticle(action)} 반복되는지 살펴보세요.`
            : `이번 꿈의 ${action}은 압박 앞에서 익숙하게 취하는 태도의 축소판일 수 있습니다. 충분히 확인하기 전에 피하거나 모든 것을 혼자 붙잡으려 하지는 않는지 돌아보세요.`,
          "이 패턴을 성격으로 단정할 필요는 없습니다. 잠, 일정, 관계의 긴장 같은 일시적 조건도 꿈을 선명하게 하므로 며칠간 같은 감정이 이어지는지만 기록해도 충분합니다."
        ]
      },
      {
        key: "action",
        eyebrow: "05 / 오늘의 적용",
        title: "해석을 현실의 작은 행동으로",
        paragraphs: [
          `꿈을 맞히기보다 지금의 부담을 낮추는 행동이 더 유용합니다. ${first.action} 오늘 안에 끝낼 크기로 줄이면 꿈이 남긴 긴장도 현실의 선택으로 옮겨갈 수 있어요.`
        ]
      }
    ],
    positive: `이 꿈에는 ${feeling}${objectParticle(feeling)} 장면으로 드러내 마음을 정리하려는 힘이 있습니다. 특히 ${action}에는 변화에 반응하고 균형을 되찾으려는 움직임이 보여요.`,
    caution: "전통 해몽의 상징을 실제 사고, 죽음, 질병, 재물의 확정적 예고로 받아들이지는 마세요. 불안이 일상을 방해하거나 악몽이 오래 반복되면 해몽보다 수면과 마음 건강을 전문적으로 살피는 편이 좋습니다.",
    actions: [
      first.action,
      "꿈에서 가장 강했던 감정을 오늘 실제로 느낀 순간과 연결해 한 줄만 기록해보세요.",
      "통제할 수 있는 다음 행동을 10분 안에 끝낼 수 있는 크기로 정해보세요."
    ],
    reflectionQuestions: [
      `꿈속의 ${feeling}${topicParticle(feeling)} 요즘 어떤 순간의 감정과 가장 닮았나요?`,
      `${action} 대신 내가 선택해보고 싶은 새로운 반응은 무엇인가요?`
    ],
    generatedAt: now.toISOString()
  };
}

export function buildFollowUpAnswer(structure: DreamStructure, question: string) {
  const first = structure.symbols[0];
  return `질문하신 “${question}”은 ${first.name}의 고정된 뜻보다 꿈에서 느낀 ${primaryFeeling(structure)}과 함께 보는 편이 좋습니다. ${first.psychological} 따라서 이 장면을 미래의 예고로 단정하기보다, 최근 비슷한 감정이 올라온 순간을 찾는 단서로 사용해보세요. 지금 떠오르는 현실의 한 장면이 있다면 그때 내가 필요했던 것—거리 두기, 확인, 휴식, 대화—중 무엇이었는지 살펴보면 해석이 더 구체적으로 이어집니다.`;
}

function inferDreamer(dream: string): Pick<DreamContext, "dreamer" | "dreamerDescription" | "relationshipToUser"> {
  const patterns = [
    /(?:제|내)\s*꿈이\s*아니라\s*([^,.!?\n]{1,24}?)(?:가|이)\s*(?:꿈(?:을)?\s*)?(?:꿨|꿧|꾸었|꾼)/,
    /((?:제|내)\s*)?(여자친구|남자친구|여친|남친|아내|남편|배우자|친구|언니|누나|오빠|동생)(?:가|이)\s*(?:꿈(?:을)?\s*)?(?:꿨|꿧|꾸었|꾼)/,
    /([^,.!?\n]{1,24}?)(?:가|이)\s*꿈(?:을)?\s*(?:꿨|꿧|꾸었|꾼)/
  ];
  let description: string | null = null;
  for (const pattern of patterns) {
    const match = dream.match(pattern);
    if (!match) continue;
    description = (match[2] ?? match[1])?.replace(/^(?:제|내)\s*/, "").trim() ?? null;
    if (description) break;
  }
  if (description) {
    return {
      dreamer: "someone_else",
      dreamerDescription: description,
      relationshipToUser: description
    };
  }
  if (/(?:누가\s*꿨는지|꿈을\s*꾼\s*사람은)\s*(?:모르|불확실)/.test(dream)) {
    return { dreamer: "unknown", dreamerDescription: null, relationshipToUser: null };
  }
  return { dreamer: "user", dreamerDescription: "사용자", relationshipToUser: null };
}

function statedPersonalDetails(dream: string) {
  const details = dream.match(
    /(?:만\s*)?\d{1,2}\s*살|\d{1,2}\s*대|(?:남성|여성|남자(?!친구)|여자(?!친구))|(?:학생|직장인|취업준비생|프리랜서|주부)/g
  );
  return unique(details ?? []);
}

function extractUserQuestions(text: string) {
  const questions: string[] = [];
  if (isRelationshipVerdictRequest(text)) questions.push("다른 사람을 원하는 꿈인지");
  if (/(?:투영|영향|반영|섞였|섞인|때문에\s*꾼)/.test(text)) {
    questions.push("최근에 겪거나 들은 사건이 꿈에 영향을 줬는지");
  }
  if (/(?:해몽|풀이).{0,20}(?:전해|말해)|(?:전해|말해).{0,20}(?:괜찮|될까|돼)/.test(text)) {
    questions.push("이 해석을 상대에게 전해도 되는지");
  }
  if (isShareableSentenceRequest(text)) questions.push("상대에게 전할 한마디");
  if (/(?:무슨|어떤)\s*꿈|꿈.{0,12}(?:뜻|의미)|해몽해|풀이해/.test(text)) {
    questions.push("이 꿈의 전체 의미");
  }
  return unique(questions).slice(0, 6);
}

function sceneFragments(dream: string) {
  const fragments = dream
    .split(/(?:[.!?\n]+|(?=그리고|그러다|그런데|마지막에는|이후에))/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);
  if (fragments.length <= 8) return fragments;
  const selected = new Set([0, fragments.length - 2, fragments.length - 1]);
  const ranked = fragments.map((text, index) => ({index,
    score: (/그런데|그러다|갑자기|알고\s*보니|하지만|끝|마지막/.test(text) ? 4 : 0)
      + (collect(text, EMOTION_PATTERNS).length ? 2 : 0)
  })).sort((a, b) => b.score - a.score || a.index - b.index);
  for (const {index} of ranked) { if (selected.size >= 8) break; selected.add(index); }
  return [...selected].sort((a,b)=>a-b).map(index=>fragments[index]);
}

function toScene(fragment: string, order: number): DreamScene {
  const actions = collect(fragment, ACTION_PATTERNS);
  // A single fragment may contain a location change (e.g. leaving a home and
  // continuing down an alley). Attribute the scene to its last explicit place
  // so earlier locations do not leak into later actions in that fragment.
  const place = collectPlaces(fragment).at(-1) ?? null;
  const scene = {
    order,
    people: collect(fragment, PEOPLE_PATTERNS),
    action: actions.length ? actions.join(" 뒤 ") : fragment.slice(0, 80),
    place,
    emotion: collect(fragment, EMOTION_PATTERNS).at(-1) ?? null
  };
  return attachObservedSceneEvidence(scene, fragment);
}

export function analyzeDreamContextLocally(
  dream: string,
  selectedEmotion: Emotion | null,
  focus: InterpretationFocus | null = null
) {
  const evidence = splitDreamEvidence(dream);
  const observed = observedDreamText(evidence.dreamText);
  const legacy = analyzeDreamLocally(observed, selectedEmotion);
  const dreamer = inferDreamer(unquotedText(dream));
  const selectedFocusQuestion = interpretationQuestionForFocus(focus);
  const context: DreamContext = {
    dreamEvidence: evidence.dreamText,
    selectedEmotion,
    ...dreamer,
    selectedFocus: focus,
    userQuestions: unique([selectedFocusQuestion, ...extractUserQuestions(dream)]).slice(0, 6),
    statedPersonalDetails: statedPersonalDetails(dream),
    people: legacy.structure.people,
    scenes: sceneFragments(observed).map((fragment, index) => toScene(fragment, index + 1)),
    places: legacy.structure.places,
    emotions: legacy.structure.emotions,
    symbols: legacy.structure.symbols,
    realityContexts: evidence.realityTexts.slice(0, 5),
    isRecurring: legacy.structure.isRecurring,
    uncertainties: []
  };
  return {
    context,
    questions: legacy.questions,
    safetyRoute: classifySafetyRoute(dream)
  };
}

function primaryInterpretationFocus(context: DreamContext): InterpretationFocus | null {
  if (context.selectedFocus) return context.selectedFocus;
  const question = context.userQuestions?.[0] ?? "";
  if (isRelationshipVerdictRequest(question) || /(?:관계|상대(?:의)?\s*마음|연인)/.test(question)) {
    return "relationship";
  }
  if (/(?:최근.{0,12}(?:사건|감정)|영향|투영|반영|섞)/.test(question)) return "recent_context";
  if (/(?:반복|되풀이|오래\s*남)/.test(question)) return "repetition";
  if (/(?:좋은\s*꿈|나쁜\s*꿈|길몽|흉몽)/.test(question)) return "good_or_bad";
  if (/(?:전체\s*의미|무슨\s*꿈|꿈.{0,8}(?:뜻|의미))/.test(question)) return "overall";
  return null;
}

export function applyClarificationsToContext(context: DreamContext, answers: ClarificationAnswer[]) {
  const next = structuredClone(context);
  context.scenes.forEach((scene, index) => {
    const clonedScene = next.scenes[index];
    if (clonedScene) copyObservedSceneEvidence(scene, clonedScene);
  });
  for (const item of answers) {
    if (item.skipped || !item.answer) {
      next.uncertainties = unique([...next.uncertainties, item.kind]);
      continue;
    }
    if (item.kind === "emotion") next.emotions = unique([...next.emotions, item.answer]);
    if (item.kind === "scene" || item.kind === "emotion") {
      const evidence = splitDreamEvidence(item.answer);
      next.realityContexts = unique([...next.realityContexts, ...evidence.realityTexts]);
      if (next.dreamEvidence !== undefined && evidence.dreamText) {
        const rebuilt = analyzeDreamContextLocally(`${next.dreamEvidence}. ${evidence.dreamText}`, next.selectedEmotion ?? null, next.selectedFocus).context;
        next.dreamEvidence = rebuilt.dreamEvidence;
        next.scenes = rebuilt.scenes; next.symbols = rebuilt.symbols;
        next.people = rebuilt.people; next.places = rebuilt.places;
        next.emotions = unique([...(item.kind === "emotion" ? [item.answer] : []), ...rebuilt.emotions]);
        next.uncertainties = next.uncertainties.filter(kind=>kind!=="scene");
        continue;
      }
      const people = collect(evidence.dreamText, PEOPLE_PATTERNS);
      const place = collectPlaces(evidence.dreamText)[0] ?? null;
      const emotions = collect(evidence.dreamText, EMOTION_PATTERNS);
      const clarifiedSymbols = extractSymbols(evidence.dreamText).filter((symbol) => symbol.key !== "scene");
      const offset = next.scenes.length;
      next.scenes.push(...sceneFragments(evidence.dreamText).map((fragment, index) => toScene(fragment, offset + index + 1)));
      next.uncertainties = next.uncertainties.filter((kind) => kind !== "scene");
      next.people = unique([...next.people, ...people]);
      next.places = unique([...next.places, place]);
      next.emotions = unique([...next.emotions, ...emotions]);
      if (clarifiedSymbols.length > 0) {
        const mergedSymbols = [...next.symbols.filter((symbol) => symbol.key !== "scene"), ...clarifiedSymbols];
        next.symbols = [...new Map(mergedSymbols.map((symbol) => [symbol.key, symbol])).values()].slice(0, 4);
      }
    }
    if (item.kind === "relationship") {
      next.relationshipToUser = item.answer;
      next.people = unique([...next.people, item.answer]);
    }
    if (item.kind === "recent_context") next.realityContexts = unique([...next.realityContexts, item.answer]);
    if (item.kind === "dreamer") {
      next.dreamer = /다른|친구|가족|연인|배우자/.test(item.answer) ? "someone_else" : "user";
      next.dreamerDescription = item.answer;
    }
  }
  return next;
}

function explicitContextFeeling(context: DreamContext) {
  return context.emotions[0] ?? context.scenes.find((scene) => scene.emotion)?.emotion ?? null;
}

function sceneEmotionArc(context: DreamContext) {
  const scenes = [...context.scenes].sort((left, right) => left.order - right.order);
  const from = scenes.find((scene) => scene.emotion)?.emotion;
  const to = scenes.at(-1)?.emotion;
  return from && to && from !== to ? { from, to } : null;
}

function contextFeeling(context: DreamContext) {
  return normalizedFeelingLabel(explicitContextFeeling(context));
}

function explicitContextAction(context: DreamContext) {
  const knownActions = new Set(ACTION_PATTERNS.map(([, label]) => label));
  const actions = context.scenes
    .flatMap((scene) => scene.action.split(" 뒤 "))
    .map((action) => action.trim())
    .filter((action) => knownActions.has(action))
    .filter((action, index, items) => items.indexOf(action) === index)
    .filter((action, _index, items) => {
      if (action === "붙잡음" && items.includes("손을 잡고 함께 걸음")) return false;
      if (action === "함께 이동함" && items.includes("손을 잡고 함께 걸음")) return false;
      if (action === "발견함" && items.includes("출구를 찾아 밖으로 나감")) return false;
      if (action === "찾아다님" && items.includes("출구를 찾아 밖으로 나감")) return false;
      return true;
    });
  const flow = actions
    .slice(0, 5)
    .map((action) => (action.length > 34 ? `${action.slice(0, 33)}…` : action))
    .join(" → ");
  return flow || null;
}

function contextAction(context: DreamContext) {
  return explicitContextAction(context) ?? "구체적인 행동이 아직 드러나지 않은 장면";
}

const DIRECT_SYMBOL_MEANINGS: Record<string, string> = {
  "identity-shift": "믿었던 사람이나 상황이 갑자기 낯설게 바뀔까 경계하는 마음",
  "relationship-conflict": "내 말이 통하지 않거나 일방적인 반응을 감당해야 하는 상황에 대한 거부감",
  "zombie-threat": "한꺼번에 밀려오는 걱정이나 감당하기 벅찬 압박",
  water: "물속에서 편했는지 벗어나려 했는지에 따라 달라지는 감정",
  snake: "끌리지만 동시에 조심스러운 변화나 관계",
  teeth: "통제력을 잃거나 중요한 말을 제대로 전하지 못할까 하는 걱정",
  chase: "미뤄둔 일이나 피하고 싶은 압박",
  falling: "상황을 통제하지 못할까 하는 긴장",
  death: "한 역할이나 시기를 끝내고 다음 단계로 넘어가는 변화",
  ancestor: "가족의 기준이나 오래된 가치와 지금의 선택을 비교하는 마음",
  ex: "그 사람 자체보다 지난 관계에 남은 감정이나 당시의 내 모습",
  pregnancy: "새 계획이나 책임이 자라나는 데 대한 기대와 부담",
  fire: "빠르게 커진 의욕·분노·급박함",
  house: "집 안에서 편했는지 벗어나고 싶었는지에 따라 달라지는 마음",
  animal: "말로 다 표현하지 못한 본능이나 경계심",
  money: "안정감·인정·내 가치에 대한 생각",
  school: "평가받는 부담과 준비가 충분한지에 대한 걱정",
  travel: "지금 가는 방향과 속도가 맞는지 점검하는 마음"
};

function directSymbolMeaning(context: DreamContext) {
  const first = context.symbols[0];
  const action = explicitContextAction(context);
  const feeling = explicitContextFeeling(context);
  const arc = sceneEmotionArc(context);

  if (arc?.to === "안도감" && action?.includes("밖으로 내보냄")) {
    return "불편했던 대상을 스스로 내보내고 편안함을 되찾는 과정";
  }

  if (first.key === "snake" && feeling === "두려움") {
    return action?.includes("바라봄")
      ? "조심스러운 대상을 바로 피하지 않고 먼저 살피는 경계심"
      : "가까이 온 변화나 대상을 위험하게 느껴 거리를 두고 싶은 마음";
  }
  if (first.key === "water" && feeling === "안도감") {
    return "감정이 벅차오른 상황에서도 가까운 사람들과 안전을 되찾으려는 마음";
  }
  if (first.key === "ancestor" && feeling && /(?:기쁨|안도감|슬픔)/.test(feeling)) {
    return "그리운 사람과 다시 연결되고 위로받고 싶은 마음";
  }
  if (first.key === "house" && action?.includes("안으로 받아들임")) {
    return "경계 밖에 있던 존재를 돌보고 내 안전한 공간 안으로 받아들이는 마음";
  }
  if (first.key === "travel" && action?.includes("도움을 받음")) {
    return "방향을 잃은 순간에도 도움을 받아 다시 나아갈 수 있다는 안도감";
  }
  if (first.key === "travel" && action?.includes("손을 잡고 함께 걸음")) {
    return "누군가를 보호하며 함께 책임지고 나아가려는 마음";
  }
  if (first.key === "scene" && action) return directActionMeaning(action);
  if (first.key === "scene" && feeling) {
    const meanings: Record<string, string> = {
      두려움: "무언가를 경계하고 안전을 먼저 확인하려는 마음",
      기쁨: "원하던 연결이나 만족을 확인한 마음",
      찝찝함: "끝내지 못한 일이나 관계가 남긴 불편함",
      슬픔: "멀어지거나 놓친 것에 대한 아쉬움",
      분노: "내 뜻이 받아들여지지 않은 데 대한 답답함",
      낯섦: "익숙한 상황이 예상과 달라 생긴 혼란",
      불안: "결과를 알 수 없어 계속 확인하고 싶은 마음",
      안도감: "부담에서 벗어나 편안함을 되찾은 마음"
    };
    return meanings[feeling] ?? "아직 정리되지 않은 감정";
  }
  return DIRECT_SYMBOL_MEANINGS[first.key] ?? "아직 구체적으로 좁히기 어려운 마음";
}

function hasSpecificDreamDetails(context: DreamContext) {
  return (
    context.symbols.some((symbol) => symbol.key !== "scene") ||
    Boolean(explicitContextAction(context)) ||
    (Boolean(explicitContextFeeling(context)) && (context.people.length > 0 || context.places.length > 0))
  );
}

export function freeDetailGuidance(context: DreamContext) {
  const hasSubject = context.symbols.some((symbol) => symbol.key !== "scene") || context.people.length > 0 || context.places.length > 0;
  const hasFeeling = Boolean(explicitContextFeeling(context));
  const hasAction = Boolean(explicitContextAction(context));
  const ready = hasAction || (hasSubject && hasFeeling);
  return {
    ready,
    kind: "scene" as const,
    question: hasFeeling && !hasSubject && !hasAction
      ? "그 기분이 들었던 장면에 무엇이 있었나요?"
      : !hasSubject && !hasAction
      ? "꿈에서 어떤 일이 있었나요? 기억나는 장면 하나만 적어주세요."
      : !hasFeeling
        ? "그 장면에서 어떤 기분이었나요?"
        : "더 기억나는 장면이 있나요? 떠오르는 내용이 있으면 적어주세요.",
    placeholder: !hasSubject && !hasAction
      ? "예: 낯선 집에서 문을 찾다가 밖으로 나왔어요."
      : !hasFeeling ? "예: 처음엔 무서웠는데, 가만히 보고 있으니 편안해졌어요." : "예: 문을 열고 밖으로 나왔고, 마음이 놓였어요."
  };
}

function sceneEvidence(context: DreamContext) {
  const action = explicitContextAction(context);
  const details = [
    context.people.length ? `인물 ‘${compactList(context.people, "", 4)}’` : null,
    context.places.length ? `장소 ‘${compactList(context.places, "", 3)}’` : null,
    action ? `행동 ‘${action}’` : null,
    explicitContextFeeling(context) ? `감정 ‘${explicitContextFeeling(context)}’` : null,
    context.symbols[0]?.key !== "scene" ? `상징 ‘${context.symbols[0].name}’` : null
  ].filter((detail): detail is string => Boolean(detail));
  return details.join(", ");
}

function directActionMeaning(action: string) {
  if (/출구를 찾아 밖으로 나감/.test(action)) return "답답한 상황에서 해결책이나 빠져나갈 길을 찾으려는 마음";
  if (/찾아다님/.test(action)) return "잃어버린 답이나 중요한 것을 되찾으려는 마음";
  if (/안전한 곳으로 이동함/.test(action)) return "위협 속에서도 안전과 보호를 우선한 대응";
  if (/손을 잡고 함께 걸음/.test(action)) return "누군가를 보호하며 함께 책임지고 나아가려는 마음";
  if (/문을 열어 안으로 받아들임/.test(action)) return "돌봄이 필요한 대상에게 내 공간을 내어주는 태도";
  if (/도움을 받음/.test(action)) return "혼자 해결하기보다 도움을 받아 다시 나아가는 과정";
  if (/걸어감/.test(action)) return "불확실한 상황에서도 멈추지 않고 다음으로 나아간 행동";
  if (/문을 엶/.test(action)) return "확인하지 못한 것을 직접 마주하려는 행동";
  if (/무언가를 쥠/.test(action)) return "중요하다고 느낀 것을 놓치지 않으려는 반응";
  if (/함께 이동함/.test(action)) return "혼자 버티기보다 누군가와 같이 움직이려는 마음";
  if (/상대가 멀어짐/.test(action)) return "멀어지는 관계를 바라보며 느낀 아쉬움과 거리감";
  if (/함께 머묾/.test(action)) return "안전한 사람과 연결되어 편안함을 확인하는 장면";
  if (/(?:달아남|숨음)/.test(action)) return "부담에서 거리를 두고 안전한 곳을 찾으려는 반응";
  if (/(?:붙잡음|맞섬|밖으로 내보냄)/.test(action)) return "상황에 끌려가기보다 주도권이나 경계를 되찾으려는 반응";
  if (/바라봄/.test(action)) return "바로 결정하거나 개입하기 전에 상황을 살피는 태도";
  if (/(?:잃어버림|떨어짐)/.test(action)) return "중요한 것을 놓치거나 통제력을 잃을까 하는 긴장";
  if (/(?:발견함|날아오름)/.test(action)) return "막힌 상황에서 답이나 여유를 되찾으려는 움직임";
  if (/울음/.test(action)) return "눌러둔 감정을 밖으로 내보내는 과정";
  if (/(?:웃음|함께 좋은 시간을 보냄)/.test(action)) return "편안함과 친밀감을 확인하는 장면";
  return "그 상황에 대응한 방식";
}

function emotionConnection(feeling: string | null) {
  if (!feeling) {
    return "깨고 난 뒤 느낌이 무서움·찝찝함이었다면 부담과 경계 쪽, 편안함이었다면 회복과 안도 쪽으로 의미가 달라져요.";
  }
  const label = normalizedFeelingLabel(feeling);
  if (/(?:기쁨|안도감|후련함)/.test(label)) {
    return `${label}이 남았다는 점을 보면, 부담에서 벗어나거나 원하는 방향을 확인한 장면에 더 가까워요.`;
  }
  return `${label}이 남았다는 점을 보면, 이 주제가 아직 마음에 걸리거나 정리되지 않았을 가능성이 커요.`;
}

function realityCheckQuestion(context: DreamContext) {
  if (sceneEmotionArc(context)?.to === "안도감") {
    return "최근 직접 결정하거나 거리를 조절한 뒤 마음이 편해진 일이 있었는지 확인해보세요.";
  }
  if (hasSymbol(context, "identity-shift") || hasSymbol(context, "relationship-conflict")) {
    return "꿈에서 어떤 태도가 가장 불편했는지, 현실에서도 비슷한 불편함이 있었는지 확인해보세요.";
  }
  if (hasSymbol(context, "zombie-threat") || hasSymbol(context, "chase")) {
    return "최근 피하고 싶거나 혼자 감당하기 벅찬 일이 있었는지 확인해보세요.";
  }
  if (hasSymbol(context, "snake")) {
    return "최근 바로 결정하지 않고 조심스럽게 지켜보는 변화나 관계가 있었는지 확인해보세요.";
  }
  if (hasSymbol(context, "ancestor")) {
    return "최근 그리운 사람이나 다시 듣고 싶은 위로가 떠오른 적이 있었는지 확인해보세요.";
  }
  if (explicitContextAction(context)?.includes("손을 잡고 함께 걸음")) {
    return "최근 누군가를 보호하거나 함께 책임져야 한다고 느낀 일이 있었는지 확인해보세요.";
  }
  if (explicitContextAction(context)?.includes("도움을 받음")) {
    return "최근 혼자 풀기 어려운 일에서 도움을 받았거나 필요로 한 순간이 있었는지 확인해보세요.";
  }
  if (hasSymbol(context, "falling") || hasSymbol(context, "school") || hasSymbol(context, "travel")) {
    return "최근 통제하기 어렵거나 평가받는다고 느낀 일이 있었는지 확인해보세요.";
  }
  if (hasSymbol(context, "house")) {
    return "요즘 내 공간이나 가까운 관계에서 편안함이 흔들린 순간이 있었는지 확인해보세요.";
  }
  return "꿈에서 가장 강했던 감정과 최근 같은 감정을 느낀 순간이 있었는지 확인해보세요.";
}

function hasFinalConsonant(value: string) {
  const last = value.at(-1);
  if (!last) return true;
  const code = last.charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
}

function subjectParticle(value: string) {
  return hasFinalConsonant(value) ? "이" : "가";
}

function objectParticle(value: string) {
  return hasFinalConsonant(value) ? "을" : "를";
}

function topicParticle(value: string) {
  return hasFinalConsonant(value) ? "은" : "는";
}

function connectiveParticle(value: string) {
  return hasFinalConsonant(value) ? "과" : "와";
}

function choiceParticle(value: string) {
  return hasFinalConsonant(value) ? "이나" : "나";
}

function hasSymbol(context: DreamContext, key: string) {
  return context.symbols.some((symbol) => symbol.key === key);
}

function hasContextClue(context: DreamContext, pattern: RegExp) {
  return [
    ...context.people,
    ...context.places,
    ...context.scenes.map((scene) => scene.action),
    ...context.symbols.flatMap((symbol) => [symbol.name, symbol.psychological]),
    ...context.realityContexts
  ].some((value) => pattern.test(value));
}

function dreamFeatures(context: DreamContext) {
  return {
    numberedPeople: context.people.includes("1번 인물") && context.people.includes("2번 인물"),
    positiveStart: hasContextClue(context, /함께 좋은 시간을 보냄/),
    mistakenIdentity: hasContextClue(context, /같은 사람이라고 믿음/),
    hiddenFace: hasContextClue(context, /얼굴을 확인하지 못함|얼굴이 보이지 않는/),
    realizedDifferent: hasContextClue(context, /다른 사람임을 알아차림/),
    lateArrival: hasContextClue(context, /늦은 귀가가 반복됨/),
    conflict: hasSymbol(context, "relationship-conflict"),
    familyHome: hasSymbol(context, "house") && hasContextClue(context, /가족/),
    zombieThreat: hasSymbol(context, "zombie-threat")
  };
}

function dreamerPhrase(context: DreamContext) {
  if (context.dreamer !== "someone_else") return "이 꿈은";
  const description = context.dreamerDescription ?? "다른 사람";
  return `${description}${subjectParticle(description)} 꾼 꿈이라는 점을 먼저 구분하면,`;
}

function compactList(values: string[], fallback: string, limit = 4) {
  const selected = unique(values).slice(0, limit);
  return selected.length ? selected.join("·") : fallback;
}

function relationshipShiftInterpretation(context: DreamContext) {
  if (!hasSymbol(context, "identity-shift")) return null;
  const features = dreamFeatures(context);
  return features.mistakenIdentity || features.realizedDifferent || features.numberedPeople
    ? "익숙하고 안전하다고 믿은 사람이 갑자기 낯설고 일방적인 모습으로 바뀌는 상황에 대한 경계"
    : "얼굴이나 정체를 확인할 수 없는 대상 앞에서 느낀 경계";
}

function threatInterpretation(context: DreamContext) {
  if (!hasSymbol(context, "zombie-threat")) return null;
  const familyHome = hasSymbol(context, "house") && hasContextClue(context, /가족/);
  return familyHome
    ? "가족이 모인 아파트라는 보호 공간과 좀비의 공격 위험이 함께 나온 점은, 안전한 경계 안으로도 통제하기 어려운 위협이 들어올까 긴장하는 장면"
    : "대화가 통하지 않고 계속 다가오는 위협을 감당하기 벅찬 긴장으로 바꾼 장면";
}

function conciseRealityContext(context: DreamContext) {
  const latest = context.realityContexts.at(-1);
  if (!latest) return null;
  if (/(?:친구|지인).{0,80}(?:가정폭력|맞고|맞았|폭언|자해)/.test(latest)) {
    return "가까운 친구의 가정폭력·폭언과 자해 소식을 접했다는 점";
  }
  return latest.length > 120 ? `${latest.slice(0, 119)}…` : latest;
}

function relationshipLimit(context: DreamContext) {
  if (hasSymbol(context, "identity-shift") && dreamFeatures(context).numberedPeople) {
    return "두 인물이 나왔다는 사실만으로 다른 사람을 만나고 싶다는 욕구, 현재 연인의 미래 행동, 외도나 이별을 판단할 수는 없어요.";
  }
  if (
    context.people.length > 0 ||
    context.symbols.some((symbol) => ["identity-shift", "relationship-conflict", "ex"].includes(symbol.key))
  ) {
    return "꿈만으로 상대의 속마음이나 관계의 결론을 판단할 수는 없어요.";
  }
  return "꿈만으로 앞으로 생길 일이나 현실의 결과를 판단할 수는 없어요.";
}

function matchingSceneOrders(context: DreamContext, pattern: RegExp) {
  const matched = context.scenes
    .filter((scene) => pattern.test([scene.people.join(" "), scene.action, scene.place ?? "", scene.emotion ?? ""].join(" ")))
    .map((scene) => scene.order);
  return matched.length ? matched : context.scenes.slice(0, 2).map((scene) => scene.order);
}

function offerRiskClass(context: DreamContext, safetyRoute: SafetyRoute) {
  if (safetyRoute === "immediate_self") return "blocked" as const;
  if (
    safetyRoute === "third_party" ||
    hasContextClue(context, /(?:가정폭력|폭언|자해|학대|맞았|맞고|위협받)/)
  ) {
    return "sensitive" as const;
  }
  return "standard" as const;
}

function paidOfferSceneLabel(name: string) {
  if (name === "아직 구체적이지 않은 장면") return "핵심 장면";
  return name.endsWith("장면") ? name : `${name} 장면`;
}

function paidOfferActionSentence(feeling: string) {
  const subject = feeling === "꿈에서 남은 느낌" ? "그 느낌" : feeling;
  return `오늘 ${subject}${subjectParticle(subject)} 다시 떠오를 때 무엇을 확인할지, 바로 해볼 작은 행동과 함께 정리합니다.`;
}

export function buildPaidOfferFromContext(
  context: DreamContext,
  safetyRoute: SafetyRoute = "none"
): PaidOffer {
  const first = context.symbols[0];
  const sceneLabel = paidOfferSceneLabel(first.name);
  const arc = sceneEmotionArc(context);
  const feeling = arc?.to ?? contextFeeling(context);
  const action = explicitContextAction(context);
  const features = dreamFeatures(context);
  const shift = relationshipShiftInterpretation(context);
  const reality = conciseRealityContext(context);
  const questions = context.userQuestions ?? [];
  const requestedFocus = primaryInterpretationFocus(context);
  const askedRelationshipVerdict = questions.some((item) => isRelationshipVerdictRequest(item));
  const relationshipFocus = requestedFocus === "relationship";
  const riskClass = offerRiskClass(context, safetyRoute);
  const dreamer = context.dreamerDescription ?? "꿈을 꾼 사람";
  const identityOrders = matchingSceneOrders(context, /(?:1번|2번|같은 사람|얼굴|다른 사람|정체)/);
  const threatOrders = matchingSceneOrders(context, /(?:좀비|괴물|공격|위협|가족|집|아파트)/);
  const generalOrders = context.scenes.slice(0, 3).map((scene) => scene.order);
  const cards: PaidPreview[] = [
    {
      key: "traditional",
      title: shift
        ? features.numberedPeople
          ? "2번 인물이 ‘나인 줄 알았던 사람’에서 낯선 사람으로 바뀐 이유"
          : "얼굴이 보이지 않은 인물의 정체가 흐려진 이유"
        : `${sceneLabel}이 이 꿈의 중심에 남은 이유`,
      firstSentence: shift
        ? `${features.positiveStart ? "좋은 시간" : "익숙함"}에서 오인과 낯섦으로 바뀐 장면 순서를 따라봅니다.`
        : arc
          ? `${arc.from}에서 ${arc.to}으로 감정이 달라졌어요. ${sceneLabel} 하나보다 그 뒤에 어떤 결말이 이어졌는지가 풀이를 바꾸는 단서예요.`
          : action
            ? `‘${action}’은 ${directActionMeaning(action)}으로 읽을 수 있어요. ${sceneLabel} 앞뒤에서 왜 그런 행동을 했는지 함께 살펴봐요.`
            : `${sceneLabel}만으로 뜻이 정해지지는 않아요. 다가갔는지 피했는지, 어떤 느낌이었는지에 따라 풀이가 달라져요.`,
      evidenceSceneOrders: shift ? identityOrders : generalOrders,
      promisedSectionTitle: "장면의 흐름에서 먼저 보이는 것"
    },
    {
      key: "psychology",
      title: reality
        ? /(?:가정폭력|폭언|자해)/.test(reality)
          ? "최근 들은 힘든 사건이 꿈에 섞였을 가능성"
          : "최근 현실의 일이 이 장면과 연결되는 지점"
        : requestedFocus === "recent_context"
          ? "최근 사건이나 감정이 꿈에 섞이는 방식"
        : `${feeling}${subjectParticle(feeling)} 현실의 어떤 장면과 닿아 있는지`,
      firstSentence: reality
        ? "최근 겪은 일과 꿈속 감정에 닮은 점이 있는지 함께 살펴봐요."
        : "꿈에서 느낀 기분이 일상에서도 남았던 순간을 함께 살펴봐요.",
      evidenceSceneOrders: features.zombieThreat ? threatOrders : generalOrders,
      promisedSectionTitle: "현실 정보가 더해질 때 달라지는 해석"
    },
    {
      key: "pattern",
      title: shift || askedRelationshipVerdict
        ? "익숙한 인물과 낯선 인물의 대비가 남긴 감정"
        : relationshipFocus
          ? "꿈속에서 상대를 대하는 내 반응의 의미"
        : requestedFocus === "repetition"
          ? "이 장면이 반복되거나 오래 남는 이유"
          : requestedFocus === "good_or_bad"
            ? "길몽·흉몽으로 나눌 수 있는 부분과 없는 부분"
        : features.zombieThreat
          ? "위협 장면을 실제 사건의 예고로 볼 수 없는 이유"
          : "전통 해몽과 심리적 가능성이 갈리는 지점",
      firstSentence: shift || askedRelationshipVerdict
        ? "익숙하던 인물이 낯설어지는 전환은 관계에서 느낀 편안함과 경계를 비교할 단서가 될 수 있어요. 실제 상대의 마음을 뜻하지는 않아요."
        : relationshipFocus
          ? "상대가 누구인지뿐 아니라 내가 다가갔는지, 피했는지에 따라 관계 장면을 다르게 읽을 수 있어요."
        : features.zombieThreat
          ? "위협의 크기와 현실 위험을 같은 것으로 단정하지 않고 장면의 역할을 살핍니다."
          : "길흉의 문화적 참고와 현실 감정의 가능성을 같은 주장처럼 섞지 않습니다.",
      evidenceSceneOrders: shift ? identityOrders : features.zombieThreat ? threatOrders : generalOrders,
      promisedSectionTitle: shift || askedRelationshipVerdict || relationshipFocus
        ? "등장한 대상과 나의 반응"
        : features.zombieThreat
          ? "공간과 분위기"
          : "전통 해몽은 이렇게만 참고하기"
    },
    {
      key: "action",
      title: context.dreamer === "someone_else"
        ? `${dreamer}에게 부담 없이 전할 마지막 한마디`
        : "현실에서 바로 확인해볼 질문과 다음 행동",
      firstSentence: context.dreamer === "someone_else"
        ? "정답처럼 밀어붙이지 않고, 상대의 동의를 먼저 구하는 짧은 문장으로 정리합니다."
        : paidOfferActionSentence(feeling),
      evidenceSceneOrders: generalOrders,
      promisedSectionTitle: "현실에서 확인할 질문과 대화법"
    }
  ];

  const headline = requestedFocus === "recent_context"
    ? "최근의 일과 이 꿈은 어떻게 이어질까요?"
    : requestedFocus === "repetition"
      ? "이 장면은 왜 자꾸 마음에 남을까요?"
      : requestedFocus === "good_or_bad"
        ? "길흉 너머, 이 꿈의 장면을 더 읽어볼까요?"
        : relationshipFocus && !shift
          ? "이 관계 장면은 왜 마음에 남았을까요?"
        : shift
    ? features.numberedPeople
      ? "두 번째 인물부터, 달라진 분위기를 읽어볼까요?"
      : "얼굴이 보이지 않던 장면을 더 읽어볼까요?"
    : askedRelationshipVerdict
      ? "꿈속 관계의 앞뒤를 더 읽어볼까요?"
      : `이 꿈에서 ${sceneLabel}은 왜 마음에 남았을까요?`;
  const bridge = riskClass === "sensitive"
    ? "상징 풀이는 여기서 읽고, 안전 안내도 언제든 확인할 수 있어요. 상세 해몽에서는 꿈의 장면과 최근 사건의 연결, 상대에게 전할 말을 함께 살펴봐요."
    : shift
      ? `인물이 바뀐 이유${features.zombieThreat ? ", 위협 장면과의 연결" : ""}${reality ? ", 최근 사건이 섞였을 가능성" : ""}, 현실에서 확인할 질문까지 한 흐름으로 정리합니다.`
      : "핵심 의미에서 한 걸음 더. 장면별 이유와 다른 해석, 내 상황에서 확인할 것까지 이어서 풀어요.";

  return {
    variant: "contextual_questions_v1",
    headline,
    bridge,
    checkoutTitle: shift ? "이 꿈의 관계 변화까지 이어서 보기" : `${sceneLabel}의 남은 질문 이어보기`,
    checkoutSummary: shift
      ? "인물이 낯설게 바뀐 이유와 현실의 관계 질문을 함께 봅니다."
      : "이 꿈에서 아직 남은 질문을 장면별로 이어서 봅니다.",
    cta: "상세 해몽 보기",
    trustLines: [],
    riskClass,
    cards
  };
}

export function buildPaidPreviewsFromContext(context: DreamContext): PaidPreview[] {
  return buildPaidOfferFromContext(context).cards;
}

export function assistantPayloadCharacterCount(payload: AssistantTurnPayload) {
  return [
    payload.directAnswer,
    ...payload.sections.flatMap((section) => [section.title, ...section.paragraphs]),
    payload.interpretationChanges?.newlyLearned ?? "",
    payload.interpretationChanges?.revisedInterpretation ?? "",
    ...payload.uncertainty,
    ...payload.shareableSentences
  ].join("").length;
}

function suggestedQuestionsForContext(context: DreamContext) {
  const sceneLabel = paidOfferSceneLabel(context.symbols[0].name);
  return [
    `${sceneLabel}을 다른 관점에서도 풀어줘`,
    sceneEmotionArc(context) ? "끝에 감정이 달라진 이유를 더 알고 싶어요" : "요즘 제 상황과 어떻게 연결해볼 수 있을까요?",
    context.dreamer === "someone_else" ? "꿈을 꾼 사람에게 전할 말을 써줘" : "오늘 해볼 수 있는 일 하나를 알려줘"
  ];
}

export function buildBriefFreePayload(
  context: DreamContext,
  generationSource: AnswerGenerationSource = "local"
): AssistantTurnPayload {
  const symbols = context.symbols.filter((symbol) => symbol.key !== "scene").slice(0, 4);
  const meaning = (symbol: DreamContext["symbols"][number]) =>
    `${symbol.psychological}`
      .replace(/합니다\./g, "해요.").replace(/다뤄집니다\./g, "다뤄져요.")
      .replace(/여겨집니다\./g, "여겨져요.").replace(/읽힙니다\./g, "읽혀요.")
      .replace(/있습니다\./g, "있어요.").replace(/이미지입니다\./g, "이미지예요.")
      .replace(/상징입니다\./g, "상징이에요.").replace(/봅니다\./g, "봐요.");
  // On generation failure, preserve reviewed basic meanings without pretending
  // to have produced a personalised integration or inventing missing scenes.
  const references = culturalReferencesForDream(context.dreamEvidence ?? "")
    .filter(reference => reference.briefMeaning);
  const entries = [
    ...references.map(reference => ({ title: `${reference.symbol}의 상징`, paragraphs: [reference.briefMeaning!] })),
    ...symbols.filter(symbol => !references.some(reference => referenceMatchesSymbol(reference, symbol.name)))
      .map(symbol => ({ title: `${symbol.name}의 상징`, paragraphs: [meaning(symbol)] }))
  ].slice(0, 4);
  return {
    freeReadingMode: entries.length ? "symbolic" : "needs_detail",
    directAnswerTitle: entries[0]?.title,
    directAnswer: entries[0]?.paragraphs[0] ?? "",
    sections: entries.slice(1),
    sources: resolveReadingSources(references.map(reference => reference.id), references) ?? [],
    interpretationChanges: null, uncertainty: [], shareableSentences: [], suggestedQuestions: [], generationSource
  };
}

export function buildFreeAssistantPayload(
  context: DreamContext,
  generationSource: AnswerGenerationSource = "local"
): AssistantTurnPayload {
  const first = context.symbols[0];
  const arc = sceneEmotionArc(context);
  const rawFeeling = arc?.to ?? explicitContextFeeling(context);
  const feeling = rawFeeling ? normalizedFeelingLabel(rawFeeling) : null;
  const action = explicitContextAction(context);
  const shift = relationshipShiftInterpretation(context);
  const threat = threatInterpretation(context);
  const reality = conciseRealityContext(context);
  const features = dreamFeatures(context);
  const requestedFocus = primaryInterpretationFocus(context);
  const specific = hasSpecificDreamDetails(context);
  const meaning = specific ? directSymbolMeaning(context) : null;
  const evidence = sceneEvidence(context);
  const askedRelationshipVerdict = (context.userQuestions ?? []).some((item) => isRelationshipVerdictRequest(item));
  const dreamerSubject = context.dreamer === "someone_else"
    ? `${context.dreamerDescription ?? "꿈을 꾼 사람"}${subjectParticle(context.dreamerDescription ?? "꿈을 꾼 사람")}`
    : "꿈을 꾼 사람이";
  const ownerLead = context.dreamer === "someone_else"
    ? `${dreamerPhrase(context)} 이 꿈은`
    : "이 꿈은";
  const insufficientDirect = requestedFocus === "relationship"
    ? "지금 내용만으로는 이 꿈이 관계 문제나 상대의 속마음을 뜻한다고 볼 근거가 없어요. 꿈에 나온 사람이 누구였고 어떻게 행동했는지 하나만 더 있어야 관계 쪽으로 좁힐 수 있습니다."
    : requestedFocus === "recent_context"
      ? "최근 일이 꿈에 섞였는지는 지금 내용만으로 판단하기 어려워요. 꿈과 현실에 공통으로 남은 감정이나 비슷한 장면 한 가지가 있어야 연결할 수 있습니다."
      : requestedFocus === "repetition"
        ? "왜 반복되는지는 지금 내용만으로 판단하기 어려워요. 같은 장면이 몇 번 나왔는지와 매번 깨고 난 뒤 남은 감정이 있어야 이유를 좁힐 수 있습니다."
        : requestedFocus === "good_or_bad"
          ? "나쁜 징조로 볼 근거도, 좋은 일을 예고한다고 볼 근거도 없어요. 꿈속 행동이나 깬 뒤 감정 한 가지가 더 있어야 길흉보다 실제 의미를 좁힐 수 있습니다."
          : "지금 내용만으로는 나쁜 징조나 특정한 심리라고 볼 근거가 없어요. 기억나는 인물·장소·행동·감정 중 하나만 더 있으면 해석을 구체적으로 좁힐 수 있습니다.";
  const directAnswer = requestedFocus === "relationship" && askedRelationshipVerdict
    ? `${context.dreamer === "someone_else" ? `${dreamerPhrase(context)} ` : ""}이 꿈만으로 ${dreamerSubject} 다른 사람을 원한다고 판단할 수는 없어요.${shift ? " 오히려 좋던 관계가 갑자기 소통되지 않고 위협적으로 바뀌면 어떡하나 하는 불안을 보여주는 쪽에 가깝습니다." : specific ? ` 이 꿈에서 읽을 수 있는 주제는 ${meaning}입니다.` : " 꿈속 인물과 행동이 더 있어야 관계 의미를 좁힐 수 있습니다."}`
    : requestedFocus === "relationship"
      ? specific
        ? `${context.dreamer === "someone_else" ? `${dreamerPhrase(context)} ` : ""}꿈만으로 상대의 속마음이나 관계의 결말은 알 수 없어요.${shift ? " 이 꿈이 보여주는 것은 상대의 마음이 아니라, 익숙한 관계가 낯설고 일방적으로 바뀔까 하는 경계입니다." : ` 이 꿈에서 읽을 수 있는 주제는 ${meaning}입니다.`}`
        : insufficientDirect
    : requestedFocus === "recent_context"
      ? reality
        ? `최근의 일이 이 꿈에 섞였을 가능성은 있어요. 사용자가 말한 최근 상황과 꿈의 ${shift ? "관계가 위협적으로 바뀐 장면" : `${first.name} 장면`}가 비슷한 감정을 남겼는지만 살펴볼 수 있고, 직접 원인이라고 단정할 수는 없어요.`
        : specific
          ? `최근 경험이 꿈에 섞였을 수는 있지만, 지금은 특정 사건을 지목할 근거가 없어요. 꿈의 ${first.name} 장면이 가리키는 주제는 ${meaning}입니다. 최근에도 비슷한 감정을 느꼈는지 확인해보세요.`
          : insufficientDirect
    : requestedFocus === "repetition"
      ? context.isRecurring
        ? `이 꿈이 반복되는 건 미래를 예고해서라기보다 같은 마음이 아직 남아 다시 떠오르는 쪽에 가까워요. 구체적인 주제는 ${meaning ?? "반복해서 신경 쓰이는 감정이나 고민"}입니다. 매번 같은 감정과 끝나는 지점을 확인해보세요.`
        : "지금 적어준 내용에는 이 꿈이 반복됐다는 정보가 없어요. 같은 꿈을 몇 번 꿨는지와 반복될 때마다 남는 감정을 알아야 이유를 구체적으로 설명할 수 있습니다."
    : requestedFocus === "good_or_bad"
      ? specific
        ? `좋은 일을 보장하거나 나쁜 일을 예고한다고 보기는 어려워요. 지금 확인되는 주제는 ${meaning}이에요. 특히 꿈의 끝에서 ${feeling ?? "어떤 느낌"}이 남았는지가 중요해요.`
        : insufficientDirect
    : shift
      ? features.numberedPeople
        ? `${ownerLead} 좋던 관계가 갑자기 소통되지 않고 위협적으로 바뀌면 어떡하나 하는 불안을 보여줘요. 다른 사람을 원하는 증거보다는, 신뢰와 안전이 무너질까 걱정한 장면에 가깝습니다.`
        : `${ownerLead} 상대나 상황을 믿어도 되는지 확인할 수 없어 생긴 경계를 보여줘요. 얼굴이 보이지 않은 인물을 실제 특정 사람으로 볼 근거는 없습니다.`
      : specific && arc
        ? `${context.dreamer === "someone_else" ? `${dreamerPhrase(context)} ` : ""}${arc.from}으로 시작했지만 ${arc.to}으로 끝났다는 점이 중요해요. ${meaning}으로 읽을 수 있어요. 처음의 감정만으로 꿈 전체를 판단하지는 않아요.`
      : specific
        ? `${context.dreamer === "someone_else" ? `${dreamerPhrase(context)} ` : ""}지금 확인되는 핵심은 ${meaning}이에요.${feeling ? ` ${feeling}${subjectParticle(feeling)} 남은 만큼, 그 느낌이 최근 어느 순간과 닿는지 살펴볼 만해요.` : action ? " 깨고 난 뒤 느낌을 알면 부담과 회복 중 어느 쪽에 가까운지 더 분명해져요." : ` ${first.name}을 보고 무엇을 했는지와 깬 뒤 느낌이 더 필요해요.`} 다만 이 장면이 앞으로 생길 일을 알려준다고 보지는 않아요.`
        : insufficientDirect;
  const sceneParagraph = !specific
    ? "현재 내용에는 누가, 어디서, 무엇을 했는지가 드러나지 않아요. 그래서 없는 장면 순서나 상징을 만들어내지 않고, 지금 확인되는 정보까지만 답했습니다."
    : shift
    ? features.numberedPeople
      ? `${features.positiveStart ? "좋은 시간을 보낸 " : "익숙하다고 여긴 "}1번 인물에서, ${features.hiddenFace ? "얼굴을 확인하지 못한 " : "정체가 흐려진 "}2번 인물${features.realizedDifferent ? "이 다른 사람임을 알아차리며" : "을 마주하며"} 분위기가 뒤집혀요.${features.conflict ? ` ${features.lateArrival ? "늦은 귀가·" : ""}분노·소통 단절이 관계의 안전감을 흔들고,` : " 확인할 수 없는 정체가 안전감을 흔들며"}${features.zombieThreat ? ` ${features.familyHome ? "가족이 모인 아파트와 " : ""}좀비 공격이 그 불안을 생활공간의 위협으로 넓힙니다.` : " 이 전환이 꿈의 중심이 됩니다."}`
      : `${features.hiddenFace ? "얼굴을 확인하지 못한 인물을 마주하며" : "인물의 정체가 흐려지며"} 분위기가 낯설어져요.${features.conflict ? " 분노와 소통 단절이 안전감을 흔들며" : " 확인할 수 없는 정체가 안전감을 흔들며"}${features.zombieThreat ? ` ${features.familyHome ? "가족이 있는 공간의 " : ""}좀비 위협으로 긴장이 넓어집니다.` : " 그 느낌이 꿈의 중심으로 남습니다."}`
    : `꿈에서 실제로 확인되는 단서는 ${evidence}예요.${arc ? ` 뒤이어 ${arc.to}이 남았다는 점까지 함께 읽었어요.` : action ? ` 특히 ‘${action}’은 ${directActionMeaning(action)}으로 볼 수 있어요.` : ` 다만 ${first.name}을 마주한 뒤 다가갔는지, 피했는지, 지켜봤는지는 아직 알 수 없어 그 부분은 추측하지 않았어요.`}`;
  const psychologyParagraph = !specific
    ? "이럴 때는 상징을 억지로 붙이기보다 깨고 난 뒤 가장 먼저 든 느낌을 보는 게 정확해요. 무서움이면 압박이나 안전 문제, 찝찝함이면 미해결된 일, 편안함이면 회복과 안도 쪽부터 확인할 수 있습니다."
    : reality
    ? shift || threat
      ? "사용자가 말한 최근 상황을 함께 놓으면, 꿈의 위협과 관계 변화가 그때 생긴 놀람이나 불안을 정리했을 가능성은 커져요. 다만 그 상황을 꿈의 직접 원인으로 확정하거나 임상적 의미를 붙일 수는 없어요."
      : `사용자가 말한 최근 상황과 꿈에서 남은 ${feeling ?? "감정"}이 닿아 있을 가능성은 있어요. 다만 어느 사건이 직접 원인이었다고 단정하거나 꿈으로 현실의 결과를 판단할 수는 없어요.`
    : shift
      ? features.mistakenIdentity || features.realizedDifferent
        ? `익숙한 사람이 낯설어지고${threat ? " 보호 공간까지 좀비에게 위협받는" : " 관계가 일방적으로 바뀌는"} 장면은 “안전하다고 믿은 관계나 공간도 갑자기 위험해지면 어떡하지”라는 걱정을 압축한 모습으로 볼 수 있어요.`
        : `얼굴과 정체를 확인하기 어려운 인물${threat ? "에게서 위협까지 이어진 점" : "을 경계한 점"}은, 상대나 상황을 충분히 알 수 없을 때 안전부터 확인하려는 마음과 닿아 있어요.`
      : arc?.to === "안도감"
        ? "최근 조심스럽게 대하던 일에 직접 대응한 뒤 한결 편해진 순간이 있었는지 떠올려보세요. 그런 경험이 있었다면 꿈에서 감정이 바뀐 과정과 연결해볼 수 있어요."
        : `이 장면이 가리키는 주제는 ${meaning}입니다. ${emotionConnection(feeling)}`;
  const ageBoundary =
    context.statedPersonalDetails.some((detail) => /28\s*살/.test(detail)) &&
    context.statedPersonalDetails.some((detail) => /(?:여자|여성)/.test(detail))
    ? " 28살 여성이라는 정보만으로 결혼·독립·진로 불안을 덧붙일 근거도 없습니다."
    : "";
  const limitParagraph = !specific
    ? "지금 내용만으로 길몽·흉몽, 상대의 속마음, 앞으로 생길 일을 판단할 수는 없어요. “누가 무엇을 했고, 나는 어떤 기분이었는지” 한 문장만 더 적으면 됩니다."
    : `${relationshipLimit(context)}${ageBoundary} 현실에서는 ${realityCheckQuestion(context)}`;

  return {
    directAnswer,
    sections: [
      {
        title: "장면을 나눠보면",
        paragraphs: [sceneParagraph]
      },
      {
        title: "심리적으로 가능한 연결",
        paragraphs: [psychologyParagraph]
      },
      {
        title: "꿈만으로 확실히 말할 수 없는 부분",
        paragraphs: [limitParagraph]
      }
    ],
    interpretationChanges: null,
    uncertainty: !specific
      ? []
      : context.uncertainties.length
        ? ["건너뛴 정보는 추측하지 않고 비워두었어요."]
        : [],
    shareableSentences: [],
    suggestedQuestions: specific
      ? suggestedQuestionsForContext(context)
      : ["기억나는 장면을 더 적을게", "깨고 난 뒤 감정을 말할게"],
    generationSource
  };
}

function legacyStructureFromContext(context: DreamContext): DreamStructure {
  const knownActions = new Set(ACTION_PATTERNS.map(([, label]) => label));
  const conciseActions = context.scenes
    .map((scene) => scene.action)
    .filter((action) => action.split(" 뒤 ").every((item) => knownActions.has(item)))
    .slice(0, 3);
  return {
    people: context.people,
    actions: conciseActions.length ? conciseActions : ["장면을 지켜봄"],
    places: context.places,
    emotions: context.emotions,
    symbols: context.symbols,
    recentContext: context.realityContexts[0] ?? null,
    isRecurring: context.isRecurring,
    uncertainty: context.uncertainties
  };
}

export function buildDetailedAssistantPayload(
  context: DreamContext,
  generationSource: AnswerGenerationSource = "local"
): AssistantTurnPayload {
  const first = context.symbols[0];
  const arc = sceneEmotionArc(context);
  const feeling = arc?.to ?? contextFeeling(context);
  const action = contextAction(context);
  const shift = relationshipShiftInterpretation(context);
  const threat = threatInterpretation(context);
  const reality = conciseRealityContext(context);
  const people = compactList(context.people, first.name, 6);
  const places = compactList(context.places, "장소가 선명하지 않은 공간", 5);
  const features = dreamFeatures(context);
  const identitySubject = features.numberedPeople ? "두 번째 인물" : "얼굴이나 정체가 흐린 인물";
  const shiftSteps = features.numberedPeople
    ? [
        features.positiveStart ? "좋은 시간을 보내던 1번 인물" : "1번 인물",
        features.mistakenIdentity ? "같은 사람이라 믿은 2번 인물" : "정체가 흐려진 2번 인물",
        features.hiddenFace ? "보이지 않는 얼굴" : null,
        features.realizedDifferent ? "다른 사람임을 알아차림" : null,
        features.conflict
          ? `${features.lateArrival ? "늦은 귀가·" : ""}분노·소통 단절`
          : null,
        features.zombieThreat
          ? `${features.familyHome ? "가족 아파트의 " : ""}좀비 위협`
          : null
      ]
    : [
        features.mistakenIdentity ? "익숙한 사람이라고 믿음" : null,
        features.hiddenFace ? "보이지 않는 얼굴" : "흐려진 정체",
        features.realizedDifferent ? "다른 사람임을 알아차림" : null,
        features.conflict ? "분노·소통 단절" : null,
        features.zombieThreat ? `${features.familyHome ? "가족이 있는 공간의 " : ""}좀비 위협` : null
      ];
  const shiftFlow = shiftSteps.filter((step): step is string => Boolean(step)).join(" → ");
  const supportingSymbolNames = context.symbols.slice(1, 4).map((symbol) => symbol.name).join("·");
  const directAnswer = shift
    ? `${dreamerPhrase(context)} ‘${identitySubject}이 누구인가’보다 ${shift}가 중심입니다.${features.numberedPeople && features.positiveStart ? " 첫 인물의 편안함이" : " 장면이"}${features.conflict ? ` ${features.lateArrival ? "늦은 귀가·" : ""}분노·소통 단절로` : " 낯섦으로"}${features.zombieThreat ? ` 이어 ${features.familyHome ? "가족 아파트의 " : ""}좀비 위협으로` : ""} 바뀌며 신뢰와 안전의 경계를 드러냅니다. 원인이나 실제 인물의 속마음은 확정할 수 없습니다.`
    : `${dreamerPhrase(context)} ${first.name} 하나의 뜻보다 ‘${action}’으로 이어진 순서에 주목했어요. ${arc ? `${arc.from}에서 ${arc.to}으로 끝난 과정이 해석의 중심이에요.` : `${feeling}${subjectParticle(feeling)} 남았다는 점을 함께 볼 수 있어요.`} 앞서 읽은 의미를 바탕으로, 다른 관점과 현실에서 확인할 점을 더 풀어볼게요.`;
  return {
    directAnswer,
    sections: [
      {
        title: "장면의 흐름에서 먼저 보이는 것",
        paragraphs: [
          shift
            ? `꿈은 ${shiftFlow} 순서로 이어집니다. ${features.mistakenIdentity || features.realizedDifferent ? "익숙함이 의심과 경계로 뒤집히는" : "확인하기 어려운 정체를 경계하는"} 흐름이 핵심이며 실제 사건의 예고는 아닙니다.`
            : `등장 대상은 ${people}, 주요 공간은 ${places}이고 꿈은 ‘${action}’으로 움직입니다. 시작의 감정이 마지막의 위협 또는 안도로 어떻게 바뀌는지가 중요하며, 그 변화는 실제 사건의 예고보다 마음이 무엇을 경계하는지 보여줄 수 있어요.`,
          ...(shift
            ? []
            : [`가장 선명한 ${first.name} 장면도 그 자체보다 앞뒤에서 취한 행동과 ${feeling}${subjectParticle(feeling)} 어떻게 달라졌는지를 함께 봐야 합니다.`])
        ]
      },
      {
        title: "등장한 대상과 나의 반응",
        paragraphs: [
          shift
            ? features.numberedPeople
              ? `첫 번째 인물${features.positiveStart ? "과 보낸 좋은 시간" : "의 익숙함"}은 편안함과 신뢰의 기준점이고, 두 번째 인물의 ${features.conflict ? `${features.lateArrival ? "늦은 귀가·" : ""}분노·소통 단절` : "보이지 않는 얼굴과 달라진 정체"}은 그 기준이 뒤집힌 대비로 볼 수 있어요. ${features.realizedDifferent ? "다른 사람임을 알아챈" : "정체를 확인하려 한"} 전환은 가까운 관계에서 겪고 싶지 않은 모습을 모은 장면일 수 있으며, 현재 연인의 미래나 다른 상대를 원하는 마음의 증거는 아닙니다.`
              : `${features.hiddenFace ? "얼굴이 보이지 않는" : "정체가 흐려진"} 인물은 실제 특정 사람보다 확인할 수 없는 상황에서 느낀 낯섦과 경계를 나타냈을 수 있어요.${features.conflict ? " 분노와 소통 단절은 관계에서 받아들이기 어려운 태도를 더 선명하게 보여줍니다." : " 인물의 정체나 의도를 꿈만으로 채워 넣지는 않는 편이 맞습니다."}`
            : context.people.length
              ? `${people}의 역할을 실제 인물의 속마음으로 바꾸어 해석하기보다, 꿈속에서 그 대상과 가까워졌는지 멀어졌는지, 내 말이 닿았는지 막혔는지를 살펴보는 편이 안전합니다.`
              : `${first.name} 앞에서 보인 ‘${action}’에 주목할 수 있어요. ${explicitContextAction(context) ? `이는 ${directActionMeaning(action)}으로 읽을 수 있어요.` : "그 대상을 마주한 뒤 어떤 기분이 들었는지에 따라 다르게 읽을 수 있어요."}`,
          ...(shift
            ? []
            : [context.people.length
              ? "‘저 사람이 누구를 뜻하나’보다 ‘어떤 대우는 편안했고 어떤 대우는 견디기 어려웠나’를 묻는 편이 꿈을 사실로 오해하지 않으면서 의미 있게 사용할 수 있어요."
              : "이 반응을 현실의 누군가와 바로 연결할 필요는 없어요. 스스로 선택할 수 있었던 순간과 상황에 끌려갔던 순간을 나누어 보면, 내 대응에서 중요하게 느낀 부분을 찾는 데 도움이 돼요."])
        ]
      },
      {
        title: "공간과 분위기",
        paragraphs: [
          threat
            ? `${threat}으로 읽을 수 있어요. ${context.places.length ? `${places}에서 위협을 마주했다는 점은 편안히 머물 수 있는 범위와 불편함의 경계를 살펴보게 해요.` : "위협을 마주했을 때 취한 행동과 남은 기분을 함께 살펴볼 수 있어요."} 좀비는 대화로 해결되지 않고 계속 밀려오는 위협의 성격을 강조할 수 있어요.`
            : `${places}은 생활의 경계와 안전감을 공간으로 보여줄 수 있습니다. ${first.psychological} 다만 공간 하나만으로 가족 관계나 실제 위험을 추론하지는 않아야 해요.`,
          ...(threat
            ? []
            : ["같은 공간도 편안하게 머물렀는지, 벗어나고 싶었는지에 따라 의미가 달라져요. 꿈에서 느낀 분위기를 실제 공간에 대한 평가와 구분해서 살펴보세요."])
        ]
      },
      {
        title: "전통 해몽은 이렇게만 참고하기",
        paragraphs: [
          `${first.traditional} ${supportingSymbolNames ? `함께 나온 ${supportingSymbolNames}도 꿈의 흐름을 보조합니다.` : "다른 상징을 덧붙이기보다 이 장면 앞뒤의 감정을 함께 봅니다."} 이런 설명은 문화적 참고이며 실제 사건을 확정하는 규칙은 아닙니다.`,
          ...(shift
            ? []
            : ["전통적 의미를 적용하더라도 인물이 다가왔는지 멀어졌는지, 문이나 경계를 넘었는지, 꿈꾼 사람이 맞섰는지 피했는지 같은 장면의 방향을 함께 봐야 합니다."])
        ]
      },
      {
        title: "현실 정보가 더해질 때 달라지는 해석",
        paragraphs: [
          reality && (shift || threat)
            ? `사용자가 말한 최근 상황을 새로 고려하면, 꿈의 관계 변화와 위협 장면이 그때 생긴 놀람·걱정·무력감을 정리했을 가능성은 이전보다 커져요. 그렇더라도 특정 사건이 꿈의 직접 원인이라거나 꿈속 ${identitySubject}이 현실의 어느 사람이라고 확정할 수는 없어요.`
            : reality
              ? `말해준 최근 상황과 꿈에서 느낀 ${feeling}${objectParticle(feeling)} 비교해볼 수 있어요. 같은 감정을 남겼다면 연결의 단서가 될 수 있지만, 그 사건이 꿈의 원인이라고 확정할 수는 없어요. 어느 순간이 비슷했고 어느 부분은 달랐는지 나누어 살펴보세요.`
              : `최근에 어떤 일이 있었는지는 아직 알 수 없어요. ${realityCheckQuestion(context)} 비슷한 경험이 있었다면 그때의 느낌과 꿈에서의 ${feeling}${objectParticle(feeling)} 비교해볼 수 있고, 없다면 억지로 연결하지 않아도 괜찮아요.`,
          context.statedPersonalDetails.length
            ? `${context.statedPersonalDetails.join("·")}라는 정보는 말투와 생활 맥락을 이해하는 참고일 뿐입니다. 나이나 성별만으로 독립·결혼·진로 불안을 일반화하지 않습니다.`
            : "나이·성별·직업을 말하지 않았다면 그 정보는 채워 넣지 않습니다."
        ]
      },
      {
        title: "현실에서 확인할 질문과 대화법",
        paragraphs: [
          shift
            ? `${relationshipLimit(context)} 대신 “꿈에서 어느 순간이 가장 무서웠어?”, “${features.numberedPeople ? "두 번째 사람의 어떤 태도가 가장 싫었어?" : "얼굴이 보이지 않을 때 어떤 느낌이었어?"}”, “최근 비슷한 이야기를 듣고 마음이 불편했어?”처럼 꿈꾼 사람의 감정과 경험을 열어두고 물어보는 편이 좋습니다.`
            : `${realityCheckQuestion(context)} 떠오르는 일이 있다면 ‘그때 내가 한 행동’과 ‘그 뒤 남은 느낌’을 한 줄씩 적어보세요. 꿈의 ‘${action}’과 같은 반응이었는지, 현실에서는 다르게 대응했는지 비교하면 지금 필요한 것을 찾기 쉬워요.`,
          context.dreamer === "someone_else"
            ? "해석을 전할 때는 정답처럼 설명하기보다 ‘이런 가능성도 있대, 너는 어떻게 느껴?’라고 동의를 구하세요. 상대가 공감하지 않는다면 다른 설명도 열어두고, 꿈을 꾼 사람이 기억하는 감정과 장면을 먼저 들어주세요."
            : "오늘은 꿈에서 가장 마음에 남은 장면 하나와 닮은 최근의 순간 하나만 적어보세요. 바로 연결되는 일이 없다면 비워두어도 괜찮아요. 꿈을 근거로 중요한 결정을 내리기보다, 내 감정을 설명하는 데 도움이 되는 부분만 가져가세요."
        ]
      }
    ],
    interpretationChanges: null,
    uncertainty: [
      "전통 해몽은 문화적 참고이고, 심리적 연결은 사용자가 말한 현실 정보 안에서만 가능한 설명입니다.",
      "꿈속 인물은 실제 사람과 일대일로 대응하지 않으며, 꿈만으로 욕구·외도·이별·폭력 가능성을 판정할 수 없습니다."
    ],
    shareableSentences: [],
    suggestedQuestions: suggestedQuestionsForContext(context),
    generationSource
  };
}

export function isShareableSentenceRequest(message: string) {
  return /(?:전달|보낼\s*말|한마디|한\s*마디|복사|문장(?:만|으로)|말을\s*써)/.test(message);
}

export function isRelationshipVerdictRequest(message: string) {
  return /(?:다른\s*(?:남자|여자|사람).{0,12}(?:만나|원하|좋아)|외도|바람|헤어지고\s*싶)/.test(message);
}

export function hasNewRealityInformation(message: string) {
  if (isDreamCorrection(message) || /^꿈(?:에서|에선|속)/.test(message.trim())) return false;
  return /(?:사실|실제로|최근|요즘|현실에서는|친구가|배우자가|남편이|아내가|회사에서|관계에서|알고\s*보니)/.test(message);
}

export function updateContextWithMessageLocally(context: DreamContext, message: string) {
  const next = isDreamCorrection(message) || /^꿈(?:에서|에선|속)/.test(message.trim())
    ? applyClarificationsToContext(context, [{questionId:"followup-correction",kind:"scene",answer:message,skipped:false}])
    : structuredClone(context);
  const otherDreamer = inferDreamer(unquotedText(message));
  if (otherDreamer.dreamer === "someone_else") Object.assign(next, otherDreamer);
  if (hasNewRealityInformation(message)) {
    next.realityContexts = unique([...next.realityContexts, message.trim()]).slice(-8);
  }
  next.userQuestions = unique([...(next.userQuestions ?? []), ...extractUserQuestions(message)]).slice(-6);
  next.statedPersonalDetails = unique([...next.statedPersonalDetails, ...statedPersonalDetails(message)]);
  return next;
}

export function buildFollowupAssistantPayload(
  context: DreamContext,
  message: string,
  generationSource: AnswerGenerationSource = "local"
): AssistantTurnPayload {
  const first = context.symbols[0];
  if (isDreamCorrection(message)) {
    const revised = buildBriefFreePayload(context, generationSource);
    return {
      ...revised,
      interpretationChanges: {
        newlyLearned: message.trim(),
        revisedInterpretation: revised.directAnswer || "바로잡은 장면을 기준으로 다시 살펴볼게요."
      }
    };
  }
  const newInfo = hasNewRealityInformation(message) ? message.trim() : null;
  const thirdParty = context.dreamer === "someone_else";
  const shift = relationshipShiftInterpretation(context);
  const threat = threatInterpretation(context);
  const reality = conciseRealityContext(context);
  const violenceContext = Boolean(reality && /가정폭력|폭언|자해/.test(reality));
  const features = dreamFeatures(context);
  const shiftPerson = features.numberedPeople
    ? "얼굴을 확인하지 못한 두 번째 인물"
    : "얼굴이나 정체를 확인하기 어려웠던 인물";

  if (isShareableSentenceRequest(message)) {
    const consent = thirdParty
      ? "이 해석을 전해도 괜찮은지 먼저 물어보고, 정답이 아니라 한 가지 가능성으로 건네보세요."
      : "상대에게는 꿈이 사실을 증명하는 말이 아니라, 내 감정을 설명하는 계기로 전해보세요.";
    const tailoredSentence = violenceContext && shift
      ? `“친구의 힘든 이야기를 듣고 마음이 많이 놀랐던 게 꿈에 섞였을 가능성도 있대. ${features.numberedPeople ? "두 번째 남자가 나온 걸 다른 사람을 원한다는 뜻으로" : "얼굴이 보이지 않는 인물을 현실의 누군가로"} 단정할 수는 없고, 안전한 관계가 낯설고 무서운 모습으로 바뀔까 하는 불안에 더 가까울 수 있대. 이 얘기 같이 해봐도 괜찮을까?”`
      : shift
        ? `“꿈의 ${features.numberedPeople ? "두 번째 사람은 다른 사람을 원한다는 증거라기보다" : "얼굴이 보이지 않는 사람은 실제 누군가를 뜻한다기보다"}, 익숙한 관계가 갑자기 낯설어질까 경계하는 장면일 수 있대. 너는 어느 순간이 가장 불편했는지 같이 얘기해봐도 괜찮을까?”`
        : `“이 꿈을 하나의 가능성으로 풀어보니, ${first.name} 자체보다 그때 느낀 감정과 관계의 경계를 돌아보라는 뜻에 더 가까워 보였어. 너는 어떻게 느꼈는지 같이 얘기해봐도 괜찮을까?”`;
    return {
      directAnswer: "길게 풀이를 반복하지 않고 바로 복사할 수 있는 문장으로 적어드릴게요.",
      sections: [],
      interpretationChanges: newInfo
        ? { newlyLearned: newInfo, revisedInterpretation: "새 정보는 전달 문장의 대상과 어조에 반영했어요." }
        : null,
      uncertainty: [],
      shareableSentences: [
        consent,
        tailoredSentence
      ],
      suggestedQuestions: [],
      generationSource
    };
  }

  const relationshipVerdict = isRelationshipVerdictRequest(message);
  const verdict = relationshipVerdict
    ? `먼저 답하면, 이 꿈만으로 다른 사람을 만나고 싶은 마음이라고 판정할 수는 없어요.${violenceContext ? " 새로 말해준 친구의 가정폭력·폭언과 자해 소식이 꿈의 위협과 관계 불안을 더 선명하게 했을 가능성은 있지만, 직접 원인이라고 확정할 수도 없습니다." : ""}`
    : `먼저 답하면, 질문하신 내용은 ${first.name}의 고정된 뜻보다 꿈에서 남은 ${contextFeeling(context)}과 현실의 맥락을 함께 볼 때 더 자연스럽게 이해할 수 있어요.`;
  const contextSentence = reality
    ? "사용자가 말한 최근 상황을 놓고 보면, 꿈은 특정 욕구의 증거라기보다 그때 느낀 놀람과 필요한 안전 기준을 정리한 장면일 가능성이 있어요."
    : "아직 현실의 구체적인 사건이 충분하지 않아 하나의 관계나 원인에 곧바로 연결하지는 않을게요.";
  const sections: AssistantTurnPayload["sections"] = [
    {
      title: newInfo ? "새 정보가 바꾸는 해석" : "질문과 꿈을 이어보면",
      paragraphs: [
        `${contextSentence} ${shift ? `${shiftPerson}은 ${shift}를 보여주는 장면일 수 있어요.` : first.psychological}${threat ? ` ${threat}으로 이어졌을 수 있어요.` : ""} ${shift ? `꿈속 ${features.numberedPeople ? "두 번째 인물" : "그 인물"}` : "꿈속 대상"}을 현실의 특정 사람과 같다고 보지는 않는 편이 맞습니다.`
      ]
    }
  ];
  if (relationshipVerdict) {
    sections.push({
      title: "다른 사람을 원하는 꿈인가",
      paragraphs: [
        "꿈에서 낯선 남자가 등장했다는 사실보다 그 인물이 불편하고 위협적이었으며, 처음에는 익숙한 사람으로 오인했다가 아니라고 알아차렸다는 흐름이 중요해요. 호감이나 선택의 장면이라기보다 원하지 않는 관계 모습에 대한 경계로 읽을 여지가 더 큽니다. 그래도 실제 연애 욕구는 꿈이 아니라 본인의 말과 현실 행동으로만 확인할 수 있어요."
      ]
    });
  }
  if (/(?:전해|말해).{0,12}(?:괜찮|될까)/.test(message)) {
    sections.push({
      title: "해석을 전해도 될까",
      paragraphs: [
        "전해도 되지만 먼저 듣고 싶은지 물어보고, ‘네 마음이 이렇다는 뜻이야’가 아니라 ‘최근 들은 이야기가 꿈의 불안에 섞였을 가능성도 있대. 너는 어떻게 느껴?’처럼 열어두고 말하세요. 친구의 위험이 지금도 이어진다면 꿈 이야기보다 현재 안전 확인과 실제 도움 연결이 우선입니다."
      ]
    });
  }

  return {
    directAnswer: verdict,
    sections: sections.slice(0, 3),
    interpretationChanges: newInfo
      ? {
          newlyLearned: newInfo.slice(0, 280),
          revisedInterpretation: violenceContext
            ? "처음에는 관계의 정체가 바뀌는 장면과 위협을 넓게 읽었지만, 이제는 가까운 친구의 폭력·자해 소식을 접한 충격이 그 불안한 장면 구성에 영향을 주었을 가능성을 더 크게 봅니다. 그래도 직접적인 인과관계로 확정하지는 않아요. 꿈속 인물을 현실의 특정 사람과 같다고 보지도 않습니다."
            : "처음에는 장면과 감정 중심으로 넓게 읽었지만, 이제는 사용자가 직접 말한 현실 사건이 꿈의 긴장에 영향을 주었을 가능성을 더 크게 봅니다. 그래도 직접적인 인과관계로 확정하지는 않아요."
        }
      : null,
    uncertainty: ["꿈만으로 상대의 의도나 관계의 결론을 확인할 수는 없어요."],
    shareableSentences: [],
    suggestedQuestions: ["이 감정을 현실에서 어떻게 말할까?", "처음 해석과 달라진 점만 정리해줘"],
    generationSource
  };
}
