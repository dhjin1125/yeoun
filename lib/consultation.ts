import { isDreamCorrection, observedDreamText, splitDreamEvidence } from "./dream-evidence";
import { interpretationQuestionForFocus } from "./interpretation-focus";
import { PAID_READING_MODEL, PAID_READING_SECTIONS } from "./paid-reading-model";
import type { AssistantTurnPayload, ClarificationAnswer, ConsultationPlan, DreamContext, PaidOffer, UserTurnPayload } from "./types";

export function classifyUserMessage(text: string): NonNullable<UserTurnPayload["intent"]> {
  const trimmed = text.trim();
  if (/^(?:안녕(?:하세요)?|hi|hello)[!.\s]*$/i.test(trimmed)) return "reaction";
  if (forgotDetail(trimmed)) return "dream_fact";
  if (/^(?:아[,.! ]*)?(?:그렇[구궂군]나|그렇군요|그랬구나|알겠(?:어|어요|습니다)|알았어|고마워(?:요)?|감사(?:해요|합니다)|응|네|넵|ㅇㅇ|아하|오케이|좋아(?:요)?)[.!?~\sㅋㅎ]*$/.test(trimmed)) return "reaction";
  if (isDreamCorrection(trimmed) || /(?:내가|저는|제가).{0,12}(?:맞은|맞았|때린).{0,8}(?:거야|거예요)|(?:잘못\s*읽|오독|정정|그게\s*아니라)/.test(trimmed)) return "correction";
  if (/문장.{0,12}(?:이상|잘렸|끊|중복)|(?:다시\s*(?:써|작성|생성)|생성\s*오류|너무\s*일반적|무료와\s*차이)/.test(trimmed)) return "repair";
  if (/무슨\s*뜻|어떤\s*의미|[?？]|알려\s*줘|해석해|연결해|설명해|풀어\s*줘|봐\s*줘|봐\s*주세요|말해\s*줘|써\s*줘|해\s*주세요|질문(?:이에요|할|해도|하고|이\s*있)|(?:나요|까요|인가요|건가요|일까)[.!?~\s]*$|^(?:왜|어떻게|뭐|뭔)/.test(trimmed)) return "question";
  if (!splitDreamEvidence(trimmed).dreamText) return "reality_context";
  if (/(?:꿈|장소|사람|마지막|처음|피|맞|때렸|때린|했|였|었|봤|났|났|나왔|후련|무서|편안)/.test(trimmed)) return "dream_fact";
  // An unrecognized statement is not permission to spend a deepening credit.
  return "dream_fact";
}

export function forgotDetail(text: string) {
  return /^(?:잘\s*)?(?:기억(?:이|나지|은)?\s*(?:안\s*나|않|없)|모르겠|잘\s*모르)/.test(text.trim());
}

export function sourceForContext(context: DreamContext) {
  return observedDreamText(splitDreamEvidence(context.dreamEvidence ?? "").dreamText);
}

export function unresolvedActionRole(source: string) {
  const action = /때리|때렸|때린|때림|폭행|공격/;
  if (!action.test(source)) return false;
  const clauses = source.split(/[.!?\n]+/).filter(clause=>action.test(clause));
  return clauses.some(clause => {
    if (/맞았|맞은|맞는|맞고|공격받|공격당|폭행당/.test(clause)) return false;
    // Role evidence must occur with the action, not just somewhere in the dream.
    if (/(?:내가|제가|나는|저는)(?:(?![쫓쫒](?:겼|기)|도망|그리고|왔고|누가|누군가|사람이|친구가).){0,24}(?:때리|때렸|때린|공격|폭행)|(?:나를|저를|내게|저에게).{0,12}(?:때리|때렸|때린|공격|폭행)|(?:서로|다른\s*사람들).{0,12}(?:싸|때리)|(?:때리|공격).{0,10}(?:당했|받았)/.test(clause)) return false;
    return true;
  });
}

