import { describe, expect, it } from "vitest";
import {
  analyzeDreamLocally,
  applyClarifications,
  applyClarificationsToContext,
  assistantPayloadCharacterCount,
  buildDetailedAssistantPayload,
  buildFreeAssistantPayload,
  buildFreeReading,
  buildPaidOfferFromContext,
  buildPaidReport,
  analyzeDreamContextLocally
} from "@/lib/local-engine";
import {
  detailedQualityError,
  freeQualityError,
  removeRedundantUncertainty,
  reportCharacterCount
} from "@/lib/ai";
import { hasUnsafeClaim } from "@/lib/safety";
import { DETAILED_DREAM } from "./helpers/repository";
import { interpretationQuestionForFocus, type InterpretationFocus } from "@/lib/interpretation-focus";

describe("local dream engine", () => {
  it("reads the change from fear to relief instead of describing lasting fear", () => {
    const context = analyzeDreamContextLocally(DETAILED_DREAM, null).context;
    const free = buildFreeAssistantPayload(context);
    const offer = buildPaidOfferFromContext(context);
    expect(free.directAnswer).toContain("두려움으로 시작했지만 안도감으로 끝났다는 점");
    expect(free.directAnswer).toContain("스스로 내보내고 편안함을 되찾는");
    expect(free.directAnswer).not.toContain("두려움이 남은 만큼");
    expect(offer.cards[0].firstSentence).toContain("두려움에서 안도감으로");
    expect(offer.cards[1].title).toContain("안도감");
  });

  it("does not invent a relieved ending when the last scene has no stated emotion", () => {
    const context = analyzeDreamContextLocally(
      "어두운 집에서 무서워하며 문을 바라봤어요. 가족을 보니 안도했어요. 그리고 다른 방으로 걸어갔어요.", null
    ).context;
    expect(buildFreeAssistantPayload(context).directAnswer).not.toContain("안도감으로 끝났다는");
  });

  it("lets a short dream with an action and feeling go directly to the free reading", () => {
    const analysis = analyzeDreamContextLocally("집에서 고양이를 바라봤어요. 마음이 편안했어요.", null);
    expect(analysis.questions).toEqual([]);
  });

  it("still offers one optional question when the dream lacks useful details", () => {
    const analysis = analyzeDreamContextLocally("뱀이 조용히 나타났다가 금방 사라지는 꿈을 꾸었어요.", null);
    expect(analysis.questions).toHaveLength(1);
    expect(analysis.questions[0].kind).toBe("scene");
  });

  it("keeps the purchased reading consistent with the free ending and suggests relevant questions", () => {
    const context = analyzeDreamContextLocally(DETAILED_DREAM, null).context;
    const detailed = buildDetailedAssistantPayload(context);
    expect(detailed.directAnswer).toContain("두려움에서 안도감으로 끝난 과정");
    const actions = detailed.sections.find((section) => section.title === "현실에서 확인할 질문과 대화법");
    expect(JSON.stringify(actions)).not.toMatch(/얼굴이 보이지|두 번째 사람|다른 사람을 원/);
    expect(detailed.suggestedQuestions).toContain("끝에 감정이 달라진 이유를 더 알고 싶어요");
    expect(detailed.suggestedQuestions.join(" ")).not.toMatch(/외도|다른 사람을 원|상대에게/);
  });

  it.each([
    ["overall", /두려움으로 시작했지만 안도감으로 끝났다는 점/],
    ["relationship", /상대의 속마음이나 관계의 결말/],
    ["recent_context", /최근 경험이 꿈에 섞였을 수는 있지만/],
    ["repetition", /이 꿈이 반복됐다는 정보가 없어요/],
    ["good_or_bad", /좋은 일을 보장하거나 나쁜 일을 예고한다고 보기는 어려워요/]
  ] as Array<[InterpretationFocus, RegExp]>)(
    "answers the selected %s focus before a generic symbol reading",
    (focus, expected) => {
      const context = analyzeDreamContextLocally(DETAILED_DREAM, null, focus).context;
      const answer = buildFreeAssistantPayload(context);
      const length = assistantPayloadCharacterCount(answer);

      expect(context.selectedFocus).toBe(focus);
      expect(context.userQuestions?.[0]).toBe(interpretationQuestionForFocus(focus));
      expect(answer.directAnswer).toMatch(expected);
      expect(length).toBeGreaterThanOrEqual(350);
      expect(length).toBeLessThanOrEqual(600);
      expect(hasUnsafeClaim(JSON.stringify(answer))).toBe(false);
    }
  );

  it("states what is missing instead of filling a vague dream with abstract language", () => {
    const context = analyzeDreamContextLocally(
      "그냥 이상한 장면이 나왔는데 자세히 기억나지 않아요.",
      null,
      "overall"
    ).context;
    const answer = buildFreeAssistantPayload(context);
    const text = JSON.stringify(answer);

    expect(answer.directAnswer).toContain("지금 내용만으로는");
    expect(answer.directAnswer).toContain("인물·장소·행동·감정 중 하나");
    expect(answer.sections[0]?.paragraphs[0]).toContain("누가, 어디서, 무엇을 했는지");
    expect(answer.sections[2]?.paragraphs[0]).toContain("한 문장만 더 적으면 됩니다");
    expect(text).not.toMatch(
      /가장 선명한 장면 자체보다|선명하지만 이름 붙이기 어려운 감정|장면을 지켜본 흐름|하나의 가능성으로만 살피는 편|등장 대상와/
    );
    expect(assistantPayloadCharacterCount(answer)).toBeGreaterThanOrEqual(350);
    expect(assistantPayloadCharacterCount(answer)).toBeLessThanOrEqual(600);
    expect(freeQualityError(answer)).toBeNull();
  });

  it("rejects generic filler from an AI free reading", () => {
    const context = analyzeDreamContextLocally(DETAILED_DREAM, null).context;
    const answer = buildFreeAssistantPayload(context);
    const vague = {
      ...answer,
      directAnswer: "이 꿈은 선명하지만 이름 붙이기 어려운 감정을 남긴 장면의 변화가 핵심이에요."
    };

    expect(freeQualityError(vague)).toBe("AI_FREE_VAGUE_FILLER");
  });

  it("keeps editorial phrasing out of the hard gate while rejecting false missing-detail claims", () => {
    const dream =
      "낯선 도서관에서 파란 열쇠를 찾아 잠긴 문을 열었고, 창밖의 비를 보며 차분해졌어요.";
    const context = analyzeDreamContextLocally(dream, null).context;
    const answer = buildFreeAssistantPayload(context);
    const repeated = {
      ...answer,
      directAnswer: `${answer.directAnswer} 장면 장면을 다시 살펴봐요.`
    };
    const falseMissing = {
      ...answer,
      directAnswer: `${answer.directAnswer} 발견한 대상은 아직 비어 있어요.`
    };

    expect(freeQualityError(repeated, dream)).toBeNull();
    expect(freeQualityError(falseMissing, dream)).toBe("AI_FREE_FALSE_MISSING_DETAIL");
  });

  it("does not attach particles directly to a full-sentence clarification", () => {
    const initial = analyzeDreamContextLocally(
      "긴 복도에서 닫힌 문을 찾다가 잠에서 깼어요.",
      null
    ).context;
    const context = applyClarificationsToContext(initial, [
      {
        questionId: "emotion",
        kind: "emotion",
        answer: "설명하기 어려운 느낌이었습니다.",
        skipped: false
      }
    ]);
    const offerText = JSON.stringify(buildPaidOfferFromContext(context));

    expect(offerText).not.toMatch(/느낌이었습니다\.[과와을를이가은는]/);
    expect(offerText).toContain("꿈에서 남은 느낌");
    expect(offerText).not.toContain("꿈에서 남은 꿈에서 남은 느낌");

    const angerContext = applyClarificationsToContext(initial, [
      {
        questionId: "emotion",
        kind: "emotion",
        answer: "분노",
        skipped: false
      }
    ]);
    const angerOfferText = JSON.stringify(buildPaidOfferFromContext(angerContext));
    expect(angerOfferText).not.toMatch(/분노(?:이|을|과)/);
    expect(angerOfferText).toMatch(/분노(?:가|를|와)/);
  });

  it("merges a typed scene clarification into top-level evidence and symbols", () => {
    const initial = analyzeDreamContextLocally(
      "희미한 장면이 있었는데 자세히 기억나지 않아요.",
      null
    ).context;
    const context = applyClarificationsToContext(initial, [
      {
        questionId: "scene",
        kind: "scene",
        answer: "빨간 뱀이 창문으로 들어왔고 무서웠어요.",
        skipped: false
      }
    ]);
    const answer = buildFreeAssistantPayload(context);

    expect(context.symbols.map((symbol) => symbol.key)).toContain("snake");
    expect(context.emotions).toContain("두려움");
    expect(context.scenes.at(-1)?.emotion).toBe("두려움");
    expect(answer.directAnswer).not.toContain("지금 내용만으로는");
    expect(JSON.stringify(answer)).toContain("뱀");
  });

  it("normalizes short inflected feeling answers before adding particles", () => {
    const initial = analyzeDreamContextLocally(
      "긴 복도 끝에 닫힌 문이 있었어요.",
      null
    ).context;
    const cases = [
      ["슬펐어요", "슬픔"],
      ["놀랐어요", "놀람"],
      ["안 좋았어요", "불편함"],
      ["기쁘지 않았어요", "불편함"],
      ["행복하지 않았어요", "불편함"],
      ["편안하지 않았어요", "불편함"],
      ["모르겠어요", "꿈에서 남은 느낌"]
    ] as const;

    for (const [answer, expectedFeeling] of cases) {
      const context = applyClarificationsToContext(initial, [
        { questionId: "emotion", kind: "emotion", answer, skipped: false }
      ]);
      const offer = buildPaidOfferFromContext(context);
      const text = JSON.stringify(offer);

      expect(text).toContain(expectedFeeling);
      expect(text).not.toMatch(/(?:어요|겠어요)[과와을를이가은는]/);
      expect(offer.cards[3]?.firstSentence).toContain("무엇을 확인할지");
    }
  });

  it("rejects concrete scenes that do not exist in the submitted dream", () => {
    const dream =
      "건강검진 결과를 기다리는 동안 검사표를 들고 있었고, 몸 상태가 걱정돼 잠을 설쳤어요.";
    const context = analyzeDreamContextLocally(dream, null).context;
    const answer = buildFreeAssistantPayload(context);
    const hallucinated = {
      ...answer,
      sections: answer.sections.map((section, index) =>
        index === 1
          ? { ...section, paragraphs: ["물가와 낯섦도 그 불안이 이어졌음을 보여줘요."] }
          : section
      )
    };

    expect(freeQualityError(hallucinated, dream, context)).toBe("AI_FREE_UNGROUNDED_SCENE");
  });

  it.each([
    "재물이 생긴다는 뜻으로 정할 수는 없어요.",
    "특정 인물이 누구인지 꿈만으로 판단할 수는 없어요.",
    "건물 안에서 느끼는 편안함은 사람마다 다를 수 있어요."
  ])("does not mistake Korean compound words for water scenes: %s", (sentence) => {
    const context = analyzeDreamContextLocally(DETAILED_DREAM, null).context;
    const detailed = buildDetailedAssistantPayload(context);
    const answer = { ...detailed, uncertainty: [sentence] };
    expect(detailedQualityError(answer, buildPaidOfferFromContext(context), DETAILED_DREAM, context))
      .toBeNull();
  });

  it("does not accept a compound word in the dream as evidence for an invented water scene", () => {
    const dream = "높은 건물 안으로 들어가 낯선 인물을 바라봤어요. 무서웠어요.";
    const context = analyzeDreamContextLocally(dream, null).context;
    const answer = buildFreeAssistantPayload(context);
    for (const sentence of ["물 위에 서 있었어요.", "물 안으로 들어갔어요.", "물속으로 가라앉았어요."]) {
      expect(freeQualityError({ ...answer, directAnswer: sentence }, dream, context))
        .toBe("AI_FREE_UNGROUNDED_SCENE");
    }
  });

  it("still rejects invented immersion when a river is mentioned without entering it", () => {
    const dream = "강가에서 강물을 바라보고 있었어요. 마음이 편안했어요.";
    const context = analyzeDreamContextLocally(dream, null).context;
    const answer = buildFreeAssistantPayload(context);
    expect(freeQualityError({ ...answer, directAnswer: "강물에 뛰어들었어요." }, dream, context))
      .toBe("AI_FREE_UNGROUNDED_SCENE");
  });

  it("rejects concrete substitutions, new objects, and facts injected only into context", () => {
    const dream = "호숫가에서 빨간 우산을 들고 잠긴 문 앞에 서 있었어요. 답답했어요.";
    const context = analyzeDreamContextLocally(dream, null).context;
    const answer = buildFreeAssistantPayload(context);
    const withParagraph = (paragraph: string) => ({
      ...answer,
      sections: answer.sections.map((section, index) =>
        index === 1 ? { ...section, paragraphs: [paragraph] } : section
      )
    });
    const poisonedContext = {
      ...context,
      places: [...context.places, "병원"],
      scenes: context.scenes.map((scene, index) => index === 0 ? { ...scene, place: "병원" } : scene)
    };

    expect(freeQualityError(withParagraph("바다의 파도 앞에서 마음이 흔들렸을 수 있어요."), dream, context))
      .toBe("AI_FREE_UNGROUNDED_SCENE");
    expect(freeQualityError(withParagraph("파란 우산과 열쇠가 선택의 부담을 보여줘요."), dream, context))
      .toBe("AI_FREE_UNGROUNDED_SCENE");
    expect(freeQualityError(withParagraph("초록색 거울 옆의 칼과 반지가 불안을 키웠어요."), dream, context))
      .toBe("AI_FREE_UNGROUNDED_SCENE");
    expect(freeQualityError(withParagraph("호숫가에서 물속으로 가라앉는 장면은 압박을 보여줘요."), dream, context))
      .toBe("AI_FREE_UNGROUNDED_SCENE");
    expect(freeQualityError(withParagraph("문이 열리자 물에 뛰어들었어요."), dream, context))
      .toBe("AI_FREE_UNGROUNDED_SCENE");
    expect(freeQualityError(withParagraph("병원 복도에서 기다리는 마음과 닮았어요."), dream, poisonedContext))
      .toBe("AI_FREE_UNGROUNDED_SCENE");
    expect(freeQualityError(
      withParagraph("병원 복도에서 기다리는 마음과 닮았어요."),
      dream,
      poisonedContext,
      "최근 병원 복도에서 검사 결과를 기다렸어요."
    )).not.toBe("AI_FREE_UNGROUNDED_SCENE");
  });

  it("rejects an invented gender and a dream event rewritten as real context", () => {
    const neutralDream =
      "꿈에서 전 연인을 우연히 만났고 서로 말없이 바라봤어요. 깨고 나서는 슬프면서도 안도했어요.";
    const neutralContext = analyzeDreamContextLocally(neutralDream, null).context;
    const neutralAnswer = buildFreeAssistantPayload(neutralContext);
    const gendered = { ...neutralAnswer, directAnswer: `${neutralAnswer.directAnswer} 그의 안부가 마음에 남았어요.` };

    const marriageDream =
      "꿈에서 전 연인이 결혼한다는 소식을 들었어요. 슬펐지만 한편으로는 마음이 놓였어요.";
    const marriageContext = analyzeDreamContextLocally(marriageDream, null).context;
    const marriageAnswer = buildFreeAssistantPayload(marriageContext);
    const mixedReality = {
      ...marriageAnswer,
      directAnswer: `${marriageAnswer.directAnswer} 결혼 소식보다 이별의 감정이 더 중요해요.`
    };
    const explicitDenialDream =
      "꿈에서 전 연인이 결혼한다는 말을 들었지만 현실에서는 결혼 소식을 들은 적이 없어요. 슬픔과 안도감이 함께 남았어요.";
    const explicitDenialContext = analyzeDreamContextLocally(explicitDenialDream, null).context;
    const explicitDenialAnswer = buildFreeAssistantPayload(explicitDenialContext);
    const denialMixed = {
      ...explicitDenialAnswer,
      directAnswer: `${explicitDenialAnswer.directAnswer} 결혼 소식보다 이별의 감정이 더 중요해요.`
    };
    const genderedSubject = {
      ...neutralAnswer,
      directAnswer: `${neutralAnswer.directAnswer} 그녀는 이미 마음을 정리한 듯해요.`
    };
    const pregnancyDream =
      "꿈에서 전 연인이 임신했다는 말을 들었어요. 놀랐지만 현실 소식은 전혀 듣지 못했어요.";
    const pregnancyContext = analyzeDreamContextLocally(pregnancyDream, null).context;
    const pregnancyAnswer = buildFreeAssistantPayload(pregnancyContext);
    const mixedPregnancy = {
      ...pregnancyAnswer,
      directAnswer: `${pregnancyAnswer.directAnswer} 최근 들은 임신 소식이 마음을 흔든 듯해요.`
    };
    const validBoundary = {
      ...marriageAnswer,
      directAnswer: `${marriageAnswer.directAnswer} 현실의 결혼 여부는 이 장면만으로 확인할 수 없어요.`
    };
    const childDream = "꿈에서 아이가 문 앞에 서 있었고 나는 그 아이를 바라봤어요.";
    const childContext = analyzeDreamContextLocally(childDream, null).context;
    const childAnswer = buildFreeAssistantPayload(childContext);
    const inventedSon = {
      ...childAnswer,
      directAnswer: `${childAnswer.directAnswer} 아들은 문 앞에서 망설이고 있었어요.`
    };
    const inventedBrother = {
      ...childAnswer,
      directAnswer: `${childAnswer.directAnswer} 오빠는 문 앞에서 망설이고 있었어요.`
    };
    const multiplePeopleDream =
      "꿈에서 아버지와 성별을 말하지 않은 전 연인을 함께 만났고, 전 연인은 말없이 떠났어요.";
    const multiplePeopleContext = analyzeDreamContextLocally(multiplePeopleDream, null).context;
    const multiplePeopleAnswer = buildFreeAssistantPayload(multiplePeopleContext);
    const ambiguousPronoun = {
      ...multiplePeopleAnswer,
      directAnswer: `${multiplePeopleAnswer.directAnswer} 전 연인인 그는 이미 마음을 정리한 듯해요.`
    };
    const acceptanceDream = "꿈에서 지원한 회사에 합격했다는 연락을 받고 기뻐했어요.";
    const acceptanceContext = analyzeDreamContextLocally(acceptanceDream, null).context;
    const acceptanceAnswer = buildFreeAssistantPayload(acceptanceContext);
    const mixedAcceptance = {
      ...acceptanceAnswer,
      directAnswer: `${acceptanceAnswer.directAnswer} 최근 실제 합격 소식이 자신감을 키웠어요.`
    };
    const unsupportedMarriageWithNoRoom = {
      ...marriageAnswer,
      directAnswer: `${marriageAnswer.directAnswer} 최근 실제 결혼 소식 때문에 마음의 여유가 없어요.`
    };
    const mindsetOnly = {
      ...marriageAnswer,
      directAnswer: `${marriageAnswer.directAnswer} 최근 사고방식이 달라졌는지도 살펴보세요.`
    };
    const unsupportedAccident = {
      ...marriageAnswer,
      directAnswer: `${marriageAnswer.directAnswer} 최근 실제 사고 때문에 마음이 흔들렸을 수 있어요.`
    };

    expect(freeQualityError(gendered, neutralDream, neutralContext)).toBe("AI_FREE_UNSUPPORTED_IDENTITY");
    expect(freeQualityError(genderedSubject, neutralDream, neutralContext)).toBe("AI_FREE_UNSUPPORTED_IDENTITY");
    expect(freeQualityError(mixedReality, marriageDream, marriageContext)).toBe("AI_FREE_DREAM_REALITY_MIX");
    expect(freeQualityError(denialMixed, explicitDenialDream, explicitDenialContext)).toBe(
      "AI_FREE_DREAM_REALITY_MIX"
    );
    expect(freeQualityError(mixedPregnancy, pregnancyDream, pregnancyContext)).toBe(
      "AI_FREE_DREAM_REALITY_MIX"
    );
    expect(freeQualityError(validBoundary, marriageDream, marriageContext)).not.toBe(
      "AI_FREE_DREAM_REALITY_MIX"
    );
    expect(freeQualityError(inventedSon, childDream, childContext)).toBe(
      "AI_FREE_UNSUPPORTED_IDENTITY"
    );
    expect(freeQualityError(inventedBrother, childDream, childContext)).toBe(
      "AI_FREE_UNSUPPORTED_IDENTITY"
    );
    expect(freeQualityError(ambiguousPronoun, multiplePeopleDream, multiplePeopleContext)).toBe(
      "AI_FREE_UNSUPPORTED_IDENTITY"
    );
    expect(freeQualityError(mixedAcceptance, acceptanceDream, acceptanceContext)).toBe(
      "AI_FREE_DREAM_REALITY_MIX"
    );
    expect(freeQualityError(unsupportedMarriageWithNoRoom, marriageDream, marriageContext)).toBe(
      "AI_FREE_DREAM_REALITY_MIX"
    );
    expect(freeQualityError(mindsetOnly, marriageDream, marriageContext)).not.toBe(
      "AI_FREE_DREAM_REALITY_MIX"
    );
    expect(freeQualityError(unsupportedAccident, marriageDream, marriageContext)).toBe(
      "AI_FREE_DREAM_REALITY_MIX"
    );
  });

  it("rejects a free answer built from the same four stock phrases", () => {
    const dream = "회사 복도에서 닫힌 문을 찾다가 바깥으로 나왔고 마음이 조금 편해졌어요.";
    const context = analyzeDreamContextLocally(dream, null).context;
    const answer = buildFreeAssistantPayload(context);
    const formulaic = {
      ...answer,
      directAnswer: "이 꿈은 불안을 정리한 꿈에 가까워요. 문을 연 장면이 그 마음을 보여줘요.",
      sections: answer.sections.map((section, index) =>
        index === 2
          ? {
              ...section,
              paragraphs: ["이 꿈만으로 현실의 결과를 확인할 수는 없어요. 돌아보면 해석을 좁힐 수 있어요."]
            }
          : section
      )
    };

    expect(freeQualityError(formulaic, dream, context)).toBe("AI_FREE_FORMULAIC");
  });

  it("enforces non-generic and third-person opening directions", () => {
    const sceneDream = "회사 복도에서 문을 열고 밖으로 나갔고 마음이 편해졌어요.";
    const sceneContext = analyzeDreamContextLocally(sceneDream, null).context;
    const sceneAnswer = buildFreeAssistantPayload(sceneContext);
    const genericOpening = {
      ...sceneAnswer,
      directAnswer: "이 꿈은 닫힌 문과 편안함의 대비를 먼저 봐야 해요."
    };
    const detailFreeOpening = {
      ...sceneAnswer,
      directAnswer: "전반적인 변화부터 차분히 살펴볼 수 있어요."
    };
    const sceneFirstUnderFeeling = {
      ...sceneAnswer,
      directAnswer: "회사 복도와 닫힌 문이 먼저 눈에 들어와요."
    };
    const questionContext = analyzeDreamContextLocally(sceneDream, null, "good_or_bad").context;
    const questionAnswer = buildFreeAssistantPayload(questionContext);
    const unrelatedQuestionOpening = {
      ...questionAnswer,
      directAnswer: "회사 복도에서 문을 연 순서가 가장 중요해요."
    };
    const extractedQuestionDream =
      "회사 복도에서 닫힌 문을 바라봤어요. 이게 최근 일의 영향일까요?";
    const extractedQuestionContext = analyzeDreamContextLocally(extractedQuestionDream, null).context;
    const extractedQuestionAnswer = buildFreeAssistantPayload(extractedQuestionContext);
    const extractedQuestionMiss = {
      ...extractedQuestionAnswer,
      directAnswer: "회사 복도와 닫힌 문이 먼저 눈에 들어와요."
    };
    const thirdPartyDream = "친구가 꾼 꿈인데, 낯선 골목에서 문을 찾다가 무서워했어요.";
    const thirdPartyContext = analyzeDreamContextLocally(thirdPartyDream, null).context;
    const thirdPartyAnswer = buildFreeAssistantPayload(thirdPartyContext);
    const missingBoundary = {
      ...thirdPartyAnswer,
      directAnswer: "두려움이 남은 장면은 답을 찾지 못한 불안과 이어질 수 있어요."
    };

    expect(freeQualityError(genericOpening, sceneDream, sceneContext, "", "scene_contrast"))
      .toBe("AI_FREE_WRONG_OPENING");
    expect(freeQualityError(detailFreeOpening, sceneDream, sceneContext, "", "scene_contrast"))
      .toBe("AI_FREE_WRONG_OPENING");
    expect(freeQualityError(sceneFirstUnderFeeling, sceneDream, sceneContext, "", "feeling_first"))
      .toBe("AI_FREE_WRONG_OPENING");
    expect(freeQualityError(unrelatedQuestionOpening, sceneDream, questionContext, "", "question_first"))
      .toBe("AI_FREE_WRONG_OPENING");
    expect(freeQualityError(
      extractedQuestionMiss,
      extractedQuestionDream,
      extractedQuestionContext,
      "",
      "question_first"
    )).toBe("AI_FREE_WRONG_OPENING");
    expect(freeQualityError(missingBoundary, thirdPartyDream, thirdPartyContext, "", "third_person_boundary"))
      .toBe("AI_FREE_WRONG_OPENING");
  });

  it("allows a truthful missing-emotion statement in an otherwise concrete dream", () => {
    const dream = "회사 복도에서 잠긴 문을 열고 밝은 바깥으로 나갔어요.";
    const context = analyzeDreamContextLocally(dream, null).context;
    const answer = buildFreeAssistantPayload(context);
    const truthful = {
      ...answer,
      sections: answer.sections.map((section, index) =>
        index === 2
          ? { ...section, paragraphs: [`${section.paragraphs[0]} 감정 정보는 아직 확인되지 않았어요.`] }
          : section
      )
    };

    expect(freeQualityError(truthful, dream, context)).toBeNull();
  });

  it("removes an uncertainty note that only repeats the boundary section", () => {
    const context = analyzeDreamContextLocally(DETAILED_DREAM, null).context;
    const answer = buildFreeAssistantPayload(context);
    const repeated = {
      ...answer,
      sections: answer.sections.map((section, index) =>
        index === 2
          ? { ...section, paragraphs: ["현실에서 같은 불안을 느낀 사건은 아직 확인되지 않았어요."] }
          : section
      ),
      uncertainty: ["현실에서 같은 불안을 느낀 사건은 확인되지 않았어요."]
    };

    expect(removeRedundantUncertainty(repeated).uncertainty).toEqual([]);
  });

  it("uses a natural label when the local parser has no named symbol", () => {
    const context = analyzeDreamContextLocally(
      "낯선 도서관에서 파란 열쇠를 찾아 잠긴 문을 열었고, 창밖에는 비가 내렸어요.",
      null
    ).context;
    const offer = buildPaidOfferFromContext(context);
    const text = JSON.stringify(offer);

    expect(context.symbols[0]?.name).toBe("아직 구체적이지 않은 장면");
    expect(text).not.toMatch(/장면 장면|이 꿈에서 꿈의|오늘 현실에서 꿈에서|꿈에서 남은 꿈에서 남은/);
    expect(offer.headline).toContain("이 꿈에서 핵심 장면은");
    expect(offer.cards[3]?.firstSentence).toContain("그 느낌이 다시 떠오를 때 무엇을 확인할지");
  });

  it("does not read 건강 이상 as a strange feeling or waterside place", () => {
    const healthContext = analyzeDreamContextLocally(
      "꿈에서 천장이 가슴을 눌러 숨을 쉴 수 없었고, 깬 뒤에도 잠시 흉통과 어지럼이 있었습니다. 이게 건강 이상을 알리는 신호인지 걱정됩니다.",
      null
    ).context;
    const strangeContext = analyzeDreamContextLocally(
      "낯선 복도에서 모든 것이 이상하게 느껴져 당황했어요.",
      null
    ).context;

    expect(healthContext.places).not.toContain("물가");
    expect(healthContext.emotions).not.toContain("낯섦");
    expect(strangeContext.emotions).toContain("낯섦");
  });

  it("does not block delivery for editorial phrasing preferences", () => {
    const dream = "면접을 앞두고 지하철이 물속으로 들어가며 앞니가 빠지는 꿈을 꿨어요. 너무 두려웠어요.";
    const context = analyzeDreamContextLocally(dream, null).context;
    const answer = buildFreeAssistantPayload(context);
    const withCopy = (copy: string) => ({ ...answer, directAnswer: `${answer.directAnswer} ${copy}` });

    expect(freeQualityError(withCopy("예상 질문에 답하는 연습이 현실에서 확인할 수 있는 부분이에요."), dream, context)).toBeNull();
    expect(freeQualityError(withCopy("전통 해몽에서는 가족 어른을 보호를 상징하는 존재로 참고해요."), dream, context)).toBeNull();
    expect(freeQualityError(withCopy("발걸음은 지하철과 함께 물속으로 멈췄어요."), dream, context)).toBeNull();
  });

  it("avoids lexical false positives while preserving real walking, river, and strangeness", () => {
    const phone = analyzeDreamContextLocally("복도에서 전화를 걸었고 그림을 벽에 걸어 두었어요.", null).context;
    const walking = analyzeDreamContextLocally("긴 복도를 천천히 걸어갔어요.", null).context;
    const physical = analyzeDreamContextLocally("몸이 이상해서 병원에 갔지만 기분이 안 좋았어요.", null).context;
    const compactNegative = analyzeDreamContextLocally("기분이 안좋았어요.", null).context;
    const indirectNegative = analyzeDreamContextLocally("별로 좋았던 건 아니었어요.", null).context;
    const negatedEmotions = [
      "기쁘지 않았어요.",
      "행복하지 않았어요.",
      "편안하지 않았어요."
    ].map((dream) => analyzeDreamContextLocally(dream, null).context);
    const strange = analyzeDreamContextLocally("복도의 분위기가 이상했고 기분이 이상하다고 느꼈어요.", null).context;
    const strangeVariants = [
      "이상한 기분이 들었어요.",
      "뭔가 이상했어요.",
      "모든 게 이상했어요."
    ].map((dream) => analyzeDreamContextLocally(dream, null).context);
    const robbery = analyzeDreamContextLocally("강도 꿈을 꾸고 놀랐어요.", null).context;
    const quick = analyzeDreamContextLocally("뱀이 금방 사라졌고 한 가지에 집중했어요.", null).context;
    const river = analyzeDreamContextLocally("강에서는 배를 보았고 강으로는 들어가지 않았어요.", null).context;

    expect(phone.scenes.map((scene) => scene.action)).not.toContain("걸어감");
    expect(walking.scenes.map((scene) => scene.action)).toContain("걸어감");
    expect(physical.emotions).not.toContain("낯섦");
    expect(physical.emotions).not.toContain("기쁨");
    expect(compactNegative.emotions).not.toContain("기쁨");
    expect(indirectNegative.emotions).not.toContain("기쁨");
    for (const variant of negatedEmotions) {
      expect(variant.emotions).not.toContain("기쁨");
      expect(variant.emotions).not.toContain("안도감");
      expect(variant.emotions).toContain("불편함");
    }
    expect(strange.emotions).toContain("낯섦");
    for (const variant of strangeVariants) expect(variant.emotions).toContain("낯섦");
    expect(robbery.places).not.toContain("물가");
    expect(quick.places).not.toContain("집");
    expect(river.places).toContain("물가");
  });

  it("suppresses only explicitly negated emotion mentions and preserves unrelated positive emotion", () => {
    const negativeCases = [
      ["불안감은 없었어요.", "불안"],
      ["불안하지는 않았어요.", "불안"],
      ["결코 불안하지 않았어요.", "불안"],
      ["당황하지는 않았어요.", "당황스러움"],
      ["안 무서웠어요.", "두려움"],
      ["전혀 무섭지 않았어요.", "두려움"]
    ] as const;
    for (const [dream, emotion] of negativeCases) {
      const context = analyzeDreamContextLocally(dream, null).context;
      expect(context.emotions).not.toContain(emotion);
      expect(context.scenes.every(scene => scene.emotion !== emotion)).toBe(true);
    }

    const fearDespiteOtherNegation = analyzeDreamContextLocally("무서웠지만 도망가지는 않았어요.", null).context;
    const anxietyDespiteOtherNegation = analyzeDreamContextLocally("불안했지만 싫지는 않았어요.", null).context;
    const anxietyAfterEarlierNegation = analyzeDreamContextLocally("불안감은 없었지만 뒤에는 불안했어요.", null).context;
    expect(fearDespiteOtherNegation.emotions).toContain("두려움");
    expect(anxietyDespiteOtherNegation.emotions).toContain("불안");
    expect(anxietyAfterEarlierNegation.emotions).toContain("불안");
  });

  it("recognizes common Korean scene verbs and does not read 건물 as water", () => {
    const exitContext = analyzeDreamContextLocally(
      "회사 복도에서 문을 계속 찾다가 밝은 바깥으로 나왔고 답답함이 풀렸어요.",
      null
    ).context;
    const fallingContext = analyzeDreamContextLocally(
      "높은 건물에서 떨어질 것 같았지만 난간을 잡고 버텼고 무서웠어요.",
      null
    ).context;
    const exitAnswer = buildFreeAssistantPayload(exitContext);

    expect(exitContext.scenes.map((scene) => scene.action).join(" ")).toContain("출구를 찾아 밖으로 나감");
    expect(exitContext.emotions).toContain("안도감");
    expect(exitAnswer.directAnswer).toContain("빠져나갈 길을 찾으려는 마음");
    expect(fallingContext.symbols[0]?.key).toBe("falling");
    expect(fallingContext.symbols.map((symbol) => symbol.key)).not.toContain("water");
  });

  it("skips clarification when a concrete scene and emotion are already present", () => {
    const result = analyzeDreamLocally(DETAILED_DREAM, null);

    expect(result.questions).toHaveLength(0);
    expect(result.structure.symbols[0]?.name).toBe("뱀");
    expect(result.structure.emotions).toContain("두려움");
  });

  it("offers one non-leading open note for a vague dream", () => {
    const result = analyzeDreamLocally("뱀이 조용히 나타났다가 금방 사라지는 꿈을 꾸었어요.", null);

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.kind).toBe("scene");
    expect(result.questions[0]?.options).toEqual([]);
    expect(result.questions[0]?.prompt).not.toContain("가장 선명하게");
  });

  it("marks skipped details as uncertain instead of inventing them", () => {
    const analyzed = analyzeDreamLocally("뱀이 조용히 나타났다가 금방 사라지는 꿈을 꾸었어요.", null);
    const structure = applyClarifications(analyzed.structure, [
      { questionId: "scene", kind: "scene", answer: null, skipped: true }
    ]);
    const reading = buildFreeReading(structure, null);

    expect(structure.recentContext).toBeNull();
    expect(reading.uncertaintyNote).toContain("건너뛴 정보");
  });

  it("does not confuse an ordinary death dream with an immediate self-harm signal", () => {
    const ordinary = analyzeDreamLocally(
      "꿈에서 오래된 내가 죽고 장례식이 끝난 뒤 새로운 집으로 걸어가는데 마음이 평온했어요.",
      null
    );
    const risk = analyzeDreamLocally(
      "악몽에서 깬 뒤에도 지금 죽고 싶다는 생각이 계속 들고 혼자 있어요.",
      null
    );

    expect(ordinary.safetyNotice).toBeNull();
    expect(risk.safetyNotice?.resources.some((resource) => resource.phone === "109")).toBe(true);
    expect(risk.questions).toHaveLength(0);
  });

  it("produces a complete paid report within the product length target", () => {
    const structure = analyzeDreamLocally(DETAILED_DREAM, null).structure;
    const report = buildPaidReport(structure, new Date("2026-08-18T00:00:00.000Z"));
    const length = reportCharacterCount(report);

    expect(report.sections.map((section) => section.key)).toEqual([
      "overview",
      "traditional",
      "psychology",
      "pattern",
      "action"
    ]);
    expect(length).toBeGreaterThanOrEqual(1_200);
    expect(length).toBeLessThanOrEqual(1_800);
    expect(report.actions).toHaveLength(3);
    expect(hasUnsafeClaim(JSON.stringify(report))).toBe(false);
  });

  it("keeps the consultation payloads within the advertised reading lengths", () => {
    const context = analyzeDreamContextLocally(DETAILED_DREAM, null).context;
    const freeLength = assistantPayloadCharacterCount(buildFreeAssistantPayload(context));
    const detailed = buildDetailedAssistantPayload(context);
    const detailedLength = assistantPayloadCharacterCount(detailed);

    expect(freeLength).toBeGreaterThanOrEqual(350);
    expect(freeLength).toBeLessThanOrEqual(600);
    expect(detailedLength).toBeGreaterThanOrEqual(1_200);
    expect(detailedLength).toBeLessThanOrEqual(1_800);
    expect(detailedQualityError(detailed, buildPaidOfferFromContext(context))).toBeNull();
  });

  it("reports the exact detailed quality failure instead of one opaque gate", () => {
    const context = analyzeDreamContextLocally(DETAILED_DREAM, null).context;
    const offer = buildPaidOfferFromContext(context);
    const detailed = buildDetailedAssistantPayload(context);
    const tooShort = {
      ...detailed,
      directAnswer: "짧은 답변",
      sections: detailed.sections.map((section) => ({ ...section, paragraphs: [] })),
      interpretationChanges: null,
      uncertainty: [],
      shareableSentences: []
    };
    const missingSection = {
      ...detailed,
      sections: detailed.sections.filter((section) => section.title !== offer.cards[0]?.promisedSectionTitle)
    };
    const unsafe = { ...detailed, directAnswer: "반드시 사고가 일어납니다." };

    expect(detailedQualityError(tooShort, offer)).toBe("AI_DETAILED_TOO_SHORT");
    expect(detailedQualityError(missingSection, offer)).toBe("AI_DETAILED_MISSING_SECTION");
    expect(detailedQualityError(unsafe, offer)).toBe("AI_DETAILED_UNSAFE_CLAIM");
  });
});
