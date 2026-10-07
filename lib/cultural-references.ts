import { observedDreamText } from "./dream-evidence";
import type { ReadingSource } from "./types";

/** Cultural records, not a dream → outcome classifier. Add reviewed sources
 * here; the shared composition pipeline also handles symbols absent here. */
export type CulturalReference = ReadingSource & {
  meaning: string;
  /** Only for basic, symbol-level fallback; scene-specific traditions omit it. */
  briefMeaning?: string;
  scope: string;
  meaningTerms: string[];
};

const ENCYCLOPEDIA = "https://encykorea.aks.ac.kr/Article/E0011278";
const DUNG = /똥(?!개|파리|고집)|대변(?!인)|배설물|분뇨/;
const REGISTRY: Array<{ match: RegExp; context?: RegExp; reference: CulturalReference }> = [
  {
    match: DUNG,
    reference: {
      id: "haewoojae-dung-wealth", symbol: "똥", title: "해우재 게재 · e수원뉴스 「새해 똥꿈 많이 꾸세요!」",
      url: "https://haewoojae.com/m/load.asp?idx=1248&page=7&subPage=412",
      meaning: "해우재에 게재된 시민기자 글은 똥을 재물과 이익에 연결하는 문화적 풀이를 소개한다.",
      briefMeaning: "똥은 현실에서의 인상과 달리, 전통 해몽에서는 재물과 이익을 상징하기도 해요. 지저분한 모습에서 오히려 풍요의 의미를 찾는 풀이예요.",
      scope: "똥이라는 기본 상징의 문화적 연상이다. 구르기·놀기·씻기 같은 조합별 전통 규칙이나 실제 금전 결과의 근거는 아니다.",
      meaningTerms: ["재물", "이익", "풍요", "복"]
    }
  },
  {
    match: DUNG,
    reference: {
      id: "aks-dung-luck", symbol: "배설물", title: "한국민족문화대백과사전 「꿈」 · 인체",
      url: ENCYCLOPEDIA,
      meaning: "배설물을 뒤집어쓰는 꿈을 행운과 연결한 민속 해몽 사례가 수록되어 있다.",
      scope: "원자료의 장면은 배설물을 뒤집어쓰는 경우다. 단순히 보거나 치우는 꿈과 같은 사례로 취급하지 않는다.",
      meaningTerms: ["행운", "복"]
    }
  },
  {
    match: /돼지/,
    reference: {
      id: "aks-pig-provisions", symbol: "돼지", title: "한국민족문화대백과사전 「꿈」 · 동물",
      url: ENCYCLOPEDIA,
      meaning: "돼지를 보는 꿈을 먹을 것이 생기는 일과 연결한 민속 풀이가 소개되어 있다.",
      briefMeaning: "돼지를 보는 꿈은 민속 해몽에서 먹거리와 풍요에 연결되기도 해요. 돼지라는 상징을 풍족함의 관점에서 읽어볼 수 있어요.",
      scope: "먹거리와 풍요의 문화적 연상까지만 활용한다. 복권 당첨·금액·시기를 예측하지 않는다.",
      meaningTerms: ["먹을 것", "먹거리", "풍요", "풍족"]
    }
  },
  {
    match: /화재|불길|불이|불을|타오르/,
    context: /집|주택|아파트/,
    reference: {
      id: "aks-house-fire", symbol: "집의 불", title: "한국민족문화대백과사전 「꿈」 · 가옥",
      url: ENCYCLOPEDIA,
      meaning: "집에 불이 나는 꿈을 집안의 번창과 연결한 민속 해몽 사례가 있다.",
      scope: "집에서 난 불에 관한 사례다. 모든 불·산불·화상으로 일반화하거나 실제 손실·이익을 예측하지 않는다.",
      meaningTerms: ["번창", "번성", "성장", "확장"]
    }
  },
  {
    match: /(?<![가-힣])(?:용|청룡|황룡)(?:이|을|은|의|과|에|처럼|\s|$)|드래곤/,
    reference: {
      id: "aks-dragon-ascent", symbol: "용", title: "한국민족문화대백과사전 「꿈」 · 동물",
      url: ENCYCLOPEDIA,
      meaning: "하늘로 오르는 용을 높은 지위와 연결한 민속 풀이가 소개되어 있다.",
      scope: "원자료는 용의 상승 장면이다. 사용자가 상승을 말하지 않았다면 꿈에서 올라갔다고 보충하지 않는다.",
      meaningTerms: ["지위", "성취", "상승"]
    }
  },
  {
    match: /가위/,
    reference: {
      id: "aks-scissors-wealth", symbol: "가위", title: "한국민족문화대백과사전 「꿈」 · 기물",
      url: ENCYCLOPEDIA,
      meaning: "가위를 보는 꿈을 재물에 연결한 민속 해몽 사례가 수록되어 있다.",
      briefMeaning: "가위는 무언가를 자르는 도구이지만, 민속 해몽에는 가위를 보는 꿈을 재물에 연결한 풀이도 있어요. 도구의 쓰임에서 찾는 의미와 문화적으로 전해지는 의미가 다른 상징이에요.",
      scope: "가위눌림이 아닌 실제 가위가 등장한 경우에만 사용한다. 자르는 대상·행동의 의미는 별도의 장면 풀이로 구분한다.",
      meaningTerms: ["재물", "풍요"]
    }
  }
];

export function culturalReferencesForDream(text: string): CulturalReference[] {
  const active = observedDreamText(text).replace(/가위눌[^\s,.!?]*/g, "");
  return REGISTRY.filter(item => item.match.test(active) && (!item.context || item.context.test(active)))
    .map(item => item.reference);
}

export function referenceMatchesSymbol(reference: CulturalReference, evidence: string) {
  return REGISTRY.find(item => item.reference.id === reference.id)?.match.test(evidence) ?? false;
}

/** URLs and source labels come only from the reviewed registry, never the model. */
export function resolveReadingSources(ids: string[], available: CulturalReference[]): ReadingSource[] | null {
  const unique = [...new Set(ids)];
  if (unique.some(id => !available.some(reference => reference.id === id))) return null;
  return unique.map(id => {
    const { symbol, title, url } = available.find(reference => reference.id === id)!;
    return { id, symbol, title, url };
  });
}