export function buildConsultationPlan(context: DreamContext, answers: ClarificationAnswer[] = []): ConsultationPlan {
  const sourceText = sourceForContext(context);
  const facts = sourceText.split(/(?<=[.!?])\s+|\n+/).map(s=>s.trim()).filter(Boolean);
  const confirmations = answers.filter(answer=>answer.questionId.startsWith("confirm-") || answer.questionId.startsWith("consult-"));
  const unknown = confirmations.some(answer=>answer.skipped || forgotDetail(answer.answer ?? ""));
  const keyElements: ConsultationPlan["keyElements"] = [];
  const seeds = [
    { expression: /[쫓쫒]아오[가-힣]*|[쫓쫒]기[가-힣]*|[쫓쫒]겼[가-힣]*/, label: "쫓아오는 장면" },
    { expression: /때리[가-힣]*|때렸[가-힣]*|맞았[가-힣]*|맞는/, label: "때리거나 맞는 장면" },
    { expression: /피(?:가)?\s*(?:나[가-힣]*|흐[가-힣]*)/, label: "피가 나는 장면" }
  ];
  for (const seed of seeds) { const match = sourceText.match(seed.expression); if (match) keyElements.push({label:seed.label,evidence:match[0]}); }
  const ambiguousRole = unresolvedActionRole(sourceText) && !answers.some(answer=>!answer.skipped && /맞|때리|때렸|때린|서로\s*싸|다른\s*사람들이\s*싸|공격|폭행/.test(answer.answer ?? "") && !unresolvedActionRole(answer.answer ?? ""));
  const hasAction = context.scenes.some(scene=>!/(?:구체적|기억이|살펴볼|드러나지)/.test(scene.action)) || /(?:했|었|였|봤|났|가다|오다|기다|걷|날아|움직|타고|치고|막히)/.test(sourceText);
  const hasDetail = sourceText.replace(/\s/g, "").length >= 35 || context.emotions.length > 0 || answers.some(answer=>!answer.skipped && !forgotDetail(answer.answer ?? "") && answer.kind === "emotion");
  const unresolved = ambiguousRole ? ["행동의 주체와 대상"] : !hasAction || !hasDetail ? ["해석을 좁힐 행동이나 감정"] : [];
  const limited = unresolved.length > 0 && (unknown || confirmations.length >= 2);
  const question: ConsultationPlan["question"] = unresolved.length && !limited ? ambiguousRole ? {
    id: "confirm-action-role", kind: "scene", prompt: "때리는 장면에서 어떤 상황이었나요?",
    options: ["내가 맞았어요", "내가 때렸어요", "서로 싸웠어요", "다른 사람들이 싸웠어요", "기억나지 않아요"],
    placeholder: "누가 누구에게 어떤 행동을 했는지 기억나는 만큼 적어주세요.",
    reason: "누가 행동했고 누가 당했는지에 따라 풀이의 중심이 달라져요."
  } : {
    id: hasAction ? "confirm-ending" : "confirm-action", kind: hasAction ? "emotion" : "scene",
    prompt: hasAction ? "꿈의 마지막에는 어떤 기분이었나요?" : "그 장면에서 어떤 일이 있었나요?",
    options: ["기억나지 않아요"], placeholder: "기억나는 내용만 적어주세요.",
    reason: hasAction ? "마지막에 남은 느낌으로 어떤 해석이 더 잘 맞는지 좁혀볼게요." : "대상의 뜻보다 그곳에서 일어난 일이 해석을 바꿀 수 있어요."
  } : null;
  const sectionTopics: ConsultationPlan["sectionTopics"] = ["narrative"];
  if (context.people.length && !ambiguousRole) sectionTopics.push("role");
  if (context.emotions.length) sectionTopics.push("emotion");
  if (context.places.length) sectionTopics.push("place");
  if (context.realityContexts.length) sectionTopics.push("reality");
  return {version:2, sourceText, facts, keyElements, sequenceConfirmed: /처음|나중|마지막|그\s*뒤|그러고|이후|다가|더니/.test(sourceText), unresolved, question, ready: !unresolved.length, limited, sectionTopics};
}

function alreadyAnsweredPartnerQuestion(source: string, plan: ConsultationPlan) {
  const question = plan.question?.prompt ?? "";
  if (!/스킨[십쉽]/.test(question) || !/상대|대상|누구/.test(question)) return false;

  // A named participant doing a joint action is explicit evidence. Do not let
  // a saved planner question reinterpret a waking bed companion as that actor.
  const dreamEnd = /꿈(?:을)?\s*(?:꿨|꿨어|꾸었)/.exec(source);
  const scene = dreamEnd ? source.slice(0, dreamEnd.index) : source;
  const waking = dreamEnd ? source.slice(dreamEnd.index + dreamEnd[0].length) : "";
  const action = /스킨[십쉽]/.exec(scene);
  if (!action || /누군|모르|낯선|불분명|기억.{0,6}(?:안|않)|아니|말고|다른/.test(scene)) return false;
  const beforeAction = scene.slice(0, action.index);
  const actors = [...beforeAction.matchAll(/(?:여자애|남자애|여자친구|남자친구|친구|동료|아내|남편|배우자|연인|애인)(?:가|이|와|과|랑|하고)/g)];
  if (actors.length !== 1 || !/알던|아는|만나던|사귀던|친구|동료|아내|남편|배우자|연인|애인/.test(beforeAction)) return false;
  if (!/같이|함께|서로/.test(beforeAction.slice(actors[0].index! + actors[0][0].length))) return false;
  const wakingPeople = /자고\s*있/.test(waking)
    ? waking.match(/여자친구|남자친구|아내|남편|배우자|연인|애인/g) ?? [] : [];
  return plan.unresolved.every(item =>
    (/스킨[십쉽]/.test(item) && /상대|대상/.test(item)) ||
    (/꿈/.test(item) && /역할/.test(item) && wakingPeople.some(person => item.includes(person)))
  );
}

