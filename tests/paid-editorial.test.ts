import { describe, expect, it } from "vitest";
import { buildConsultationOffer } from "@/lib/consultation";
import { analyzeDreamContextLocally } from "@/lib/local-engine";
import { assertedPartOfContextExample } from "@/lib/paid-reading-model";
import { applyPaidFormatRevision, detailedQualityError, paidSceneRuleFindings } from "@/lib/ai";
import type { AssistantTurnPayload } from "@/lib/types";

describe("paid editorial offer contract", () => {
  it("exposes the four cards in the agreed order and titles", () => {
    const dream = "꿈에서 검은 뱀이 창문으로 들어와 처음에는 무서웠어요. 도망치지 않고 바라보다 문을 열어 내보낸 뒤 마음이 편안했어요.";
    const offer = buildConsultationOffer(analyzeDreamContextLocally(dream, null).context);

    expect(offer.cards.map(card => card.key)).toEqual(["traditional", "psychology", "pattern", "action"]);
    expect(offer.cards.map(card => card.promisedSectionTitle)).toEqual([
      "이 장면들이 이어지는 이유",
      "장면에서 살펴볼 속마음",
      "최근 이런 일이 계기가 됐을 수 있어요",
      "나에게 더 맞는 풀이를 구별하려면",
    ]);
  });

  it("keeps long multi-paragraph editorial content and rejects unprovided real events", () => {
    const dream = "꿈에서 검은 뱀이 창문으로 들어와 처음에는 무서웠어요. 도망치지 않고 바라보다 문을 열어 내보낸 뒤 마음이 편안했어요.";
    const context = analyzeDreamContextLocally(dream, null).context;
    const offer = buildConsultationOffer(context);
    const paragraphs: string[][] = [
  [
    "이 꿈에서 눈여겨볼 점은 처음에는 무서웠던 뱀을 가만히 바라본 뒤 직접 문을 열어 내보냈다는 변화예요. 위협적으로 느껴진 대상을 확인하고 거리를 정한 행동이 있어서, 무엇인가를 마주할 준비가 생기는 과정으로 읽어볼 수 있어요. 뱀이 나타났다는 사실과 뱀을 대했던 행동을 함께 살펴보면 처음의 두려움에만 머무르지 않는 설명이 가능해져요.",
    "문을 열어준 행동에는 어떻게 거리를 둘지 자신이 선택했다는 특징이 있어요. 꿈에 나온 대상이 사라졌다는 결과만 보는 것과, 직접 내보냈다는 선택까지 보는 것은 다른 읽기예요. 마지막에 편안해졌다는 말이 있어 그 선택이 꿈속에서 마음을 놓는 쪽으로 이어졌다는 점도 함께 짚을 수 있어요. 현실의 문제가 이미 해결됐다는 뜻으로 옮길 필요는 없어요."
  ],
  [
    "여기서는 부담스러운 일을 무작정 피하고 싶다는 마음과, 내 방식대로 정리하고 싶다는 마음을 구별해볼 수 있어요. 실제 꿈에서는 도망치지 않고 바라본 뒤 문을 열었으므로, 무엇이든 끝까지 받아들이겠다는 태도보다는 적당한 거리를 스스로 정하고 싶은 바람을 탐색하기에 더 구체적인 단서가 있어요. 어떤 일이든 감당해야 한다는 의무감과도 구별되는 지점이에요.",
    "일상에서 부탁을 거절하는 일이 마음에 걸리는 시기라면, 관계를 완전히 끊기보다 감당할 수 있는 만큼만 받아들이고 싶은 마음과 연결해볼 여지가 있어요. 반대로 실제로 그런 일이 없다면 이 사례를 자신의 문제로 받아들일 이유는 없어요. 이번 행동에서 확인할 수 있는 것은 바라보고 내보낸 선택이고, 어떤 현실의 마음과 닿는지는 추가 경험에 따라 달라져요."
  ],
  [
    "최근 부담스러운 부탁을 받았다면, 어디까지 응할지 생각했던 일이 꿈속에서 거리를 정하는 행동과 이어질 가능성을 살펴볼 수 있어요. 상대를 공격하지 않고 문을 열어 내보낸 모습은 부담을 정리할 방법을 찾는 읽기와 연결돼요. 부탁한 사람이 실제로 있었거나 뱀이 그 사람이라는 뜻으로 정해두는 설명은 아니에요.",
    "최근 어려워 보이던 일을 직접 살펴봤다면, 처음 예상했던 두려움과 확인한 뒤의 느낌이 달라졌던 경험을 떠올려볼 수 있어요. 그때 무엇을 해야 할지 판단했던 생각이 뱀을 바라보고 직접 행동한 장면과 닮았는지 살펴보는 거예요. 성공 여부보다 낯선 일을 확인한 과정이 이번 꿈의 변화와 연결되는 사례예요.",
    "최근 뱀이 나오는 영상이나 이야기를 접했다면, 그 대상이 기억에 남아 꿈의 소재가 되었을 가능성도 생각해볼 수 있어요. 이 경우에는 반드시 큰 고민이나 관계의 문제를 찾아야 하는 것은 아니에요. 접한 소재와 꿈에서 자신이 한 행동을 함께 살펴보되, 영상을 본 일이 실제 원인이라고 확인된 것으로 말하지 않아요."
  ],
  [
    "꿈에서 무엇이 가장 마음에 남았는지에 따라 읽기의 무게를 달리할 수 있어요. 뱀을 직접 내보낸 선택이 선명하다면 상황을 정리하고 거리를 결정하는 마음을 더 살펴볼 만해요. 뱀을 처음 보았을 때의 모습이 유난히 생생하다면 최근 접한 대상이나 이야기의 기억을 함께 확인하는 편이 더 구체적이에요. 같은 뱀이라는 이유만으로 두 경우를 한 뜻으로 고정하지 않아요.",
    "현재 기록에서는 직접 행동한 뒤 편안해졌다는 변화가 있어, 처음의 위협보다 그 위협을 대하는 방식이 바뀌었다는 읽기를 먼저 제안할 수 있어요. 앞으로 어떤 좋은 일이 생긴다는 약속과는 구분돼요. 최근의 실제 경험이 있다면 그중 어떤 부분이 이 선택과 닮았는지 이어서 물어보며, 이번 풀이를 더 좁혀갈 수 있어요."
  ]
];
    const report: AssistantTurnPayload = {
      qualityVersion: 2, generationSource: "codex", directAnswerTitle: "장면의 변화",
      directAnswer: "무서움 뒤에 직접 문을 열어 내보내고 편안해진 흐름이 중심이에요.",
      sections: offer.cards.map((card,index) => ({ title: card.promisedSectionTitle, paragraphs: paragraphs[index]! })),
      interpretationChanges: null, uncertainty: [], shareableSentences: [], suggestedQuestions: [],
      evidenceQuotes: ["검은 뱀이 창문으로 들어와 처음에는 무서웠어요", "문을 열어 내보낸 뒤 마음이 편안했어요"]
    };
    expect(report.sections.flatMap(section => section.paragraphs.join(" ")).join(" ").length).toBeGreaterThan(1500);
    expect(detailedQualityError(report, offer, dream, context)).toBeNull();
    const asking = structuredClone(report);
    asking.sections[1].paragraphs.push("‘왜 이래?’라고 물은 점도 이 장면을 이해하고 싶다는 뜻으로 볼 수 있어요.");
    expect(detailedQualityError(asking, offer, dream, context)).toBeNull();
    expect(paidSceneRuleFindings(asking, offer, dream)).toEqual([]);
    // One asking verb cannot excuse a different occurrence of actual water.
    asking.sections[1].paragraphs.push("물은 차가웠어요.");
    expect(detailedQualityError(asking, offer, dream, context)).toBe("AI_DETAILED_UNGROUNDED_SCENE");
    expect(paidSceneRuleFindings(asking, offer, dream)).toContainEqual({target:"section:1",quote:"물은"});
    expect(detailedQualityError(asking, offer, dream + " 왜 이런지 물은 점을 알려 주세요.", context)).toBe("AI_DETAILED_UNGROUNDED_SCENE");
    expect(paidSceneRuleFindings(asking, offer, dream + " 물은 차가웠어요.")).toEqual([]);
    const cautious = structuredClone(report);
    cautious.sections[3].paragraphs.push("사람과 거리를 두고 싶다는 뜻이 직접 드러나지 않으므로, 실제 바람으로 단정할 수는 없어요.");
    expect(detailedQualityError(cautious, offer, dream, context)).toBeNull();
    cautious.sections[3].paragraphs.push("불만이 직접 드러나지 않으며 어떤 행동을 했는지 알 수 없어요.");
    expect(detailedQualityError(cautious, offer, dream, context)).toBe("AI_DETAILED_FALSE_MISSING_DETAIL");
    const invented = { ...report, sections: report.sections.map((section, index) => index === 2
      ? { ...section, paragraphs: ["최근 결혼 소식을 들었어요. 그래서 이 꿈을 꿨어요."] }
      : section) };
    expect(detailedQualityError(invented, offer, dream, context)).toBe("AI_DETAILED_DREAM_REALITY_MIX");
    const conditional = "최근 결혼 소식을 들었다면, 문을 열어 내보낸 행동을 거리 조절의 단서로 살펴볼 수 있어요. 이후의 문장도 사실 단정 없이 해석으로 남겨요.";
    const conditionalReport={...report,sections:report.sections.map((section,index)=>index===2?{...section,paragraphs:[conditional,...section.paragraphs.slice(1)]}:section)};
    expect(detailedQualityError(conditionalReport,offer,dream,context)).toBeNull();
    expect(assertedPartOfContextExample(conditional)).toContain("이후의 문장도 사실 단정 없이");
    const mixed = { ...report, sections: report.sections.map((section, index) => index === 2
      ? { ...section, paragraphs: ["최근 결혼 소식을 들었다면, 꿈속의 편안함과 함께 살펴볼 수 있어요. 실제로 최근 결혼 소식을 들었어요."] }
      : section) };
    expect(detailedQualityError(mixed, offer, dream, context)).toBe("AI_DETAILED_DREAM_REALITY_MIX");
    expect(assertedPartOfContextExample(mixed.sections[2]!.paragraphs[0]!)).toContain("실제로 최근 결혼 소식을 들었어요.");

    const reflowed = applyPaidFormatRevision(report, "section:3", report.sections[3]!.paragraphs.join("\n\n"), offer);
    expect(reflowed?.sections[3]).toEqual(report.sections[3]);
  });

  it("does not block paid delivery for style, harmless word fragments, or a medical disclaimer", () => {
    const dream = "창문을 열고 바깥을 바라보다 마음이 편안해졌어요.";
    const context = analyzeDreamContextLocally(dream, null).context;
    const offer = buildConsultationOffer(context);
    const paragraphs = offer.cards.map(card => ({ title: card.promisedSectionTitle, paragraphs: [
      "꿈에서 창문을 열고 바깥을 바라본 뒤 편안해졌다고 했어요. 이 행동에서 느낀 변화를 중심으로 가능한 의미를 살펴볼 수 있어요. 꿈의 장면과 마지막 감정을 함께 보며 한 가지 해석에 고정하지 않고 여러 연결을 확인해요. 실제 경험은 꿈만으로 정해지지 않으므로 현재의 상황과 비교해 보는 편이 좋아요. 사용자가 알려 준 장면을 바탕으로 설명하되 없는 인물이나 장소를 보태지 않아요. 이 흐름은 꿈속에서 직접 창문을 열어 본 선택을 중심으로 이해할 수 있어요. 마음의 움직임을 돌아보는 실마리로 삼을 수 있고, 현실의 사건을 예고하는 뜻은 아니에요. 무엇이 가장 크게 남았는지에 따라 해석의 무게는 달라질 수 있어요. 최근의 계기가 있었는지는 본인의 경험과 대조해 볼 수 있어요. 여러 가능성을 살펴보고 지금 자신에게 맞는 쪽을 천천히 골라도 괜찮아요. 당장 결론을 정하지 않아도 꿈에서 보인 선택을 돌아보는 것만으로 충분해요. 풀이를 현실의 확정된 사실로 받아들이지 않아도 돼요."
    ] }));
    const report: AssistantTurnPayload = {
      qualityVersion: 2, generationSource: "codex", directAnswerTitle: "꿈에서 본 흐름",
      directAnswer: "창문을 열어 바깥을 바라본 뒤 편안해진 흐름이 중심이에요. 마음이 활기차게 바뀐 점도 함께 살펴볼 수 있어요.",
      sections: paragraphs, interpretationChanges: null, uncertainty: [], shareableSentences: [], suggestedQuestions: [],
      evidenceQuotes: ["창문을 열고 바깥을 바라보다 마음이 편안해졌어요."]
    };
    report.sections[3]!.paragraphs.push("이 풀이는 의학적 진단을 할 수 없어요.", "현실에서 확인할 수 있는 부분은 본인의 경험과 대조해 보면 돼요.");
    expect(detailedQualityError(report, offer, dream, context)).toBeNull();
    expect(paidSceneRuleFindings(report, offer, dream)).toEqual([]);
    expect(paidSceneRuleFindings({ ...report, directAnswer: "꿈에서 기차를 탔어요." }, offer, dream)).toContainEqual({ target: "directAnswer", quote: "기차를" });
  });
});
