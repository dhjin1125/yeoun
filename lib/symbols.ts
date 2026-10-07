import type { DreamSymbol } from "./types";

type SymbolDefinition = DreamSymbol & { patterns: RegExp[] };

// All copy in this catalog was written for 여운. It is intentionally small and
// does not import or paraphrase the collected third-party dream dictionary data.
const CATALOG: SymbolDefinition[] = [
  {
    key: "identity-shift",
    name: "뒤바뀐 사람·보이지 않는 얼굴",
    patterns: [
      /(?:1\s*번|첫\s*번째).{0,40}(?:2\s*번|두\s*번째)/,
      /(?:(?:나|저)|남친|남자친구|오빠|같은\s*사람)인\s*줄/,
      /얼굴(?:이|은)?\s*(?:안\s*보|보이지\s*않|없는)/,
      /(?:알고\s*보니|생각해\s*보니).{0,24}(?:아니|다른)/
    ],
    traditional: "전통적인 상징 읽기에서는 사람이 바뀌거나 얼굴이 흐린 장면을 관계의 실체가 아직 분명하지 않거나 경계를 살펴야 하는 변화로 보기도 합니다.",
    psychological: "사람의 얼굴이나 정체가 흐려지거나 익숙하다고 믿은 대상이 낯설어지는 장면은, 특정 인물보다 확인하기 어려운 상황에서 느낀 경계를 표현했을 수 있습니다.",
    action: "요즘 관계에서 꼭 지켜졌으면 하는 약속과 소통 방식이 무엇인지 한 가지씩 말해보세요."
  },
  {
    key: "relationship-conflict",
    name: "분노·소통 단절",
    patterns: [/(?:화(?:를)?\s*내|소리\s*지르|폭언)/, /말(?:을|도)?\s*(?:안|않)\s*(?:듣|들어)/, /대화가\s*안\s*통/],
    traditional: "다툼과 닫힌 대화는 오래된 해몽에서도 관계의 기운이 부딪히거나 풀리지 않은 말이 쌓인 장면으로 살펴보곤 합니다.",
    psychological: "내 말이 닿지 않고 상대의 감정을 통제할 수 없는 상황에 대한 거부감이나 경계가 과장된 장면으로 나타났을 수 있습니다.",
    action: "현실에서 편안한 대화에 꼭 필요한 태도와 받아들이기 어려운 태도를 나눠 적어보세요."
  },
  {
    key: "zombie-threat",
    name: "좀비·집단 위협",
    patterns: [/좀비/, /괴물.{0,20}(?:공격|쫓아|달려들)/, /(?:들어가|다가가).{0,20}공격당/],
    traditional: "정체를 잃은 존재가 몰려오거나 침입하는 장면은 바깥의 혼란이 생활의 경계 안으로 번지는 모습으로 읽기도 합니다.",
    psychological: "대화가 통하지 않고 계속 밀려오는 위협은 감당하기 벅찬 사건이나 타인의 고통을 접한 뒤 생긴 긴장을 표현했을 가능성이 있습니다.",
    action: "요즘 반복해서 떠오르는 걱정과 실제로 지금 확인할 수 있는 안전 정보를 구분해보세요."
  },
  {
    key: "water",
    name: "물",
    patterns: [/(?<![가-힣])물(?:이|을|에|속|가|은|만|도|처럼|\s|[,.!?]|$)/, /바다|바닷물/, /강물/, /파도/, /홍수/, /수영/],
    traditional: "전통적으로 물의 맑기와 흐름은 일의 순환, 재물의 움직임, 감정의 기세를 읽는 단서로 여겨집니다.",
    psychological: "심리적으로는 감정이 얼마나 차오르거나 흘러가고 있는지를 비추는 장면일 수 있습니다.",
    action: "최근 감정이 편안히 흐른 순간과 벅차올랐던 순간을 각각 적어보세요."
  },
  {
    key: "snake",
    name: "뱀",
    patterns: [/뱀/, /구렁이/, /독사/],
    traditional: "전통 해몽에서는 뱀을 강한 생명력, 기회, 관계의 긴장처럼 양면적인 변화의 상징으로 보기도 합니다.",
    psychological: "가까이 다가온 변화에 대한 매혹과 경계가 동시에 있을 때 나타나는 이미지일 수 있습니다.",
    action: "끌리지만 조심스러운 일이나 관계가 있는지 살펴보세요."
  },
  {
    key: "teeth",
    name: "이빨",
    patterns: [/이빨/, /치아/, /이가\s*(?:빠|부러)/],
    traditional: "이빨은 전통적으로 가족 관계, 생활 기반, 말과 체면의 변화를 살피는 상징으로 다뤄집니다.",
    psychological: "통제력을 잃거나 중요한 말을 제대로 전하지 못할까 걱정할 때 떠오르기 쉬운 이미지입니다.",
    action: "최근 삼켰던 말 한 가지를 안전한 표현으로 바꿔 적어보세요."
  },
  {
    key: "chase",
    name: "쫓김",
    patterns: [/쫓(?:기|겼|아오|아왔)/, /도망/, /추격/],
    traditional: "쫓기는 장면은 해결되지 않은 일, 압박, 피하고 싶은 변화가 가까워졌다는 신호로 읽히곤 합니다.",
    psychological: "미뤄둔 결정이나 감당하기 버거운 기대가 마음속에서 계속 따라오는 모습일 수 있습니다.",
    action: "미루고 있는 일을 가장 작은 한 단계로 나눠보세요."
  },
  {
    key: "falling",
    name: "추락",
    patterns: [/떨어(?:졌|지는|질|져)/, /추락/, /낭떠러지/],
    traditional: "높은 곳에서 떨어지는 꿈은 지위나 계획의 흔들림을 경계하는 장면으로 해석되기도 합니다.",
    psychological: "예측하기 어려운 상황에서 통제력을 놓칠까 긴장하는 마음이 몸의 감각으로 표현된 것일 수 있습니다.",
    action: "내가 통제할 수 있는 것과 없는 것을 두 칸으로 나눠 적어보세요."
  },
  {
    key: "death",
    name: "죽음",
    patterns: [/죽(?:었|는|음|었다)/, /장례/, /시체/],
    traditional: "전통 해몽에서 꿈속 죽음은 오래된 국면이 끝나고 새 흐름이 시작되는 전환의 상징으로 볼 수 있어요.",
    psychological: "관계나 역할, 습관의 변화가 클 때 마음이 ‘끝’의 이미지로 정리하는 과정일 수 있습니다.",
    action: "이제 놓아도 되는 역할과 새로 시작하고 싶은 일을 하나씩 적어보세요."
  },
  {
    key: "ancestor",
    name: "조상·가족 어른",
    patterns: [/조상/, /할머니/, /할아버지/, /돌아가신\s*(?:분|부모|가족)/],
    traditional: "가족 어른은 전통적으로 보호, 집안의 기억, 중요한 선택 앞의 조언을 상징하는 존재로 여겨집니다.",
    psychological: "지금의 선택을 오래된 가치나 가족의 기준과 비교하고 있다는 뜻일 수 있습니다.",
    action: "그분이 실제로 자주 하던 말과 지금 내가 듣고 싶은 말을 구분해보세요."
  },
  {
    key: "ex",
    name: "전 연인",
    patterns: [/전\s*(?:남친|여친|연인|애인)/, /헤어진\s*(?:사람|애인)/],
    traditional: "지난 인연의 등장은 되돌아감보다 미처 정리되지 않은 감정이나 관계의 교훈을 돌아보는 장면으로 읽힙니다.",
    psychological: "그 사람 자체보다 당시의 내 모습이나 지금 관계에서 되풀이되는 감정이 호출됐을 수 있습니다.",
    action: "그 시절의 나에게 지금 해주고 싶은 말을 한 문장 적어보세요."
  },
  {
    key: "pregnancy",
    name: "임신·아기",
    patterns: [/임신/, /아기/, /출산/, /태몽/],
    traditional: "임신과 아기는 결실, 새로운 책임, 아직 드러나지 않은 가능성의 이미지로 해석되곤 합니다.",
    psychological: "오래 품어온 계획이 형태를 갖추거나, 새 책임을 맞을 준비와 부담이 함께 커진 상태일 수 있습니다.",
    action: "지금 키우고 있는 계획에 필요한 돌봄 한 가지를 정해보세요."
  },
  {
    key: "fire",
    name: "불",
    patterns: [/불이\s*났/, /화재/, /불길/, /타오르/],
    traditional: "불은 전통적으로 확장되는 기운과 성취를 뜻하기도 하지만, 번지는 양상에 따라 과열과 손실을 경계하기도 합니다.",
    psychological: "의욕, 분노, 급박함처럼 온도가 높은 감정이 빠르게 커지고 있다는 표현일 수 있습니다.",
    action: "지금 가장 뜨거운 감정에 이름을 붙이고 반응 전 10분의 틈을 만들어보세요."
  },
  {
    key: "house",
    name: "집·방",
    patterns: [/(?<![가-힣])(?:집|방)(?=$|\s|[,.!?]|에서|으로|안|밖|을|이|의|가|은|에|문)/, /현관/, /아파트/],
    traditional: "집은 생활 기반과 가족의 흐름, 방은 나만의 내면과 경계를 나타내는 공간으로 읽힙니다.",
    psychological: "안전하다고 느끼는 범위와 타인에게 보여주지 않는 내 모습을 공간으로 표현했을 수 있습니다.",
    action: "요즘 내 공간에서 바꾸고 싶은 작은 한 가지를 정리해보세요."
  },
  {
    key: "animal",
    name: "동물",
    patterns: [/강아지/, /개가/, /고양이/, /호랑이/, /새가/, /물고기/, /거미/],
    traditional: "동물은 종류와 행동에 따라 도움을 주는 인연, 본능, 경쟁자처럼 다양한 기운을 나타낸다고 봅니다.",
    psychological: "말로 다 표현하지 못한 본능적 욕구나 경계심이 동물의 성격을 빌려 나타났을 수 있습니다.",
    action: "그 동물의 성격을 세 단어로 적고 지금의 나와 닮은 점을 찾아보세요."
  },
  {
    key: "money",
    name: "돈·귀중품",
    patterns: [/돈(?!까스|가스)/, /지갑/, /금괴/, /보석/, /로또/, /복권/],
    traditional: "돈과 귀중품은 재물 그 자체뿐 아니라 얻고 잃는 흐름, 가치 있는 기회를 어떻게 다루는지 보여주는 상징입니다.",
    psychological: "안정감, 인정, 내 가치에 대한 생각이 최근 현실의 경제적 감각과 엮여 나타났을 수 있습니다.",
    action: "돈이 아닌데도 요즘 가장 지키고 싶은 가치를 하나 적어보세요."
  },
  {
    key: "school",
    name: "학교·시험",
    patterns: [/학교/, /시험/, /수능/, /교실/, /숙제/],
    traditional: "학교와 시험은 평가받는 시기, 준비의 완성도, 배움의 과제를 상징하는 장면으로 보기도 합니다.",
    psychological: "현재의 성과가 충분한지 스스로 채점하거나 타인의 기준을 의식하는 마음이 반영됐을 수 있습니다.",
    action: "완벽해야 한다는 기준을 오늘 가능한 기준으로 한 단계 낮춰보세요."
  },
  {
    key: "travel",
    name: "길·이동",
    patterns: [/길을\s*잃/, /(?:숲길|길에서|길을\s*(?:걸|걷)|길로)/, /기차/, /버스/, /자동차/, /비행기/, /여행/],
    traditional: "길과 이동수단은 삶의 방향, 계획의 속도, 함께 가는 인연의 변화를 나타낸다고 여겨집니다.",
    psychological: "어디로 가야 할지, 내 속도가 맞는지 점검하는 마음이 이동 장면으로 표현됐을 수 있습니다.",
    action: "지금 향하는 곳보다 다음 정거장에서 할 일을 한 가지 정해보세요."
  }
];