export function activeConsultationPlan(context: DreamContext, answers: ClarificationAnswer[] = []) {
  const fallback = buildConsultationPlan(context, answers);
  const saved = context.consultation;
  if (!saved || saved.sourceText !== fallback.sourceText) return fallback;
  // Model plans can add questions, never bypass the local role guard or a skipped answer.
  if (fallback.unresolved.includes("행동의 주체와 대상")) return fallback;
  if (saved.question && answers.some(answer=>answer.questionId === saved.question?.id && (answer.skipped || forgotDetail(answer.answer ?? "")))) return {...saved,ready:false,limited:true,question:null};
  if (fallback.ready && !saved.limited && alreadyAnsweredPartnerQuestion(fallback.sourceText, saved)) {
    return { ...saved, ready: true, unresolved: [], question: null };
  }
  return saved;
}

export function consultationGuidance(context: DreamContext, answers: ClarificationAnswer[] = []) {
  const plan = activeConsultationPlan(context, answers);
  return {ready:plan.ready, kind: plan.question?.kind ?? "scene" as const, questionId:plan.question?.id,
    question:plan.question?.prompt ?? (plan.limited ? "지금 기억으로는 짧은 첫 읽기까지 제공할 수 있어요." : "빠진 내용이나 잘못 읽은 부분이 있나요?"),
    placeholder:plan.question?.placeholder ?? "새로 기억난 꿈의 사실을 적어주세요.", options:plan.question?.options ?? [], reason:plan.question?.reason, limited:plan.limited};
}

export function boundedFirstReading(plan: ConsultationPlan): AssistantTurnPayload {
  const elements = plan.keyElements.map(item=>item.label);
  return {qualityVersion:2, freeReadingMode:"symbolic", generationSource:"local", directAnswerTitle:"기억난 장면의 첫 읽기",
    directAnswer: elements.length ? `기억에 남은 건 ${elements.join(", ")}이에요. 충돌이나 긴장이라는 관점에서 살펴볼 수 있어요. 누가 행동하고 누가 당했는지에 따라 같은 장면도 다르게 읽혀요.` : "기억난 장면부터 살펴볼게요. 대상 하나의 뜻보다 그 안에서 무슨 일이 있었는지가 풀이의 방향을 잡아줘요.",
    sections:[], interpretationChanges:null, uncertainty:[], shareableSentences:[], suggestedQuestions:[], evidenceQuotes:plan.keyElements.map(item=>item.evidence)};
}

export const REPORT_LEAK = /아직 구체적이지 않은|장면\s*장면|꿈에서의\s*꿈에서|장소가 선명하지 않은 공간|나이[·ㆍ,\s]*성별[·ㆍ,\s]*직업|정보는 채워 넣지|내부 (?:규칙|지침)|promisedSectionTitle|symbolNotes|dreamContext|JSON|프롬프트/;
export function reportCopyFindings(payload: AssistantTurnPayload) {
  const fields = [
    { target: "directAnswerTitle", text: payload.directAnswerTitle ?? "" },
    { target: "directAnswer", text: payload.directAnswer },
    ...payload.sections.map((s, index) => ({ target: `section:${index}`, text: [s.title, ...s.paragraphs].join("\n") })),
    { target: "interpretationChanges", text: [payload.interpretationChanges?.newlyLearned, payload.interpretationChanges?.revisedInterpretation].filter(Boolean).join("\n") }
  ];
  return fields.flatMap(field => [...field.text.matchAll(new RegExp(REPORT_LEAK.source, "g"))]
    .map(match => ({ target: field.target, quote: match[0] })));
}

export function reportCopyError(payload: AssistantTurnPayload) {
  // Word counts cannot distinguish a useful interpretive limit from filler.
  // The independent reviewer checks substantive repetition and paid value.
  return reportCopyFindings(payload).length ? "REPORT_INTERNAL_OR_PLACEHOLDER" : null;
}

