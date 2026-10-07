import type { AssistantTurnPayload } from "./types";
import { formatSymbolTitle } from "./symbolic-title";

function refreshLegacyMeaning(text: string, title: string) {
  const cleaned = formatSymbolMeaning(text);
  // Only these known legacy templates are replaced; never flatten a bespoke reading.
  if (cleaned === "전통적 관점에서는 공격받는 장면이 갈등이나 위협의 상징으로 여겨지기도 해요. 상징적 해석으로는 거친 자극이나 압박을 드러낸 장면으로 볼 수 있어요.") {
    if (formatSymbolTitle(title) === "때리는 장면") {
      return "때리는 장면은 충돌이나 대응이라는 관점에서 살펴볼 수 있어요. 누가 행동하고 누가 당했는지에 따라 풀이의 중심이 달라져요.";
    }
    if (/^(?:공격받는|맞는) 장면$/.test(formatSymbolTitle(title))) {
      return "공격받는 장면에서는 내 의지와 상관없이 무언가가 밀고 들어온다는 점이 두드러져요. 이런 구도는 감당하기 버거운 요구나 간섭 앞에서, 나를 지킬 여유가 필요한 마음과 맞닿아 있을 수 있어요.";
    }
  }
  if (formatSymbolTitle(title) === "피가 나는 장면" && cleaned === "전통적 관점에서는 피가 생명력이나 강한 에너지의 상징으로 해석되기도 해요. 상징적으로는 장면의 긴장감이나 소모감을 강조하는 표현으로 볼 수 있어요.") {
    return "피가 나는 모습은 마음에 남은 상처나, 무언가에 힘을 쏟으며 느끼는 소모감을 나타낼 수 있어요. 보이지 않던 아픔이 선명한 흔적으로 드러난다는 점에서, 얼마나 강하게 부딪쳤는지보다 그 일이 남긴 여운에 주목하게 돼요.";
  }
  return cleaned;
}

/** Display compatibility for symbolic entries saved before the possibility-first tone. */
export function formatSymbolMeaning(text: string) {
  const disclaimer = "(?:현실(?:의)?\\s*사건을\\s*예고하지(?:는|도)?\\s*않아요|건강이나\\s*미래를\\s*뜻한다고\\s*단정할\\s*수(?:는|도)?\\s*없어요)";
  return text
    .replace(new RegExp(`(볼|읽을|해석할)\\s*수\\s*(?:있지만|있으며|있으나)\\s*,?\\s*${disclaimer}[.!]?`, "g"), "$1 수 있어요.")
    .replace(new RegExp(`(^|[.!?]\\s+)(?:하지만\\s*)?${disclaimer}[.!]?(?=\\s|$)`, "g"), "$1")
    .trim();
}

export function formatFreeSymbolicAnswer(answer: AssistantTurnPayload): AssistantTurnPayload {
  if (answer.freeReadingMode !== "symbolic" || answer.freeCompositionVersion === 2) return answer;
  return {
    ...answer,
    directAnswer: refreshLegacyMeaning(answer.directAnswer, answer.directAnswerTitle ?? ""),
    sections: answer.sections.map(section => ({
      ...section,
      paragraphs: section.paragraphs.map(paragraph => refreshLegacyMeaning(paragraph, section.title))
    }))
  };
}
