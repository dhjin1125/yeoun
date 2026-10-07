import type { SafetyNotice, SafetyRoute } from "./types";
import { splitDreamEvidence, splitOutsideQuotes, unquotedText } from "./dream-evidence";

const CURRENT_RISK = [
  /(?:지금|오늘|당장|계속|깬\s*뒤에도).{0,18}(?:죽고\s*싶|사라지고\s*싶|자해|목숨을\s*끊|극단적\s*선택)/,
  /(?:나는|내가|저는|제가).{0,18}(?:죽고\s*싶|살고\s*싶지\s*않|자해|목숨을\s*끊)/,
  /(?:죽을|자해할|극단적\s*선택을\s*할).{0,10}(?:계획|방법|준비)/,
  /살고\s*싶지\s*않/
];

const THIRD_PARTY_SUBJECT =
  /(?:친구|지인|동료|언니|누나|오빠|형|동생|엄마|어머니|아빠|아버지|배우자|남편|아내|연인|그\s*사람|상대)/;
const THIRD_PARTY_HARM =
  /(?:가정폭력|폭행|맞고|맞았|때리|때렸|죽고\s*싶|자해|목숨을\s*끊|극단적\s*선택|위협)/;
const DREAM_FRAME = /(?:꿈에서|꿈속에서|꿈\s*안에서|악몽\s*속에서)/;
const WAKING_FRAME = /(?:지금|오늘|당장|현실에서|깬\s*뒤에도|실제로|계속)/;

/** A reply to a dream-fact question inherits the dream frame, not a waking event.
 * Explicit present danger and reality reports always retain their own frame.
 */
export function classifyDreamClarificationSafety(text:string, kind:string = "scene"):SafetyRoute {
  const currentReality=/(?:지금|오늘|당장|현실|실제로|최근|요즘|깬\s*뒤)|(?:죽고\s*싶|살고\s*싶지|자해하고\s*싶|자해.{0,8}(?:계획|준비)|자해하고\s*있|맞고\s*있|폭행당하고\s*있)/;
  if (kind === "recent_context" || DREAM_FRAME.test(text) || currentReality.test(unquotedText(text))) return classifySafetyRoute(text);
  return classifySafetyRoute(`꿈에서 ${text}`);
}

export function classifySafetyRoute(text: string): SafetyRoute {
  const normalized = text.replace(/\s+/g, " ").trim();
  const outsideQuote = unquotedText(normalized);
  if (!normalized) return "none";

  const currentSelfStatement = splitOutsideQuotes(text, /[.!?\n]+/).some(clause => {
    const outer = unquotedText(clause);
    const self = /(?:나는|내가|저는|제가)/.test(outer);
    return !DREAM_FRAME.test(outer)
      && CURRENT_RISK.some(pattern => pattern.test(outer) || (self && pattern.test(clause)))
      && (!THIRD_PARTY_SUBJECT.test(outer) || self);
  });
  if (currentSelfStatement) return "immediate_self";

  const explicitWaking = /(?:현실에서|깬\s*뒤(?:에도)?|실제로)/.test(normalized)
    || splitDreamEvidence(text).realityTexts.length > 0;
  // Adverbs such as "계속" describe dreamed actions too; they do not turn a
  // clearly framed dream into a report of ongoing real-world violence.
  if (DREAM_FRAME.test(normalized) && !explicitWaking && !/(?:지금|당장)\s*(?:나는|내가|저는|제가)/.test(normalized)
      && THIRD_PARTY_HARM.test(normalized)) return "dream_only";

  if (/(?:나는|내가|저는|제가)/.test(outsideQuote) && /(?:나는|내가|저는|제가).{0,18}(?:죽고\s*싶|살고\s*싶지\s*않|자해|목숨을\s*끊)/.test(normalized)
      && (!DREAM_FRAME.test(normalized) || explicitWaking || /(?:지금|당장)\s*(?:나는|내가|저는|제가)/.test(normalized))) return "immediate_self";

  if (DREAM_FRAME.test(normalized) && !WAKING_FRAME.test(normalized)) {
    if (/(?:자해|죽고\s*싶|목숨을\s*끊|극단적\s*선택)/.test(normalized)) return "dream_only";
  }

  if (THIRD_PARTY_SUBJECT.test(normalized) && THIRD_PARTY_HARM.test(normalized)) {
    return "third_party";
  }

  if (CURRENT_RISK.some((pattern) => pattern.test(outsideQuote))) return "immediate_self";
  return "none";
}

export function safetyNoticeForRoute(route: SafetyRoute): SafetyNotice | null {
  if (route === "immediate_self") {
    return {
      route,
      title: "해몽보다 지금의 안전을 먼저 살필게요",
      message:
        "지금 스스로를 다치게 할 생각이나 계획이 있다면 혼자 버티지 말고, 가까운 사람에게 현재 상태를 바로 알려주세요. 자살예방 상담전화 109는 24시간 연결됩니다. 당장 위험하거나 이미 다쳤다면 112·119에 연락해 주세요.",
      resources: [
        { label: "24시간 자살예방 상담전화", phone: "109" },
        { label: "긴급한 위험 신고", phone: "112" },
        { label: "응급 구조", phone: "119" }
      ],
      blocksInterpretation: true
    };
  }

  if (route === "third_party") {
    return {
      route,
      title: "그 사람의 현재 안전도 함께 확인해 주세요",
      message:
        "가까운 사람의 폭력이나 자해 이야기를 들은 일은 꿈의 감정에 영향을 주었을 수 있지만, 꿈만으로 직접적인 인과를 확정할 수는 없어요. 위험이 지금도 이어진다면 해석보다 실제 도움 연결이 먼저입니다.",
      resources: [
        { label: "여성긴급전화", phone: "1366" },
        { label: "긴급한 위험 신고", phone: "112" }
      ],
      blocksInterpretation: false
    };
  }

  return null;
}

export function detectSafetyNotice(text: string) {
  return safetyNoticeForRoute(classifySafetyRoute(text));
}

export const SAFETY_LANGUAGE_RULES = [
  /(?:반드시|틀림없이|정확히).{0,12}(?:사고|죽음|질병|외도|이별)/,
  /(?:전혀\s*아니|투영된\s*것이\s*맞)/,
  /복권\s*번호/,
  /태아\s*성별/,
  /의학적\s*진단/
];

const MEDICAL_DISCLAIMER = /(?:의학적\s*진단|진단)(?:을|은|이|이라는\s*것은)?\s*(?:할\s*수(?:는)?\s*없|내릴\s*수(?:는)?\s*없|제공하지\s*않|하지\s*않|아니(?:에요|에|다|라고))/u;

export function unsafeClaimMatches(text: string) {
  const prose = unquotedText(text);
  const sentences = prose.split(/(?<=[.!?。！？\n])/u);
  return sentences.flatMap(sentence => {
    const matches = SAFETY_LANGUAGE_RULES.slice(0, -1).flatMap(pattern =>
      [...sentence.matchAll(new RegExp(pattern.source,"gu"))].map(match => match[0])
    );
    if (!MEDICAL_DISCLAIMER.test(sentence)) {
      matches.push(...[...sentence.matchAll(new RegExp(SAFETY_LANGUAGE_RULES.at(-1)!.source,"gu"))].map(match => match[0]));
    }
    return matches;
  });
}

export function hasUnsafeClaim(text: string) {
  return unsafeClaimMatches(text).length > 0;
}