export function buildConsultationOffer(context: DreamContext, plan = activeConsultationPlan(context)): PaidOffer {
  const source = sourceForContext(context);
  // Only quote observed dream material. A model label, an unanswered question,
  // or a recent real-life event must not become a dreamed scene in the offer.
  const candidates = [...plan.keyElements.map(item => item.evidence), ...plan.facts];
  const excerpts: string[] = [];
  for (const candidate of candidates) {
    const clean = candidate.trim().replace(/[.!?。！？]+$/, "");
    if (clean.length < 2 || !source.includes(candidate.trim())) continue;
    if (excerpts.some(excerpt => excerpt.includes(clean) || clean.includes(excerpt))) continue;
    excerpts.push(clean);
    if (excerpts.length === 2) break;
  }
  const label = (value: string) => value.length > 24 ? `${value.slice(0, 24).trimEnd()}…` : value;
  const [first, second] = excerpts.map(label);
  const selectedFocusQuestion = interpretationQuestionForFocus(context.selectedFocus);
  const explicitQuestion = context.userQuestions?.find(question => question !== selectedFocusQuestion)?.trim();
  const focusCopy: Partial<Record<NonNullable<DreamContext["selectedFocus"]>, {headline:string; bridge:string}>> = {
    relationship: {headline:"그 사람이 나온 이유와 내 마음이 궁금하다면",bridge:"그 사람과 꿈속에서 한 행동, 그 장면에서 살펴볼 마음과 최근의 계기를 함께 풀어드려요."},
    recent_context: {headline:"최근 어떤 경험이 이 꿈과 연결될까요?",bridge:"알려준 현실 상황을 살펴보고, 일상에서 떠올려볼 만한 구체적인 계기까지 설명해요."},
    repetition: {headline:"반복되거나 오래 남는 이유를 어디까지 볼 수 있을까요?",bridge:"반복 여부를 미리 단정하지 않고, 이번 꿈에서 확인한 장면을 중심으로 읽어요."},
    good_or_bad: {headline:"길흉보다, 이 꿈에서 더 살펴볼 점은 무엇일까요?",bridge:"좋고 나쁨을 단정하기보다 실제 장면이 어떤 의미를 만드는지 살펴볼게요."},
    overall: {headline:"왜 이런 꿈을 꿨는지 한 걸음 더 들어가 볼까요?",bridge:"장면에서 살펴볼 마음, 최근의 계기, 여러 풀이 중 내게 더 맞는 쪽을 구체적으로 알아봐요."}
  };
  const focus = context.selectedFocus ?? "overall";
  const personalized = focusCopy[focus] ?? focusCopy.overall!;
  const headline = explicitQuestion && explicitQuestion.length <= 64
    ? `‘${explicitQuestion.replace(/[?？]+$/, "")}’를 꿈의 장면과 함께 살펴볼까요?`
    : personalized.headline;
  const firstTitle = plan.sectionTopics.includes("reality")
    ? "꿈속 인물과 행동은 어떻게 이어질까요?"
    : first && second
      ? `‘${first}’와 ‘${second}’를 함께 보면?`
      : first ? `‘${first}’는 꿈 전체에서 어떤 의미일까요?` : "상징과 장면은 어떻게 연결될까요?";
  const integrationPromise = plan.sectionTopics.includes("reality")
    ? "꿈속 인물의 역할과 실제 행동이 어떻게 한 장면을 이루는지, 확인된 단서를 연결해 풀어드려요."
    : plan.sequenceConfirmed
      ? "앞뒤 장면의 변화와 대상의 특징이 꿈 전체에서 어떤 의미를 만드는지 연결해 풀어드려요."
      : "함께 등장한 대상의 특징과 행동이 꿈 전체에서 어떤 의미를 만드는지 연결해 풀어드려요.";
  const cards: PaidOffer["cards"] = [
    {key:"traditional",title:firstTitle, firstSentence:integrationPromise, evidenceSceneOrders:[], promisedSectionTitle:PAID_READING_SECTIONS[0].title},
    {key:"psychology",title:"그 행동에서 어떤 속마음을 살펴볼 수 있을까요?",firstSentence:"바라고 있거나 피하고 싶은 마음을 꿈속 행동과 연결해, 일상적인 말로 구체적으로 풀어드려요. 실제 성향을 판정하는 설명은 아니에요.",evidenceSceneOrders:[],promisedSectionTitle:PAID_READING_SECTIONS[1].title},
    {key:"pattern",title:"최근 어떤 경험이 이 꿈과 연결될까요?",firstSentence:context.realityContexts.length
      ? "깨어 있을 때 알려준 현실 맥락과 꿈속 행동을 구분하고, 추가로 떠올려볼 만한 일상 속 계기 2~3개를 연결해요."
      : "최근 접한 이야기나 기억, 마음에 남은 일이 어떤 생각을 거쳐 꿈의 장면과 연결될 수 있는지 사례 2~3개로 풀어드려요.",evidenceSceneOrders:[],promisedSectionTitle:PAID_READING_SECTIONS[2].title},
    {key:"action",title:"여러 풀이 중 내게 더 맞는 쪽은 무엇일까요?",firstSentence:"가능한 해석들을 구별하는 행동·느낌·현실의 단서를 비교해, 어떤 풀이가 더 잘 맞는지 설명해드려요.",evidenceSceneOrders:[],promisedSectionTitle:PAID_READING_SECTIONS[3].title}
  ];
  const bridge = explicitQuestion && explicitQuestion.length <= 64
    ? "궁금했던 이유를 더 깊이 읽고, 살펴볼 마음과 최근의 계기, 내게 맞는 풀이까지 연결해요."
    : personalized.bridge;
  const checkoutSections = ["장면의 연결과 속마음", "최근 계기 2~3개", "나에게 맞는 풀이 비교", "심화 질문 2회"];
  return {variant:PAID_READING_MODEL,headline,bridge,checkoutTitle:"내 꿈과 마음을 연결하는 상세 풀이",checkoutSummary:checkoutSections.join(" · "),cta:"상세 해몽 보기",trustLines:[],riskClass:"standard",cards};
}

