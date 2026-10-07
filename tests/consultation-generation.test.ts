import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPaidFormatRevision, detailedQualityError, freeQualityError, generateDetailedAssistant, paidFormatRevisionMaxLength, prepareConsultation, PaidGenerationError } from "@/lib/ai";
import { errorDetails } from "@/lib/http";
import { generateWithLocalCodex } from "@/lib/ai/codex-local";
import { buildConsultationOffer, buildConsultationPlan } from "@/lib/consultation";
import { analyzeDreamContextLocally } from "@/lib/local-engine";
import { addConversationMessage, createReading, getPublicReading, readingContext } from "@/lib/readings";
import { confirmPayment, createOrder } from "@/lib/payments";
import type { AssistantTurnPayload } from "@/lib/types";
import { DETAILED_DREAM, TestRepository } from "./helpers/repository";

vi.mock("@/lib/ai/codex-local",async importOriginal=>{
  const { effectiveAiMode } = await import("@/lib/app-profile");
  return {...await importOriginal<typeof import("@/lib/ai/codex-local")>(),
    localCodexConfigured:()=>effectiveAiMode() === "codex",generateWithLocalCodex:vi.fn()};
});
afterEach(()=>{vi.resetAllMocks();vi.restoreAllMocks();vi.unstubAllEnvs();});

const report:AssistantTurnPayload={
  qualityVersion:2, generationSource:"codex", directAnswerTitle:"두려움에서 편안함으로 바뀐 꿈",
  directAnswer:"검은 뱀이 집 안으로 들어왔을 때는 무서웠지만, 도망치지 않고 바라본 뒤 문을 열어 내보냈다고 했어요. 마지막에 마음이 편안해졌다는 점을 함께 보면, 이 꿈은 위협 자체보다 낯선 것을 마주하고 거리를 조절하는 과정에 무게를 두어 읽을 수 있어요.",
  sections:[
    {title:"이 장면들이 이어지는 이유",paragraphs:["처음의 무서움과 끝의 편안함 사이에는 가만히 바라보고 문을 열어주는 행동이 있어요. 뱀을 직접 내보내고 편안해진 결말을 함께 보면, 두려운 대상과의 거리를 스스로 조절하는 이야기로 읽어볼 수 있어요."]},
    {title:"장면에서 살펴볼 속마음",paragraphs:["같은 뱀이 나타나도 마지막까지 두려웠다면 위협이 남아 있는 방향을 살펴봤을 거예요. 이번에는 편안해진 끝과 직접 문을 열어 내보낸 행동이 있어, 두려운 대상을 마주하고 거리를 조절한 쪽에 무게를 두었어요."]},
    {title:"최근 이런 일이 계기가 됐을 수 있어요",paragraphs:["최근 실제로 어떤 일이 있었는지는 알려진 내용만으로는 확인할 수 없어요. 다만 낯선 부담을 바라보고 거리를 조절한 꿈속 행동을, 최근의 변화가 있었는지 돌아보는 질문과 연결해 볼 수 있어요."]},
    {title:"나에게 더 맞는 풀이를 구별하려면",paragraphs:["이 꿈의 의미를 하나로 단정하기보다, 실제로 확인된 행동과 마지막 감정에 잘 맞는 설명인지 살펴보면 좋아요. 다른 풀이가 꿈속 장면에 없는 사건이나 인물을 덧붙인다면 근거가 약한 설명일 수 있어요."]}
  ],interpretationChanges:null,uncertainty:[],shareableSentences:[],suggestedQuestions:["문을 열어준 선택은 어떤 의미로 읽을 수 있나요?"],evidenceQuotes:["검은 뱀이 우리 집 창문으로 천천히 들어왔어요", "마지막에는 이상하게 마음이 편안해졌어요"]
};
const accepted={approved:true,semanticQuality:"pass" as const,semanticConfidence:"high" as const,semanticReasonCodes:[],inventedFacts:[],missingElements:[],redundantInterpretation:false,unsupportedSequenceOrRole:false,usesOmissionAsFact:false,addsValueBeyondFree:true,correctionApplied:true,headlineAnswered:true,offerCoverage:[{key:"traditional" as const,fulfilled:true},{key:"psychology" as const,fulfilled:true},{key:"pattern" as const,fulfilled:true},{key:"action" as const,fulfilled:true}],revisionTargets:[],feedback:"확인한 사실을 근거로 다른 읽기와 구분한다."};
const reportWithReality:AssistantTurnPayload={...report,sections:report.sections.map((section,index)=>index===1?{...section,title:"장면에서 살펴볼 속마음",paragraphs:["알려준 현실의 맥락과 꿈속 행동을 구분해, 두 사실에서 확인되는 공통점과 차이를 비교해요."]}:section)};
const acceptedWithReality=accepted;