const FALLBACK_SYMBOL: DreamSymbol = {
  key: "scene",
  name: "아직 구체적이지 않은 장면",
  traditional: "특정 상징이 확인되지 않은 꿈에는 길몽이나 흉몽의 뜻을 억지로 붙이지 않습니다.",
  psychological: "인물·장소·행동·감정 중 하나가 더 있어야 현실의 어떤 마음과 연결되는지 구체적으로 볼 수 있습니다.",
  action: "누가 무엇을 했고 나는 어떤 기분이었는지 한 문장만 더 적어보세요."
};

export function extractSymbols(text: string, limit = 4): DreamSymbol[] {
  const found = CATALOG.map(item => {
    const indexes = item.patterns.flatMap(pattern => [...text.matchAll(new RegExp(pattern.source, "g"))])
      .filter(match => !/^(?:은|는|이|가|을|를)?\s*(?:전혀\s*|아예\s*)?(?:안\s*(?:나오|나왔|보였|보이)|없(?:었|어|는)|나오지\s*않|보이지\s*않)/.test(text.slice(match.index! + match[0].length)))
      .map(match => match.index!);
    return { item, index: indexes.length ? Math.min(...indexes) : -1 };
  }).filter(match => match.index >= 0).sort((a, b) => a.index - b.index).slice(0, limit).map(match => match.item);
  if (found.length > 0) return found.map(({ patterns: _patterns, ...symbol }) => symbol);
  return [FALLBACK_SYMBOL];
}