/** Explicit mock/review product only. Never used to replace a failed paid model response. */
export function buildReviewReport(context: DreamContext, answers: ClarificationAnswer[] = []): AssistantTurnPayload {
  const plan = activeConsultationPlan(context, answers);
  const facts = plan.facts;
  const added = answers.filter(a=>!a.skipped && a.answer && !forgotDetail(a.answer)).map(a=>a.answer!);
  const last = facts.at(-1) ?? "";
  return {qualityVersion:2,paidReadingModel:PAID_READING_MODEL,generationSource:"local",directAnswerTitle:"확인한 내용으로 읽는 꿈",freeReadingMode:undefined,
    directAnswer:`${facts.map(f=>`‘${f}’`).join(" ")} 이 기록에서 행동과 감정이 어떻게 맞물리는지 함께 읽어볼 수 있어요.`,
    sections:[
      {title:PAID_READING_SECTIONS[0].title,paragraphs:[`말해준 장면은 ${plan.sequenceConfirmed ? "처음과 마지막의 차이" : "함께 남은 요소의 차이"}를 중심으로 살펴볼 수 있어요. ${last ? `‘${last}’라는 기억은 그 장면이 남긴 인상을 이해하는 단서예요.` : "기억난 사실 안에서 읽어볼게요."}`]},
      {title:PAID_READING_SECTIONS[1].title,paragraphs:["꿈에서 다가가거나 피하고, 붙잡거나 놓아준 행동을 바라는 마음과 연결해볼 수 있어요. 이 화면은 기능 확인용 예시이며 실제 AI의 개인화된 풀이가 아니에요."]},
      {title:PAID_READING_SECTIONS[2].title,paragraphs:[context.realityContexts.length ? `알려준 현실 상황인 ‘${context.realityContexts.join(". ")}’와 꿈속 반응을 비교해볼 수 있어요. 실제 서비스에서는 이 장면과 맞닿는 계기도 조건부 사례로 설명해요.` : "최근 비슷한 이야기를 접했다면, 그때 떠오른 생각과 꿈속 행동을 연결해볼 수 있어요. 실제 AI에서는 입력한 장면에 맞는 구체적인 사례를 제시해요."]},
      {title:PAID_READING_SECTIONS[3].title,paragraphs:[`상징의 의미와 직접 들려준 행동·감정을 함께 연결해 살펴봤어요. ${added.length ? "추가로 확인한 답변을 반영해 처음 읽기의 범위를 좁혔어요." : "처음 적어준 구체적인 내용을 바탕으로 읽었어요."}`]}
    ], interpretationChanges:added.length ? {newlyLearned:added.join(". "),revisedInterpretation:"추가 답변에서 확인한 행동과 감정을 상징의 의미와 연결해, 이 꿈에 맞는 읽기의 범위를 좁혔어요."} : null,
    uncertainty:[],shareableSentences:[],suggestedQuestions:["이 해석과 다른 가능성은 어떻게 구분하나요?"],evidenceQuotes:facts};
}