describe("consultation generation gates",()=> {
  it("preserves the actionable paid failure message in API and progress responses",()=> {
    const details=errorDetails(new PaidGenerationError());
    expect(details.status).toBe(503);
    expect(details.body.error.code).toBe("PAID_GENERATION_FAILED");
    expect(details.body.error.message).toContain("결제는 유지");
  });
  it("caps paid semantic-major repair at one rewrite and fails delivery if it remains major",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const major={...accepted,approved:false,semanticQuality:"major" as const,
      semanticReasonCodes:["fewer_than_two_new_perspectives" as const],
      missingElements:["두 개의 서로 다른 새 해석 관점이 부족해요."],revisionTargets:["section:1" as const]};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(report).mockResolvedValueOnce(major)
      .mockResolvedValueOnce(report).mockResolvedValueOnce(major);
    await expect(generateDetailedAssistant(analyzeDreamContextLocally(DETAILED_DREAM,null).context,
      "paid-semantic-single-rewrite","none",DETAILED_DREAM)).rejects.toThrow("무료 풀이와 구별되는 새 해석");
    expect(vi.mocked(generateWithLocalCodex).mock.calls.map(([request])=>request.schemaName)).toEqual([
      "dream_detailed_answer","dream_report_review","dream_detailed_answer","dream_report_review"
    ]);
    expect(vi.mocked(generateWithLocalCodex).mock.calls[1]![0].instructions).toContain("새 해석 관점 최소 두 개");
  });
  it("promises an interpretation of observed actions instead of a repeated symbol definition",()=> {
    const offer=buildConsultationOffer(analyzeDreamContextLocally(DETAILED_DREAM,null).context);
    expect(offer.cards[0].firstSentence).toMatch(/대상의 특징(?:과 행동|이 꿈 전체에서)/);
    expect(offer.cards[0].firstSentence).not.toContain("상징의 의미");
  });
  it("promises to distinguish waking context from dream action when reality is confirmed",()=> {
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const plan=buildConsultationPlan(context);
    const offer=buildConsultationOffer(context,{...plan,sectionTopics:[...plan.sectionTopics,"reality"]});
    expect(offer.cards[0].title).toContain("꿈속 인물과 행동");
    expect(offer.cards[0].firstSentence).toContain("꿈속 인물의 역할과 실제 행동");
    expect(offer.checkoutSummary).not.toContain("현실 맥락과의 비교");
    const withReality={...context,realityContexts:["사용자가 알려준 현실 상황"]};
    const fullOffer=buildConsultationOffer(withReality,{...plan,sectionTopics:[...plan.sectionTopics,"reality"]});
    expect(fullOffer.cards).toHaveLength(4);
    expect(fullOffer.cards.map(card=>card.key)).toEqual(["traditional","psychology","pattern","action"]);
    expect(fullOffer.checkoutSummary).toContain("최근 계기 2~3개");
  });
  it.each(["이 질문을 함께 살펴볼 수 있어요.", "대비가 나타나는 형태로 읽을 수 있어요.", "되돌아보라는 의미로도 읽을 수 있어요.", "해결 방안을 찾는 마음과 이어져요.", "누군가를 마주하는 느낌에 주목해요.", "자유로운 움직임에 눈길이 가요."])("accepts ordinary Korean without inventing a scene: %s", sentence=> {
    const dream=DETAILED_DREAM.replaceAll("창문", "틈").replaceAll("문", "틈");
    const baseline=JSON.parse(JSON.stringify(report).replaceAll("창문", "틈").replaceAll("문", "틈")) as AssistantTurnPayload;
    const context=analyzeDreamContextLocally(dream,null).context;
    expect(detailedQualityError({...baseline,directAnswer:baseline.directAnswer+" "+sentence},buildConsultationOffer(context),dream,context)).toBeNull();
  });
  it.each(["비가 내렸어요.", "보라색 우산이 있었어요.", "방 안에서 쉬었어요."])("still rejects invented concrete details: %s", sentence=> {
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    expect(detailedQualityError({...report,directAnswer:report.directAnswer+sentence},buildConsultationOffer(context),DETAILED_DREAM,context)).toBe("AI_DETAILED_UNGROUNDED_SCENE");
  });
  it("does not turn an omitted identity into a feature of the dream",()=> {
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const invalid={...report,directAnswer:report.directAnswer+" 상대의 정체가 드러나지 않아 막연한 부담에 가까워 보여요."};
    expect(detailedQualityError(invalid,buildConsultationOffer(context),DETAILED_DREAM,context)).toBe("AI_DETAILED_OMISSION_AS_FACT");
  });
  it("allows a nearby identity comparison but still blocks an asserted unidentified figure",()=> {
    const dream=`${DETAILED_DREAM} 꿈에서 남성 친구 민수에게서 도망쳤다가 다시 다가갔어요. 처음엔 두려웠지만 다가간 뒤 안도했어요.`;
    const context=analyzeDreamContextLocally(dream,null).context;
    const offer=buildConsultationOffer(context);
    const comparative={...report,directAnswer:report.directAnswer+" 정체를 알 수 없는 사람이 도망치는 장면보다 이미 확인된 친구 민수와의 관계에 무게를 둬 읽을 수 있어요."};
    expect(detailedQualityError(comparative,offer,dream,context)).not.toBe("AI_DETAILED_OMISSION_AS_FACT");

    const mixed={...report,directAnswer:report.directAnswer+" 정체를 알 수 없는 사람이 도망치는 장면보다 이미 확인된 친구 민수와의 관계에 무게를 둘 수 있고, 정체가 드러나지 않은 인물이 꿈에 실제로 나타났어요."};
    expect(detailedQualityError(mixed,offer,dream,context)).toBe("AI_DETAILED_OMISSION_AS_FACT");

    const unrelatedComparator={...report,directAnswer:report.directAnswer+" 상대의 정체가 드러나지 않지만 친구의 행동보다 감정에 주목해 읽을 수 있어요."};
    expect(detailedQualityError(unrelatedComparator,offer,dream,context)).toBe("AI_DETAILED_OMISSION_AS_FACT");

    const actionBeforeComparator={...report,directAnswer:report.directAnswer+" 정체를 알 수 없는 사람이 친구보다 먼저 달렸어요."};
    expect(detailedQualityError(actionBeforeComparator,offer,dream,context)).toBe("AI_DETAILED_OMISSION_AS_FACT");

    const assertedUnknownSituation={...report,directAnswer:report.directAnswer+" 상대의 정체가 드러나지 않는 상황이었지만, 그 사실보다 관계의 거리가 중요해요."};
    expect(detailedQualityError(assertedUnknownSituation,offer,dream,context)).toBe("AI_DETAILED_OMISSION_AS_FACT");

    const assertedUnknownFigureBeforeComparison={...report,directAnswer:report.directAnswer+" 정체가 드러나지 않은 사람이 실제로 나타난 장면보다 확인된 친구의 관계가 중요해요."};
    expect(detailedQualityError(assertedUnknownFigureBeforeComparison,offer,dream,context)).toBe("AI_DETAILED_OMISSION_AS_FACT");

    const unknownFigureActedBeforeComparison={...report,directAnswer:report.directAnswer+" 정체를 알 수 없는 사람이 실제로 달렸던 장면보다 친구와의 관계가 중요해요."};
    expect(detailedQualityError(unknownFigureActedBeforeComparison,offer,dream,context)).toBe("AI_DETAILED_OMISSION_AS_FACT");

    const actualizedUnknownAlternative={...report,directAnswer:report.directAnswer+" 꿈에서 정체를 알 수 없는 사람이 도망치는 장면보다 확인된 친구와의 관계가 중요해요."};
    expect(detailedQualityError(actualizedUnknownAlternative,offer,dream,context)).toBe("AI_DETAILED_OMISSION_AS_FACT");

    const inPhraseActualSceneMarker={...report,directAnswer:report.directAnswer+" 정체를 알 수 없는 사람이 꿈속에서 도망치는 장면보다 확인된 친구와의 관계가 중요해요."};
    expect(detailedQualityError(inPhraseActualSceneMarker,offer,dream,context)).toBe("AI_DETAILED_OMISSION_AS_FACT");
  });
  it("does not mistake 균형 or 받아들임 for a male family member",()=> {
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const valid={...report,directAnswer:report.directAnswer+" 장면의 균형과 받아들임이라는 관점에서도 읽을 수 있어요."};
    expect(detailedQualityError(valid,buildConsultationOffer(context),DETAILED_DREAM,context)).toBeNull();
    expect(detailedQualityError({...report,directAnswer:report.directAnswer+" 형이 나타났어요."},buildConsultationOffer(context),DETAILED_DREAM,context)).toBe("AI_DETAILED_UNSUPPORTED_IDENTITY");
  });
  it("rejects an invented spouse while allowing a spouse named in the dream",()=> {
    const dreamContext=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const offer=buildConsultationOffer(dreamContext);
    const invented={...report,directAnswer:report.directAnswer+" 아내가 곁에서 함께 움직였어요."};
    expect(detailedQualityError(invented,offer,DETAILED_DREAM,dreamContext)).toBe("AI_DETAILED_UNSUPPORTED_IDENTITY");

    const dreamWithSpouse=`${DETAILED_DREAM} 꿈에서 아내가 옆에 있었어요.`;
    const spouseContext=analyzeDreamContextLocally(dreamWithSpouse,null).context;
    const grounded={...report,directAnswer:report.directAnswer+" 아내가 곁에 있었다고 한 점도 함께 살펴볼 수 있어요."};
    expect(detailedQualityError(grounded,buildConsultationOffer(spouseContext),dreamWithSpouse,spouseContext)).not.toBe("AI_DETAILED_UNSUPPORTED_IDENTITY");
  });
  it("keeps a dreamed relationship event separate from an unsupported real event",()=> {
    const dream=`${DETAILED_DREAM} 꿈에서 남편의 외도 장면도 있었어요.`;
    const context=analyzeDreamContextLocally(dream,null).context;
    const offer=buildConsultationOffer(context);
    const unsupported={...report,directAnswer:report.directAnswer+" 최근 현실에서 남편의 외도 소식을 들은 상황이에요."};
    expect(detailedQualityError(unsupported,offer,dream,context)).toBe("AI_DETAILED_DREAM_REALITY_MIX");

    const bounded={...report,directAnswer:report.directAnswer+" 꿈에서 본 남편의 외도 장면은 현실의 실제 사건을 뜻한다고 단정할 수 없어요."};
    expect(detailedQualityError(bounded,offer,dream,context)).not.toBe("AI_DETAILED_DREAM_REALITY_MIX");
  });
  it("allows only grounded unreadable writing to remain unknown in paid interpretation",()=> {
    const dream="꿈에서 접어 둔 종이를 다시 펼쳐 읽었어요. 글자가 흐릿해 읽을 수 없었고, 창문을 열어 바람을 맞을 때는 차분했어요.";
    const context=analyzeDreamContextLocally(dream,null).context;
    // Historical two-section fixture isolates factual omission checks from the new writer schema.
    const offerFor=(value:typeof context)=>({...buildConsultationOffer(value),cards:buildConsultationOffer(value).cards.slice(0,2).map((card,index)=>({...card,promisedSectionTitle:index===0?"통합 해석":"해석을 선택한 이유"}))});
    const offer=offerFor(context);
    const valid:AssistantTurnPayload={...report,directAnswerTitle:"읽을 수 없었던 글과 차분한 장면",directAnswer:"접어 둔 종이를 다시 펼쳤지만 글자가 흐려 읽을 수 없었고, 창문을 열어 바람을 맞을 때는 차분했다고 했어요. 확인하려다 멈춘 행동과 차분한 상태가 함께 나타난 흐름에 무게를 둘 수 있어요. 글을 읽지 못해 덮은 뒤 창문을 연 순서도 이 꿈을 구체적으로 읽는 단서예요.",sections:[
      {title:"통합 해석",paragraphs:["글을 읽으려다 덮은 뒤 창문을 연 순서가 이어져요. 차분했다고 알려준 감정까지 보면, 답을 얻기보다 잠시 멈추고 바람을 맞는 쪽으로 장면이 마무리됐어요. 종이를 펼치고 덮은 행동 다음에 창문을 열었다는 흐름은 한 장면의 전환을 보여줘요."]},
      {title:"해석을 선택한 이유",paragraphs:["종이에 적힌 문장의 정확한 내용은 알 수 없지만, 글자가 흐려 읽지 못했다는 점과 창문을 열 때 차분했다는 점은 확인돼요. 그래서 글의 뜻을 상상하지 않고, 읽기를 멈춘 뒤 차분함으로 이어진 실제 행동을 중심으로 해석했어요. 만약 글을 읽었다면 내용도 풀이에 보탤 수 있었겠지만, 이 꿈에서는 읽지 못했다는 경험 자체와 이후의 행동이 비교 근거예요."]}
    ],suggestedQuestions:[],uncertainty:[],shareableSentences:[],interpretationChanges:null,evidenceQuotes:["접어 둔 종이를 다시 펼쳐 읽었어요","글자가 흐릿해 읽을 수 없었고","창문을 열어 바람을 맞을 때는 차분했어요"]};
    expect(detailedQualityError(valid,offer,dream,context)).toBeNull();
    const inscriptionQuestion={...valid,sections:[...valid.sections.slice(0,1),{...valid.sections[1]!,paragraphs:["종이에는 무엇이 적혀 있었는지 알 수 없어요.",valid.sections[1]!.paragraphs[0]!]}]};
    expect(detailedQualityError(inscriptionQuestion,offer,dream,context)).toBeNull();
    const mixedInscriptionQuestion={...valid,sections:[...valid.sections.slice(0,1),{...valid.sections[1]!,paragraphs:["종이에는 무엇이 적혀 있었는지 알 수 없지만 감정도 드러나지 않았어요.",valid.sections[1]!.paragraphs[0]!]}]};
    expect(detailedQualityError(mixedInscriptionQuestion,offer,dream,context)).toBe("AI_DETAILED_FALSE_MISSING_DETAIL");
    const coordinatedInscriptionAndEmotion={...valid,sections:[...valid.sections.slice(0,1),{...valid.sections[1]!,paragraphs:["종이에 무엇이 적혀 있었는지와 감정은 알 수 없어요.",valid.sections[1]!.paragraphs[0]!]}]};
    expect(detailedQualityError(coordinatedInscriptionAndEmotion,offer,dream,context)).toBe("AI_DETAILED_FALSE_MISSING_DETAIL");
    const reversedCoordinatedInscriptionAndEmotion={...valid,sections:[...valid.sections.slice(0,1),{...valid.sections[1]!,paragraphs:["감정과 종이에는 무엇이 적혀 있었는지는 알 수 없어요.",valid.sections[1]!.paragraphs[0]!]}]};
    expect(detailedQualityError(reversedCoordinatedInscriptionAndEmotion,offer,dream,context)).toBe("AI_DETAILED_FALSE_MISSING_DETAIL");
    const sharedPredicateInscriptionAndEmotion={...valid,sections:[...valid.sections.slice(0,1),{...valid.sections[1]!,paragraphs:["종이에 무엇이 적혔고 감정이 어땠는지 알 수 없어요.",valid.sections[1]!.paragraphs[0]!]}]};
    expect(detailedQualityError(sharedPredicateInscriptionAndEmotion,offer,dream,context)).toBe("AI_DETAILED_FALSE_MISSING_DETAIL");
    const precedingEmotionAndInscription={...valid,sections:[...valid.sections.slice(0,1),{...valid.sections[1]!,paragraphs:["어떤 감정이었고 무엇이 적혀 있었는지 알 수 없어요.",valid.sections[1]!.paragraphs[0]!]}]};
    expect(detailedQualityError(precedingEmotionAndInscription,offer,dream,context)).toBe("AI_DETAILED_FALSE_MISSING_DETAIL");
    const unsupportedObjectOmission={...valid,sections:[...valid.sections.slice(0,1),{...valid.sections[1]!,paragraphs:["꿈속 물건의 종류는 구체적이지 않아요.",valid.sections[1]!.paragraphs[0]!]}]};
    expect(detailedQualityError(unsupportedObjectOmission,offer,dream,context)).toBe("AI_DETAILED_FALSE_MISSING_DETAIL");
    const mixedClaim={...valid,sections:[...valid.sections.slice(0,1),{...valid.sections[1]!,paragraphs:["종이에 적힌 문장의 정확한 내용은 알 수 없고 감정도 드러나지 않았어요.",valid.sections[1]!.paragraphs[0]!]}]};
    expect(detailedQualityError(mixedClaim,offer,dream,context)).toBe("AI_DETAILED_FALSE_MISSING_DETAIL");
    const knownWritingDream="꿈에서 접어 둔 종이를 다시 펼쳐 읽었어요. 종이에는 ‘내일 확인’이라고 적혀 있었고, 창문을 열어 바람을 맞을 때는 차분했어요.";
    const knownWritingContext=analyzeDreamContextLocally(knownWritingDream,null).context;
    const knownWriting={...valid,directAnswer:"접어 둔 종이를 다시 펼쳤을 때 ‘내일 확인’이라는 글을 읽었고, 창문을 열어 바람을 맞을 때는 차분했다고 했어요. 글을 덮은 뒤 창문을 연 순서가 이어져요. 내용을 확인한 다음 바람을 맞은 흐름은, 읽기 자체보다 이어진 행동과 차분해진 느낌에 중심을 두게 해요.",sections:[valid.sections[0]!,{...valid.sections[1]!,paragraphs:["종이에 적힌 문장의 정확한 내용은 알 수 없지만, 읽었다고 한 행동과 창문을 열 때 차분했던 점은 확인돼요.",valid.sections[1]!.paragraphs[0]!]}],evidenceQuotes:["접어 둔 종이를 다시 펼쳐 읽었어요","종이에는 ‘내일 확인’이라고 적혀 있었고","창문을 열어 바람을 맞을 때는 차분했어요"]};
    expect(detailedQualityError(knownWriting,offerFor(knownWritingContext),knownWritingDream,knownWritingContext)).toBe("AI_DETAILED_FALSE_MISSING_DETAIL");
    const knownWritingQuestion={...knownWriting,sections:[...knownWriting.sections.slice(0,1),{...knownWriting.sections[1]!,paragraphs:["종이에는 무엇이 적혀 있었는지 알 수 없어요.",knownWriting.sections[1]!.paragraphs[0]!]}]};
    expect(detailedQualityError(knownWritingQuestion,offerFor(knownWritingContext),knownWritingDream,knownWritingContext)).toBe("AI_DETAILED_FALSE_MISSING_DETAIL");
    const mixedUnsplit={...valid,sections:[...valid.sections.slice(0,1),{...valid.sections[1]!,paragraphs:["종이에 적힌 문장의 내용과 감정은 알 수 없어요.",valid.sections[1]!.paragraphs[0]!]}]};
    expect(detailedQualityError(mixedUnsplit,offer,dream,context)).toBe("AI_DETAILED_FALSE_MISSING_DETAIL");
    const reverseMixed={...valid,sections:[...valid.sections.slice(0,1),{...valid.sections[1]!,paragraphs:["감정은 알 수 없다는 점과 문장의 내용을 함께 살펴봐요.",valid.sections[1]!.paragraphs[0]!]}]};
    expect(detailedQualityError(reverseMixed,offer,dream,context)).toBe("AI_DETAILED_FALSE_MISSING_DETAIL");
    const knownReaderDream="꿈에서 엄마가 편지를 읽었지만 글씨를 읽지 못했고 창문을 열었어요.";
    const knownReaderContext=analyzeDreamContextLocally(knownReaderDream,null).context;
    const unknownReader={...valid,evidenceQuotes:["엄마가 편지를 읽었지만 글씨를 읽지 못했고","창문을 열었어요"],sections:[...valid.sections.slice(0,1),{...valid.sections[1]!,paragraphs:["편지를 읽은 사람이 누구인지는 알 수 없어요.",valid.sections[1]!.paragraphs[0]!]}]};
    expect(["AI_DETAILED_FALSE_MISSING_DETAIL","AI_DETAILED_OMISSION_AS_FACT"]).toContain(detailedQualityError(unknownReader,offerFor(knownReaderContext),knownReaderDream,knownReaderContext));
    const blurryButReadableDream="꿈에서 종이에 적힌 글씨가 흐릿했지만 ‘내일 확인’이라는 문구를 읽고 창문을 열 때는 차분했어요.";
    const blurryButReadableContext=analyzeDreamContextLocally(blurryButReadableDream,null).context;
    const blurryButReadable={...knownWriting,evidenceQuotes:["종이에 적힌 글씨가 흐릿했지만","‘내일 확인’이라는 문구를 읽고","창문을 열 때는 차분했어요"]};
    expect(detailedQualityError(blurryButReadable,offerFor(blurryButReadableContext),blurryButReadableDream,blurryButReadableContext)).toBe("AI_DETAILED_FALSE_MISSING_DETAIL");
  });
  it("preserves the free false-missing-detail decision for the same unreadable-writing claim",()=> {
    const dream="꿈에서 접어 둔 종이를 다시 펼쳐 읽었어요. 글자가 흐릿해 읽을 수 없었고, 창문을 열어 바람을 맞을 때는 차분했어요.";
    const context=analyzeDreamContextLocally(dream,null).context;
    const free:AssistantTurnPayload={...report,directAnswerTitle:"종이와 창문",directAnswer:"접어 둔 종이를 다시 펼쳐 읽고 글자가 흐릿해 읽을 수 없었던 장면은, 확인하려는 마음과 잠시 멈추는 흐름을 함께 보여줘요.",sections:[
      {title:"장면을 나눠보면",paragraphs:["종이를 다시 펼쳐 읽으려 했지만 글자가 흐릿했고, 창문을 열어 바람을 맞았다고 했어요. 종이를 펼치고 덮는 행동과 바깥 공기를 맞는 행동이 순서대로 이어져요."]},
      {title:"심리적으로 가능한 연결",paragraphs:["종이에 적힌 문장의 정확한 내용과 무엇을 했는지는 알 수 없어요. 읽으려다가 알아볼 수 없어 멈춘 경험과 창문을 연 행동을 함께 보면, 확인을 계속하기보다 잠시 시선을 돌리는 흐름으로 읽을 수 있어요."]},
      {title:"꿈만으로 확실히 말할 수 없는 부분",paragraphs:["글 속에 어떤 말이 있었는지는 확인되지 않았어요. 그 내용을 현실의 누군가의 생각이나 실제 사건으로 연결할 근거는 없어요. 다만 꿈에서 직접 펼치고 덮은 행동, 창문을 열 때 차분했다고 한 느낌은 읽기의 근거로 삼을 수 있어요."]}
    ],suggestedQuestions:[],uncertainty:[],shareableSentences:[],interpretationChanges:null,evidenceQuotes:["종이를 다시 펼쳐 읽었어요","글자가 흐릿해 읽을 수 없었고","창문을 열어 바람을 맞을 때는 차분했어요"]};
    expect(freeQualityError(free,dream,context)).toBe("AI_FREE_FALSE_MISSING_DETAIL");
    const freeInscriptionQuestion={...free,sections:[free.sections[0]!,{...free.sections[1]!,paragraphs:["종이에는 무엇이 적혀 있었는지 알 수 없어요.",free.sections[1]!.paragraphs[0]!]},free.sections[2]!]};
    expect(freeQualityError(freeInscriptionQuestion,dream,context)).toBe("AI_FREE_FALSE_MISSING_DETAIL");
  });
  it("keeps a correction if the planner fails, hides the stale report, and charges nothing",async()=> {
    vi.stubEnv("APP_PROFILE","");vi.stubEnv("AI_MODE","local");vi.stubEnv("PAYMENTS_MODE","mock");
    const repository=new TestRepository();
    const reading=await createReading({dream:DETAILED_DREAM,emotion:null},"correction-outage",repository);
    const order=await createOrder(reading,"full_reading","correction-outage",repository);
    const paid=await confirmPayment({paymentKey:"mock_correction_outage",orderId:order.id,amount:990},"correction-outage",repository);
    vi.stubEnv("APP_PROFILE","local-ai");
    vi.mocked(generateWithLocalCodex).mockRejectedValue(new Error("offline"));
    await expect(addConversationMessage(paid,{clientMessageId:"correction_outage",message:"장소는 학교였어"},repository)).rejects.toMatchObject({code:"FOLLOWUP_GENERATION_FAILED"});
    const stored=(await repository.getReading(paid.id))!;
    expect(readingContext(stored).dreamEvidence).toContain("학교였어");
    const view=await getPublicReading(stored,"https://dream.test",repository);
    expect(view.timeline.some(turn=>turn.kind==="detailed")).toBe(false);
    expect(view.entitlement.usedQuestions).toBe(0);
    vi.stubEnv("APP_PROFILE","");vi.stubEnv("AI_MODE","local");
    const retried=await addConversationMessage(stored,{clientMessageId:"correction_outage",message:"장소는 학교였어"},repository);
    expect(retried.detailGenerationStatus).toBe("ready");
    expect((await repository.getEntitlement(paid.id))?.usedQuestions).toBe(0);
  });
  it("uses a general fact planner for scenes and places outside the symbol catalog",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const dream="해저 전시장에서 투명한 악기를 연주했어요. 소리가 멈추자 악기를 내려놓았고 마음이 편안했어요.";
    const context=analyzeDreamContextLocally(dream,null).context;
    vi.mocked(generateWithLocalCodex).mockResolvedValue({disposition:"READY_DREAM",facts:["해저 전시장에서 투명한 악기를 연주했어요"],keyElements:[{label:"악기를 연주함",evidence:"악기를 연주했어요"},{label:"편안한 결말",evidence:"마음이 편안했어요"}],supportedTopics:[{topic:"place",evidence:"해저 전시장에서"},{topic:"emotion",evidence:"마음이 편안했어요"}],sequenceConfirmed:true,unresolved:["악기의 정확한 종류는 알려지지 않음"],ready:true,question:null});
    const plan=await prepareConsultation(context,dream,{selectedEmotion:null,clarificationAnswers:[]},"outside-catalog");
    expect(plan.ready).toBe(true);
    expect(plan.sectionTopics).toContain("place");
    expect(plan.question).toBeNull();
    expect(vi.mocked(generateWithLocalCodex).mock.calls[0][0].schemaName).toBe("dream_fact_check");
  });
  it("reports planner outages as service failures, not insufficient user information",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    vi.mocked(generateWithLocalCodex).mockRejectedValue(new Error("offline"));
    await expect(prepareConsultation(analyzeDreamContextLocally(DETAILED_DREAM,null).context,DETAILED_DREAM,{selectedEmotion:null,clarificationAnswers:[]},"outage")).rejects.toMatchObject({code:"FACT_CHECK_UNAVAILABLE",status:503});
  });
  it("accepts waking context quoted from the original even when the local splitter misses it",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const dream="꿈에서 오랜 동료와 공원을 걸었어요. 룸메이트랑 숙소에서 자고 있었는데 왜 이런 꿈일까요?";
    const context=analyzeDreamContextLocally(dream,null).context;
    expect(context.realityContexts).toEqual([]);
    vi.mocked(generateWithLocalCodex).mockResolvedValue({
      disposition:"READY_DREAM",facts:["오랜 동료와 공원을 걸었어요"],
      keyElements:[{label:"함께 걷는 장면",evidence:"동료와 공원을 걸었어요"}],
      supportedTopics:[{topic:"reality",evidence:"룸메이트랑 숙소에서 자고 있었는데"}],
      sequenceConfirmed:false,unresolved:[],ready:true,question:null
    });
    const plan=await prepareConsultation(context,dream,{selectedEmotion:null,clarificationAnswers:[]},"waking-context");
    expect(plan.ready).toBe(true);
    expect(plan.sectionTopics).toContain("reality");
    expect(plan.facts).toEqual(["오랜 동료와 공원을 걸었어요"]);
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(1);
  });
  it("repairs a duplicate explicit waking fact without a second planner call and keeps it out of dream facts",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const dreamFact="꿈에서 시험지를 읽다가 잠에서 깼어요", waking="현실에서는 다음 주 면접이 있어요";
    const dream=`${dreamFact}. ${waking}.`;
    vi.mocked(generateWithLocalCodex).mockResolvedValue({disposition:"READY_DREAM",facts:[dreamFact,waking],keyElements:[{label:"시험지를 읽음",evidence:"시험지를 읽다가 잠에서 깼어요"}],supportedTopics:[{topic:"reality",evidence:waking}],sequenceConfirmed:true,unresolved:[],ready:true,question:null});
    const plan=await prepareConsultation(analyzeDreamContextLocally(dream,null).context,dream,{selectedEmotion:null,clarificationAnswers:[]},"waking-duplicate");
    expect(plan.ready).toBe(true);expect(plan.facts).toEqual([dreamFact]);
    expect(plan.sectionTopics).toContain("reality");
    expect(plan).toMatchObject({supportedTopics:[{topic:"reality",evidence:waking}]});
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(1);
    const input=JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[0][0].inputJson);
    expect(input.explicitRealityEvidence).toEqual([waking]);
    expect(input.factEvidence.join(" ")).not.toContain(waking);
  });
  it.each([false,true])("uses only unskipped reality answers as evidence (skipped=%s)",async skipped=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const dream="오랜 동료와 공원을 걸었어요. 헤어질 때는 아쉬웠어요.";
    const context=analyzeDreamContextLocally(dream,null).context;
    const userEvidence={selectedEmotion:null,clarificationAnswers:[
      {questionId:"reality",kind:"recent_context" as const,answer:"새로운 동네로 이사를 준비하고 있어요",skipped}
    ]};
    vi.mocked(generateWithLocalCodex).mockResolvedValue({
      disposition:"READY_DREAM",facts:["오랜 동료와 공원을 걸었어요"],keyElements:[{label:"함께 걷는 장면",evidence:"동료와 공원을 걸었어요"}],
      supportedTopics:[{topic:"reality",evidence:"새로운 동네로 이사를 준비하고 있어요"}],
      sequenceConfirmed:false,unresolved:[],ready:true,question:null
    });
    const result=await prepareConsultation(context,dream,userEvidence,"reality-answer");
    expect(result.sectionTopics.includes("reality")).toBe(!skipped);
    expect(result.ready).toBe(true);
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(1);
  });
  it.each(["fact","element"])("still rejects invented %s evidence after one repair and does not call it a connection failure",async field=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const dream="오랜 동료와 공원을 걸었어요. 헤어질 때는 아쉬웠어요.";
    const invented="직장 상사와 말다툼했어요";
    vi.mocked(generateWithLocalCodex).mockResolvedValue({
      disposition:"READY_DREAM",facts:[field==="fact" ? invented : "오랜 동료와 공원을 걸었어요"],
      keyElements:[{label:"함께 걷는 장면",evidence:field==="element" ? invented : "동료와 공원을 걸었어요"}],
      supportedTopics:[],
      sequenceConfirmed:false,unresolved:[],ready:true,question:null
    });
    const failure=await prepareConsultation(analyzeDreamContextLocally(dream,null).context,dream,{selectedEmotion:null,clarificationAnswers:[]},"invented-evidence").catch(error=>error);
    expect(failure).toMatchObject({code:"FACT_CHECK_UNGROUNDED",status:502});
    const details=errorDetails(failure);
    expect(details.body.error.message).toContain("원문과 대조하지 못했어요");
    expect(details.body.error.message).not.toContain("연결");
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(2);
    expect(vi.mocked(generateWithLocalCodex).mock.calls[1][0].timeoutCapMs).toBe(30_000);
  });
  it("repairs only the rejected fact and logs the decision without dream or model prose",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const logs=vi.spyOn(console,"info").mockImplementation(()=>undefined);
    const dream="오랜 동료와 공원을 걸었어요. 헤어질 때는 아쉬웠어요.";
    const valid={disposition:"READY_DREAM",facts:["오랜 동료와 공원을 걸었어요"],keyElements:[{label:"함께 걷는 장면",evidence:"공원을 걸었어요"}],supportedTopics:[],sequenceConfirmed:false,unresolved:[],ready:true,question:null};
    const invalid={...valid,facts:["직장 상사와 말다툼했어요"]};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(invalid).mockResolvedValueOnce(valid);
    const progress=vi.fn();
    const plan=await prepareConsultation(analyzeDreamContextLocally(dream,null).context,dream,{selectedEmotion:null,clarificationAnswers:[]},"repair-private",progress);
    expect(plan.facts).toEqual(valid.facts);
    expect(plan.ready).toBe(true);
    expect(progress).toHaveBeenCalledWith("fact_check_repair");
    expect(progress).toHaveBeenLastCalledWith("quality_checked");
    const repair=JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[1][0].inputJson).revisionRequest;
    expect(repair.previousPlan.facts).toEqual(invalid.facts);
    expect(repair.issues).toEqual([expect.objectContaining({field:"facts",index:0,action:"repair_required"})]);
    const events=logs.mock.calls.map(([entry])=>JSON.parse(String(entry))).filter(entry=>entry.event==="dream_fact_check");
    expect(events.map(event=>event.outcome)).toEqual(["repair_requested","accepted"]);
    expect(events[0].requestId).toBe(events[1].requestId);
    const logText=JSON.stringify(logs.mock.calls);
    expect(logText).not.toContain("오랜 동료");
    expect(logText).not.toContain("직장 상사");
    expect(logText).not.toContain("repair-private");
  });
  it.each(["role","reality"])("omits an unsupported optional %s section without another model call",async topic=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const dream="오랜 동료와 공원을 걸었어요. 헤어질 때는 아쉬웠어요.";
    vi.mocked(generateWithLocalCodex).mockResolvedValue({
      disposition:"READY_DREAM",facts:["오랜 동료와 공원을 걸었어요"],keyElements:[{label:"함께 걷는 장면",evidence:"공원을 걸었어요"}],
      supportedTopics:[{topic,evidence:"직장 상사와 말다툼했어요"}],sequenceConfirmed:false,unresolved:[],ready:true,question:null
    });
    const plan=await prepareConsultation(analyzeDreamContextLocally(dream,null).context,dream,{selectedEmotion:null,clarificationAnswers:[]},"optional-topic");
    expect(plan.sectionTopics).toEqual(["narrative"]);
    expect(plan.ready).toBe(true);
    expect(JSON.stringify(plan)).not.toContain("직장 상사");
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(1);
  });
  it("does not extend a slow rejected request with another generation",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    let now=0;
    vi.spyOn(Date,"now").mockImplementation(()=>now);
    const logs=vi.spyOn(console,"info").mockImplementation(()=>undefined);
    vi.mocked(generateWithLocalCodex).mockImplementation(async()=>{
      now=31_000;
      return {disposition:"READY_DREAM",facts:["직장 상사와 말다툼했어요"],keyElements:[{label:"공원",evidence:"공원"}],supportedTopics:[],sequenceConfirmed:false,unresolved:[],ready:true,question:null};
    });
    const dream="오랜 동료와 공원을 걸었어요. 헤어질 때는 아쉬웠어요.";
    const error=await prepareConsultation(analyzeDreamContextLocally(dream,null).context,dream,{selectedEmotion:null,clarificationAnswers:[]},"slow-rejection").catch(error=>error);
    expect(error).toMatchObject({code:"FACT_CHECK_UNGROUNDED"});
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(1);
    const event=logs.mock.calls.map(([entry])=>JSON.parse(String(entry))).find(entry=>entry.event==="dream_fact_check");
    expect(event).toMatchObject({outcome:"rejected",repairSkipped:"latency_budget",durationMs:31_000});
    expect(error.message).toContain(event.requestId);
  });
  it("accepts a slow literal response with a final question mark without another model call",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    let now=0;
    vi.spyOn(Date,"now").mockImplementation(()=>now);
    const logs=vi.spyOn(console,"info").mockImplementation(()=>undefined);
    const first="오래전 동료가 나오는 꿈을 꿨어";
    const last="공원 벤치에 앉아 있었는데 이거 왜이래";
    const dream=`${first}. ${last}?`;
    vi.mocked(generateWithLocalCodex).mockImplementation(async()=>{
      now=33_379;
      return {disposition:"READY_DREAM",facts:[first,`${last}?`],keyElements:[{label:"벤치에 앉음",evidence:"공원 벤치에 앉아 있었는데"}],
        supportedTopics:[],sequenceConfirmed:false,unresolved:[],ready:true,question:null};
    });
    const plan=await prepareConsultation(analyzeDreamContextLocally(dream,null).context,dream,
      {selectedEmotion:null,clarificationAnswers:[]},"terminal-question-mark");
    expect(plan.facts).toEqual([first,last]);
    expect(plan.ready).toBe(true);
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(1);
    const event=logs.mock.calls.map(([entry])=>JSON.parse(String(entry))).find(entry=>entry.event==="dream_fact_check");
    expect(event).toMatchObject({outcome:"adjusted",durationMs:33_379,repairSkipped:null,
      issues:[{field:"facts",index:1,reason:"quote_format",action:"normalized"}]});
  });
  it("does not save a reading or create entitlements if core facts fail both attempts",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const repository=new TestRepository();
    const saveReading=vi.spyOn(repository,"saveReading");
    const saveEntitlement=vi.spyOn(repository,"saveEntitlement");
    vi.mocked(generateWithLocalCodex).mockResolvedValue({
      disposition:"READY_DREAM",facts:["직장 상사와 말다툼했어요"],keyElements:[{label:"공원",evidence:"공원"}],
      supportedTopics:[],sequenceConfirmed:false,unresolved:[],ready:true,question:null
    });
    await expect(createReading({dream:"오랜 동료와 공원을 걸었어요. 헤어질 때는 아쉬웠어요.",emotion:null},"blocked-intake",repository)).rejects.toMatchObject({code:"FACT_CHECK_UNGROUNDED"});
    expect(saveReading).not.toHaveBeenCalled();
    expect(saveEntitlement).not.toHaveBeenCalled();
    expect(repository.orders.size).toBe(0);
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(2);
  });
  it("stops after two reviewer rejections without an identity-gate recovery",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const rejected={...accepted,approved:false,unsupportedSequenceOrRole:true,revisionTargets:["section:0" as const],feedback:"행동 주체를 원문과 다르게 재구성했음"};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(report).mockResolvedValueOnce(rejected)
      .mockResolvedValueOnce(report).mockResolvedValueOnce(rejected);
    await expect(generateDetailedAssistant(analyzeDreamContextLocally(DETAILED_DREAM,null).context,"rejected","none",DETAILED_DREAM)).rejects.toThrow("검수를 통과하지");
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(4);
    const revision=JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[2][0].inputJson);
    expect(revision.revisionRequest).toContain("행동 주체");
    expect(revision.previousReport.directAnswer).toBe(report.directAnswer);
  });
  it("merges only reviewer-targeted fields from a paid revision draft", async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const offer=buildConsultationOffer(context);
    const first={...report,sections:report.sections.map((section,index)=>({...section,title:offer.cards[index]!.title}))};
    const normalizedFirstSections=first.sections.map((section,index)=>({...section,title:offer.cards[index]!.promisedSectionTitle}));
    const rejected={...accepted,approved:false,missingElements:["통합 해석의 인물 행동 연결을 구체화해야 해요."],revisionTargets:["section:0" as const]};
    const revisedSection={title:offer.cards[0]!.title,paragraphs:["첫 카드의 행동 연결은 확인된 장면의 순서에 기대어 구체적으로 설명해요. 근거 없는 감정이나 인물 관계는 덧붙이지 않고, 확인된 변화와 행동이 이 읽기를 어떻게 뒷받침하는지 이어서 정리해요."]};
    const driftingDraft={...first,directAnswer:"다른 답변으로 바꾸면 안 돼요.",directAnswerTitle:"바뀌면 안 되는 제목",sections:[revisedSection,{...first.sections[1]!,paragraphs:["두 번째 카드는 바꾸면 안 되는 내용을 담고 있어요."]},...first.sections.slice(2)],suggestedQuestions:["바뀌면 안 되는 질문이에요?"],evidenceQuotes:["바뀌면 안 되는 인용"]};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(first).mockResolvedValueOnce(rejected)
      .mockResolvedValueOnce(driftingDraft).mockResolvedValueOnce(accepted);

    const generated=await generateDetailedAssistant(context,"targeted-review-merge","none",DETAILED_DREAM);
    expect(generated.directAnswer).toBe(first.directAnswer);
    expect(generated.directAnswerTitle).toBe(first.directAnswerTitle);
    expect(generated.sections[0].title).toBe(normalizedFirstSections[0]!.title);
    expect(generated.sections[0].paragraphs).toEqual(revisedSection.paragraphs);
    expect(generated.sections[1]).toEqual(normalizedFirstSections[1]);
    expect(generated.suggestedQuestions).toEqual(first.suggestedQuestions);
    expect(generated.evidenceQuotes).toEqual(first.evidenceQuotes);
    const secondDraftInput=JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[2]![0].inputJson);
    expect(secondDraftInput.revisionTargets).toEqual(["section:0"]);
    expect(secondDraftInput.previousReport.directAnswer).toBe(first.directAnswer);
  });
  it.each([true, false])("repairs newly identified fields within the third-attempt boundary (final approved=%s)", async finalApproved => {
    vi.stubEnv("APP_PROFILE", "local-ai");
    const context = analyzeDreamContextLocally(DETAILED_DREAM, null).context;
    const firstReview = { ...accepted, approved: false, missingElements: ["계기와 행동의 연결을 보완하세요."], revisionTargets: ["section:2" as const] };
    const repairedExamples = { ...report.sections[2], paragraphs: [
      "최근 낯선 일을 앞두고 있었다면, 뱀을 바라보고 직접 문을 열어 내보낸 행동과 연결해볼 수 있어요. 그 일을 실제로 겪었다는 뜻으로 정하지 않고 가능한 계기로 살펴보는 설명이에요.",
      "최근 뱀이 나오는 이야기를 접했다면, 그 대상의 기억이 꿈속에서 바라보고 내보내는 행동과 이어졌을 가능성을 살펴볼 수 있어요. 꿈에 적힌 선택과 마지막의 편안함을 함께 보는 것이 해석의 근거예요."
    ] };
    const secondDraft = { ...report, sections: report.sections.map((section, index) => index === 2 ? repairedExamples : section) };
    const secondReview = { ...accepted, approved: false, inventedFacts: ["section:1의 확인하지 않은 마음을 실제 사실로 단정한 구절을 수정하세요."], revisionTargets: ["section:1" as const] };
    const repairedMind = { ...report.sections[1], paragraphs: ["처음 무서웠지만 직접 문을 열어 뱀을 내보내고 편안해졌다는 사실을 중심으로 읽어요. 그래서 불편한 대상을 무작정 피하는 마음보다 스스로 거리를 정하고 싶은 마음을 살펴볼 수 있어요."] };
    const thirdDraft = { ...secondDraft, directAnswer: "지정되지 않은 첫 답은 교체하지 않아야 해요.", sections: secondDraft.sections.map((section, index) => index === 1 ? repairedMind : section) };
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(report).mockResolvedValueOnce(firstReview)
      .mockResolvedValueOnce(secondDraft).mockResolvedValueOnce(secondReview)
      .mockResolvedValueOnce(thirdDraft).mockResolvedValueOnce(finalApproved ? accepted : secondReview);
    const generated = generateDetailedAssistant(context, "new-review-target-recovery", "none", DETAILED_DREAM);
    if (finalApproved) {
      const result = await generated;
      expect(result.directAnswer).toBe(report.directAnswer);
      expect(result.sections[1]).toEqual(repairedMind);
      expect(result.sections[2]).toEqual(repairedExamples);
      expect(result.sections[3]).toEqual(report.sections[3]);
    } else {
      await expect(generated).rejects.toThrow("검수를 통과하지");
    }
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(6);
    const secondReviewInput = JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[3][0].inputJson);
    expect(secondReviewInput.reviewContext.previousReview.decision).toEqual(firstReview);
    expect(secondReviewInput.reviewContext.previousReview.changedTargets).toEqual(["section:2"]);
    expect(secondReviewInput.reviewContext.previousReview.unchangedTargets).toContain("section:1");
    const lastRevision = JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[4][0].inputJson);
    expect(lastRevision.revisionTargets).toEqual(["section:1"]);
    expect(lastRevision.previousReport.sections[2]).toEqual(repairedExamples);
  });
  it("does not trigger a full paid rewrite when a failed review has no valid correction target", async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const offer=buildConsultationOffer(analyzeDreamContextLocally(DETAILED_DREAM,null).context);
    const overlong={...report,directAnswer:report.directAnswer+" 세 번째 문장이에요."};
    const unlocalized={...accepted,approved:false,missingElements:["의미 검수 결과를 특정 필드에 연결할 수 없어요."],revisionTargets:[]};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(overlong).mockResolvedValueOnce(unlocalized);
    await expect(generateDetailedAssistant(analyzeDreamContextLocally(DETAILED_DREAM,null).context,"untargeted-review","none",DETAILED_DREAM)).rejects.toThrow("검수를 통과하지");
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(2);
  });
  it("keeps three-sentence answers and multi-paragraph sections without a rewrite",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const expanded={...report,directAnswer:report.directAnswer+" 이 변화는 실제 행동과 함께 살펴볼 수 있어요.",sections:report.sections.map(section=>({...section,paragraphs:[...section.paragraphs,"같은 대상도 직접 다가가거나 거리를 두는 행동에 따라 읽는 이유가 달라져요."]}))};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(expanded).mockResolvedValueOnce(accepted);
    const result=await generateDetailedAssistant(context,"expanded-format","none",DETAILED_DREAM);
    expect(result.sections).toEqual(expanded.sections);
    expect(result.directAnswer).toBe(expanded.directAnswer);
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(2);
  });
  it("collects all format violations for a targeted rewrite when reflow alone cannot fix the answer",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const extra=" 세 번째 설명이에요. 네 번째 설명이에요. 다섯 번째 설명이에요.";
    const malformed={...report,directAnswer:report.directAnswer+" 세 번째 설명이에요. 네 번째 설명이에요.",sections:report.sections.map((section,index)=>index<2?{...section,paragraphs:[section.paragraphs.join(" ")+extra]}:section)};
    const rejected={...accepted,approved:false,missingElements:["directAnswer 문장 수 초과"],revisionTargets:["directAnswer" as const]};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(malformed).mockResolvedValueOnce(rejected).mockResolvedValueOnce(report).mockResolvedValueOnce(accepted);
    const result=await generateDetailedAssistant(context,"all-format-targets","none",DETAILED_DREAM);
    expect(result.sections).toEqual(report.sections);
    const input=JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[2]![0].inputJson);
    expect(input.revisionTargets).toEqual(["directAnswer","section:0","section:1"]);
    expect(vi.mocked(generateWithLocalCodex).mock.calls[2]![0].schemaName).toBe("dream_detailed_answer");
  });
  const extraParagraph="세 번째 설명이에요. 네 번째 설명이에요. 다섯 번째 설명이에요.";
  const malformedSection=()=>({...report,sections:report.sections.map((section,index)=>index===3?{...section,paragraphs:[section.paragraphs.join(" ")+" "+extraParagraph]}:section)});
  const reflowedSection=()=>report.sections[3]!.paragraphs.join(" ")+"\n\n"+extraParagraph;
  it.each([false,true])("repairs only paragraph breaks without dropping explanations (reviewer rejects format=%s)",async rejectsFormat=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const malformed=malformedSection();
    const review=rejectsFormat?{...accepted,approved:false,missingElements:["section:3에 문장 5개가 있어 허용 범위를 초과합니다."],revisionTargets:["section:3" as const]}:accepted;
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(malformed).mockResolvedValueOnce(review).mockResolvedValueOnce({replacement:reflowedSection()}).mockResolvedValueOnce(accepted);
    const result=await generateDetailedAssistant(context,"lossless-fourth-section","none",DETAILED_DREAM);
    expect(result.sections[3]!.paragraphs).toEqual([report.sections[3]!.paragraphs.join(" "),extraParagraph]);
    expect(result.sections.slice(0,3)).toEqual(report.sections.slice(0,3));
    expect(result.directAnswer).toBe(report.directAnswer);
    expect(vi.mocked(generateWithLocalCodex).mock.calls.map(([r])=>r.schemaName)).toEqual(["dream_detailed_answer","dream_report_review","dream_paid_format_revision","dream_report_review"]);
  });
  it.each(["truncated","rewritten","unchanged","provider","semantic"])("does not publish a failed format repair or retry beyond its boundary: %s",async mode=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const malformed=malformedSection();
    const mock=vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(malformed).mockResolvedValueOnce(accepted);
    if(mode==="provider") mock.mockRejectedValueOnce(new Error("TEST_FORMAT_PROVIDER_FAILURE"));
    else mock.mockResolvedValueOnce({replacement:mode==="truncated"?report.sections[3]!.paragraphs[0]:mode==="rewritten"?reflowedSection()+" 새 내용을 추가했어요.":mode==="unchanged"?malformed.sections[3]!.paragraphs[0]:reflowedSection()});
    if(mode==="semantic") mock.mockResolvedValueOnce({...accepted,approved:false,inventedFacts:["근거 없는 실제 사건"],revisionTargets:["section:3" as const]});
    await expect(generateDetailedAssistant(context,"format-failure-boundary","none",DETAILED_DREAM)).rejects.toThrow("검수를 통과하지");
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(mode==="semantic"?4:3);
  });
  it("does not confuse mixed semantic feedback with a format-only rejection",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const review={...accepted,approved:false,missingElements:["section:3에 문장 5개가 있어 허용 범위를 초과하고, 행동의 지속 여부가 빠졌어요."],revisionTargets:["section:3" as const]};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(malformedSection()).mockResolvedValueOnce(review).mockResolvedValueOnce(report).mockResolvedValueOnce(accepted);
    await expect(generateDetailedAssistant(context,"mixed-format-meaning","none",DETAILED_DREAM)).resolves.toMatchObject({sections:report.sections});
    expect(vi.mocked(generateWithLocalCodex).mock.calls[2]![0].schemaName).toBe("dream_detailed_answer");
  });
  it("allows one lossless final reflow after a targeted content correction",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const review={...accepted,approved:false,missingElements:["구별 조건 설명이 필요해요."],revisionTargets:["section:3" as const]};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(report).mockResolvedValueOnce(review).mockResolvedValueOnce(malformedSection()).mockResolvedValueOnce(accepted).mockResolvedValueOnce({replacement:reflowedSection()}).mockResolvedValueOnce(accepted);
    const result=await generateDetailedAssistant(context,"final-reflow","none",DETAILED_DREAM);
    expect(result.sections[3]!.paragraphs.join(" ")).toBe(malformedSection().sections[3]!.paragraphs.join(" "));
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(6);
  });
  it("stops after a targeted correction still has multiple malformed fields",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const malformed={...malformedSection(),directAnswer:report.directAnswer+" 세 번째 설명이에요. 네 번째 설명이에요."};
    const review={...accepted,approved:false,missingElements:["두 필드의 설명 수정"],revisionTargets:["directAnswer" as const,"section:3" as const]};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(report).mockResolvedValueOnce(review).mockResolvedValueOnce(malformed).mockResolvedValueOnce(accepted);
    await expect(generateDetailedAssistant(context,"multiple-final-fields","none",DETAILED_DREAM)).rejects.toThrow("검수를 통과하지");
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(4);
  });
  it("enforces paragraph and field maximums while preserving all words",()=> {
    const offer=buildConsultationOffer(analyzeDreamContextLocally(DETAILED_DREAM,null).context);
    const paragraph="가".repeat(699)+".";
    const sections=report.sections.map((section,index)=>index===3?{...section,paragraphs:Array(4).fill(paragraph)}:section);
    const maximum=sections[3]!.paragraphs.join("\n\n");
    expect(maximum.length).toBe(paidFormatRevisionMaxLength("section:3"));
    expect(applyPaidFormatRevision({...report,sections},"section:3",maximum,offer)?.sections[3]!.paragraphs).toEqual(sections[3]!.paragraphs);
    expect(applyPaidFormatRevision({...report,sections},"section:3",maximum+"가",offer)).toBeNull();
    expect(applyPaidFormatRevision({...report,directAnswer:paragraph},"directAnswer",paragraph,offer)?.directAnswer).toBe(paragraph);
    expect(applyPaidFormatRevision({...report,directAnswer:paragraph+"가"},"directAnswer",paragraph+"가",offer)).toBeNull();
    expect(applyPaidFormatRevision(report,"section:3",report.sections[3]!.paragraphs[0]!.split(". ")[0]+".",offer)).toBeNull();
    expect(paidFormatRevisionMaxLength("section:4")).toBe(0);
  });
  it.each([
    ["“이렇게 볼 수 있어요.” 이어서 다른 설명을 살펴봐요.","마지막 문장도 보존해요."],
    ["첫 설명이에요.2가지 의미를 함께 살펴봐요.","마지막 문장도 보존해요."],
    ["첫 설명이에요.다음 설명도 이어져요.","마지막 문장도 보존해요."],
    ["첫 설명이에요. 다른 설명도 이어져요.","마지막 문장은 마침표가 없어도 포함해요"]
  ])("reflows sentence boundaries without cutting quotes, digits or unpunctuated endings: %s",async(middle,last)=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const first="처음 설명이에요. 다음 설명이에요.";
    const paragraphs=[first,middle+" "+last];
    const malformed={...report,sections:report.sections.map((section,index)=>index===3?{...section,paragraphs:[paragraphs.join(" ")]}:section)};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(malformed).mockResolvedValueOnce(accepted).mockResolvedValueOnce({replacement:paragraphs.join("\n\n")}).mockResolvedValueOnce(accepted);
    const result=await generateDetailedAssistant(context,"sentence-boundaries","none",DETAILED_DREAM);
    expect(result.sections[3]!.paragraphs).toEqual(paragraphs);
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(4);
  });
  it.each(["하고 떠올린 질문과","하는 생각과","싶은 마음과","라던 생각과"])("keeps embedded quoted questions inside their sentence: %s",async continuation=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const directAnswer=`${report.directAnswer} “어떻게 볼까요?”${continuation} 함께 읽어볼 수 있어요.`;
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce({...report,directAnswer}).mockResolvedValueOnce(accepted);
    const result=await generateDetailedAssistant(context,"embedded-question","none",DETAILED_DREAM);
    expect(result.directAnswer).toBe(directAnswer);
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(2);
    expect(applyPaidFormatRevision(result,"directAnswer",directAnswer.slice(0,directAnswer.indexOf("?”")+2),buildConsultationOffer(context))).toBeNull();
  });
  it("normalizes blank-line-separated direct answers without deleting sentences",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const malformed={...report,directAnswer:report.directAnswer.replace(". 마지막",".\n\n마지막")};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(malformed).mockResolvedValueOnce(accepted).mockResolvedValueOnce({replacement:report.directAnswer}).mockResolvedValueOnce(accepted);
    await expect(generateDetailedAssistant(context,"direct-paragraph-normalization","none",DETAILED_DREAM)).resolves.toMatchObject({directAnswer:report.directAnswer});
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(4);
  });
  it("allows an exact source confirmation without inventing a newly learned fact",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(report).mockResolvedValueOnce(accepted);
    const result=await generateDetailedAssistant(context,"repeated-confirmation","none",DETAILED_DREAM,{
      selectedEmotion:null,clarificationAnswers:[{questionId:"confirm-existing",kind:"scene",answer:"검은  뱀이 우리 집 창문으로 천천히 들어왔어요",skipped:false}]
    });
    expect(result.interpretationChanges).toBeNull();
    expect(vi.mocked(generateWithLocalCodex).mock.calls.map(([request])=>request.schemaName)).toEqual(["dream_detailed_answer","dream_report_review"]);
  });
  it("still requires a change explanation for genuinely added evidence",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    vi.mocked(generateWithLocalCodex).mockResolvedValue(report);
    await expect(generateDetailedAssistant(analyzeDreamContextLocally(DETAILED_DREAM,null).context,"new-evidence-change","none",DETAILED_DREAM,{
      selectedEmotion:null,clarificationAnswers:[{questionId:"new-detail",kind:"scene",answer:"뱀이 나간 뒤 다시 돌아왔어요.",skipped:false}]
    })).rejects.toThrow("검수를 통과하지");
    expect(vi.mocked(generateWithLocalCodex).mock.calls.map(([request])=>request.schemaName)).toEqual(["dream_detailed_answer","dream_detailed_answer"]);
  });
  it("keeps semantic review authoritative when repeated words still need a correction explanation",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const rejected={...accepted,approved:false,correctionApplied:false,missingElements:["확인 답변이 바꾼 주체를 설명해야 해요."],revisionTargets:["interpretationChanges" as const]};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(report).mockResolvedValueOnce(rejected).mockResolvedValueOnce(report).mockResolvedValueOnce(rejected);
    await expect(generateDetailedAssistant(analyzeDreamContextLocally(DETAILED_DREAM,null).context,"repeated-word-role-review","none",DETAILED_DREAM,{
      selectedEmotion:null,clarificationAnswers:[{questionId:"confirm-role",kind:"scene",answer:"검은 뱀",skipped:false}]
    })).rejects.toThrow("검수를 통과하지");
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(4);
  });
  it.each([true,false])("reserves one targeted review repair after the missing-detail gate (final approved=%s)",async finalApproved=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const falseMissing={...report,directAnswer:report.directAnswer+" 꿈속에서 어떤 행동을 했는지는 알 수 없어요."};
    expect(detailedQualityError(falseMissing,buildConsultationOffer(context),DETAILED_DREAM,context)).toBe("AI_DETAILED_FALSE_MISSING_DETAIL");
    const rejected={...accepted,approved:false,missingElements:["풀이를 구별하는 이유가 부족해요."],revisionTargets:["section:3" as const],feedback:"마지막 섹션에 확인된 단서와 구별 조건을 연결해 주세요."};
    const revisedLast={...report.sections[3],paragraphs:["처음의 두려움보다 마지막의 편안함에 무게를 둔 이유는, 직접 문을 열어 뱀을 내보낸 행동이 그 사이에 있기 때문이에요. 그래서 두려움이 남은 꿈이라는 설명보다 낯선 대상을 스스로 다룬 경험이라는 읽기가 확인된 결말에 더 잘 맞아요."]};
    const drifting={...report,directAnswer:"지정되지 않은 이 답은 결과에 반영되면 안 돼요.",sections:[...report.sections.slice(0,3),revisedLast]};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(falseMissing)
      .mockResolvedValueOnce(report).mockResolvedValueOnce(rejected)
      .mockResolvedValueOnce(drifting).mockResolvedValueOnce(finalApproved?accepted:rejected);
    const generated=generateDetailedAssistant(context,"missing-detail-review-repair","none",DETAILED_DREAM);
    if(finalApproved) {
      const result=await generated;
      expect(result.directAnswer).toBe(report.directAnswer);
      expect(result.sections.slice(0,3)).toEqual(report.sections.slice(0,3));
      expect(result.sections[3]).toEqual(revisedLast);
    } else {
      await expect(generated).rejects.toThrow("검수를 통과하지");
    }
    expect(vi.mocked(generateWithLocalCodex).mock.calls.map(([request])=>request.schemaName)).toEqual([
      "dream_detailed_answer","dream_detailed_answer","dream_report_review","dream_detailed_answer","dream_report_review"
    ]);
    const correction=JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[3][0].inputJson);
    expect(correction.revisionTargets).toEqual(["section:3"]);
    expect(correction.previousReport.directAnswer).toBe(report.directAnswer);
  });
  it("allows one final reviewer correction when an unsupported identity gate consumed the first paid attempt",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const offer=buildConsultationOffer(context);
    const invalidIdentity={...report,directAnswer:report.directAnswer+" 아내가 곁에 있었어요."};
    expect(detailedQualityError(invalidIdentity,offer,DETAILED_DREAM,context)).toBe("AI_DETAILED_UNSUPPORTED_IDENTITY");
    const rejected={...accepted,approved:false,unsupportedSequenceOrRole:true,revisionTargets:["section:0" as const],feedback:"행동 주체를 원문 근거와 대조해 수정했음"};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(invalidIdentity).mockResolvedValueOnce(report).mockResolvedValueOnce(rejected).mockResolvedValueOnce(report).mockResolvedValueOnce(accepted);

    const result=await generateDetailedAssistant(context,"identity-repair","none",DETAILED_DREAM);
    expect(result.generationSource).toBe("codex");
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(5);
    expect(vi.mocked(generateWithLocalCodex).mock.calls.map(([request])=>request.schemaName)).toEqual([
      "dream_detailed_answer","dream_detailed_answer","dream_report_review","dream_detailed_answer","dream_report_review"
    ]);
    const finalRevision=JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[3][0].inputJson);
    expect(finalRevision.revisionRequest).toContain("AI_DETAILED_REVIEW");
    expect(finalRevision.previousReport.directAnswer).toBe(report.directAnswer);
  });
  it("stops after the final identity-recovery draft is rejected by the reviewer",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const invalidIdentity={...report,directAnswer:report.directAnswer+" 아내가 곁에 있었어요."};
    const rejected={...accepted,approved:false,unsupportedSequenceOrRole:true,revisionTargets:["section:0" as const],feedback:"행동 주체를 다시 확인해야 해요."};
    vi.mocked(generateWithLocalCodex)
      .mockResolvedValueOnce(invalidIdentity)
      .mockResolvedValueOnce(report)
      .mockResolvedValueOnce(rejected)
      .mockResolvedValueOnce(report)
      .mockResolvedValueOnce(rejected);
    await expect(generateDetailedAssistant(context,"final-identity-rejection","none",DETAILED_DREAM)).rejects.toThrow("검수를 통과하지");
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(5);
    expect(vi.mocked(generateWithLocalCodex).mock.calls.map(([request])=>request.schemaName)).toEqual([
      "dream_detailed_answer","dream_detailed_answer","dream_report_review","dream_detailed_answer","dream_report_review"
    ]);
  });
  it("allows one final repair after two identical unsupported-identity gate failures",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const invalidIdentity={...report,directAnswer:report.directAnswer+" 아내가 곁에 있었어요."};
    vi.mocked(generateWithLocalCodex)
      .mockResolvedValueOnce(invalidIdentity)
      .mockResolvedValueOnce(invalidIdentity)
      .mockResolvedValueOnce(report)
      .mockResolvedValueOnce(accepted);
    const result=await generateDetailedAssistant(context,"repeated-identity-repaired","none",DETAILED_DREAM);
    expect(result.generationSource).toBe("codex");
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(4);
    expect(vi.mocked(generateWithLocalCodex).mock.calls.map(([request])=>request.schemaName)).toEqual([
      "dream_detailed_answer","dream_detailed_answer","dream_detailed_answer","dream_report_review"
    ]);
    const lastRepair=JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[2][0].inputJson);
    expect(lastRepair.revisionRequest).toBe("AI_DETAILED_UNSUPPORTED_IDENTITY");
    expect(lastRepair.previousReport.directAnswer).toBe(invalidIdentity.directAnswer);
  });
  it("keeps identity recovery narrow and never retries a provider failure",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const offer=buildConsultationOffer(context);
    const invalidIdentity={...report,directAnswer:report.directAnswer+" 아내가 곁에 있었어요."};
    const unsupportedScene={...report,directAnswer:report.directAnswer+" 비가 내렸어요."};
    expect(detailedQualityError(unsupportedScene,offer,DETAILED_DREAM,context)).toBe("AI_DETAILED_UNGROUNDED_SCENE");
    const rejected={...accepted,approved:false,unsupportedSequenceOrRole:true,revisionTargets:["section:0" as const],feedback:"행동 주체를 다시 확인해야 해요."};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(unsupportedScene)
      .mockResolvedValueOnce(report).mockResolvedValueOnce(rejected);
    await expect(generateDetailedAssistant(context,"mixed-quality-gates","none",DETAILED_DREAM)).rejects.toThrow("검수를 통과하지");
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(3);

    vi.mocked(generateWithLocalCodex).mockReset();
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(report).mockResolvedValueOnce(rejected)
      .mockRejectedValueOnce(new Error("AI_PROVIDER_TIMEOUT"));
    await expect(generateDetailedAssistant(context,"provider-failure-after-review","none",DETAILED_DREAM)).rejects.toThrow("검수를 통과하지");
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(3);

    vi.mocked(generateWithLocalCodex).mockReset();
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(invalidIdentity).mockResolvedValueOnce(invalidIdentity).mockResolvedValueOnce(invalidIdentity);
    await expect(generateDetailedAssistant(context,"repeated-identity-gate","none",DETAILED_DREAM)).rejects.toThrow("검수를 통과하지");
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(3);
  });
  it("stops after two consecutive reviewer rejections for a repetitive report",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const repeated={...accepted,approved:false,redundantInterpretation:true,revisionTargets:["section:0" as const],feedback:"중심 해석을 섹션에서 다시 말했음"};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(report).mockResolvedValueOnce(repeated)
      .mockResolvedValueOnce(report).mockResolvedValueOnce(repeated);
    await expect(generateDetailedAssistant(analyzeDreamContextLocally(DETAILED_DREAM,null).context,"repeated","none",DETAILED_DREAM)).rejects.toThrow("검수를 통과하지");
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(4);
  });
  it("only returns a paid report after source and independent review checks",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const context=analyzeDreamContextLocally(DETAILED_DREAM,null).context;
    const offer=buildConsultationOffer(context);
    const contaminated={...report,sections:report.sections.map((section,index)=>({...section,title:offer.cards[index].title})),interpretationChanges:{newlyLearned:"검수 의견에서 누락을 지적했어요.",revisedInterpretation:"검수 의견에 따라 풀이를 다시 작성했어요."}};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(contaminated).mockResolvedValueOnce(accepted);
    expect(detailedQualityError(report,offer,DETAILED_DREAM,context)).toBeNull();
    const generated=await generateDetailedAssistant(context,"accepted","none",DETAILED_DREAM);
    expect(generated.generationSource).toBe("codex");
    expect(generated.interpretationChanges).toBeNull();
    expect(generated.sections.map(section=>section.title)).toEqual(offer.cards.map(card=>card.promisedSectionTitle));
    expect(vi.mocked(generateWithLocalCodex).mock.calls[1][0].schemaName).toBe("dream_report_review");
    const writerInput=JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[0][0].inputJson);
    const reviewerInput=JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[1][0].inputJson);
    expect(writerInput.paidOffer.cards.map((card:{key:string})=>card.key)).toEqual(["traditional","psychology","pattern","action"]);
    expect(reviewerInput.paidOffer.cards.map((card:{key:string})=>card.key)).toEqual(["traditional","psychology","pattern","action"]);
    expect(reviewerInput.paidOffer.cards.map((card:{title:string})=>card.title)).toEqual(offer.cards.map(card=>card.title));
  });
  it("carries fact-checked waking evidence separately through paid writing and review",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    const realityEvidence="여자친구가 곁에서 함께 자고 있었다고 했어요";
    const dream=`${DETAILED_DREAM} ${realityEvidence}`;
    const context=analyzeDreamContextLocally(dream,null).context;
    const basePlan=buildConsultationPlan(context);
    const consultation={...basePlan,sectionTopics:[...basePlan.sectionTopics,"reality" as const],supportedTopics:[{topic:"reality",evidence:realityEvidence}]};
    context.consultation=consultation;
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(reportWithReality).mockResolvedValueOnce(acceptedWithReality);
    await generateDetailedAssistant(context,"reality-evidence", "none", dream, undefined, undefined, report);
    const draftInput=JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[0][0].inputJson);
    const reviewInput=JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[1][0].inputJson);
    for (const input of [draftInput,reviewInput]) {
      expect(input.readingContext.evidence.realityTexts).toContain(realityEvidence);
      expect(input.readingContext.evidence.dreamText).not.toContain(realityEvidence);
    }
    expect(draftInput.dreamContext.realityContexts).toContain(realityEvidence);
    expect(draftInput.paidOffer.cards).toHaveLength(4);
    expect(draftInput.paidOffer.cards.map((card:{key:string})=>card.key)).toEqual(["traditional","psychology","pattern","action"]);
    expect(reviewInput.paidOffer.cards).toHaveLength(4);
    expect(reviewInput.paidOffer.cards.map((card:{key:string})=>card.key)).toEqual(["traditional","psychology","pattern","action"]);
  });
  it("blocks unsupported place sections and fabricated source quotes",()=> {
    const dream="처음에는 무서워서 도망쳤고, 나중에는 내가 쫓아오던 사람을 때렸어. 피는 그 사람에게 났고, 끝에는 후련했어.";
    const context=analyzeDreamContextLocally(dream,null).context;
    const withQuote={...report,evidenceQuotes:["처음에는 무서워서 도망쳤고"]};
    expect(detailedQualityError({...withQuote,sections:[{title:"통합 해석",paragraphs:["이 꿈은 확인된 사실을 중심으로 읽을 수 있어요."]},{title:"공간과 분위기",paragraphs:["이 공간은 안전감을 상징해요."]}]},buildConsultationOffer(context),dream,context)).toBe("AI_DETAILED_MISSING_SECTION");
    expect(detailedQualityError(report,buildConsultationOffer(context),dream,context)).toBe("AI_DETAILED_UNGROUNDED_QUOTE");
  });
  it("leaves a failed paid generation retryable without publishing a completed generic report",async()=> {
    vi.stubEnv("APP_PROFILE","");vi.stubEnv("AI_MODE","local");vi.stubEnv("PAYMENTS_MODE","mock");
    const repository=new TestRepository();
    const reading=await createReading({dream:DETAILED_DREAM,emotion:null},"failed-paid",repository);
    const order=await createOrder(reading,"full_reading","failed-paid",repository);
    vi.stubEnv("APP_PROFILE","local-ai");
    vi.mocked(generateWithLocalCodex).mockRejectedValue(new Error("provider failed"));
    const failed=await confirmPayment({paymentKey:"mock_failed_paid",orderId:order.id,amount:990},"failed-paid",repository);
    const view=await getPublicReading(failed,"https://dream.test",repository);
    expect(view.detailGenerationStatus).toBe("failed");
    expect(view.timeline.filter(turn=>turn.kind==="detailed")).toEqual([]);
    expect(view.canRetryDetailedReading).toBe(true);
    expect(view.entitlement.remainingQuestions).toBe(2);
  });
});
