import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeConsultationPlan, buildConsultationPlan, classifyUserMessage, reportCopyError, unresolvedActionRole } from "@/lib/consultation";
import { analyzeDreamContextLocally } from "@/lib/local-engine";
import { createOrder, confirmPayment } from "@/lib/payments";
import { addConversationMessage, createReading, getPublicReading, readingContext, readingDetailGuidance, supplementFreeReading } from "@/lib/readings";
import { decryptJson } from "@/lib/crypto";
import type { AssistantTurnPayload, ClarificationAnswer } from "@/lib/types";
import { DETAILED_DREAM, TestRepository } from "./helpers/repository";

const AMBIGUOUS = "누가 쫒아오고 막 때리고 피나오고 그런꿈";
const CONFIRMED = "처음에는 무서워서 도망쳤고, 나중에는 내가 쫓아오던 사람을 때렸어. 피는 그 사람에게 났고, 끝에는 후련했어.";
beforeEach(()=> {vi.stubEnv("APP_PROFILE","");vi.stubEnv("AI_MODE","local");vi.stubEnv("PAYMENTS_MODE","mock");});
afterEach(()=>vi.unstubAllEnvs());

async function paidFixture() {
  const repository = new TestRepository();
  const reading = await createReading({dream:DETAILED_DREAM,emotion:null},"consultation-test",repository);
  const order = await createOrder(reading,"full_reading","consultation-test",repository);
  const paid = await confirmPayment({paymentKey:`mock_${order.id}`,orderId:order.id,amount:990},"consultation-test",repository);
  return {repository,paid};
}

describe("fact-first consultation",()=> {
  it("does not create a real payment order when only the mock report generator is configured",async()=> {
    const repository=new TestRepository();
    const reading=await createReading({dream:DETAILED_DREAM,emotion:null},"no-live-generator",repository);
    vi.stubEnv("PAYMENTS_MODE","toss");
    await expect(createOrder(reading,"full_reading","no-live-generator",repository)).rejects.toMatchObject({code:"DETAILED_SERVICE_UNAVAILABLE"});
    expect(repository.orders.size).toBe(0);
  });
  it("preserves chase, violence and blood without making up roles or sequence, and blocks payment",async()=> {
    const repository = new TestRepository();
    const reading = await createReading({dream:AMBIGUOUS,emotion:null},"ambiguous",repository);
    const view = await getPublicReading(reading,"https://dream.test",repository);
    const plan = activeConsultationPlan(readingContext(reading));
    expect(plan.keyElements.map(item=>item.label)).toEqual(["쫓아오는 장면","때리거나 맞는 장면","피가 나는 장면"]);
    expect(plan.sequenceConfirmed).toBe(false);
    expect(view.freeDetailGuidance?.question).toBe("때리는 장면에서 어떤 상황이었나요?");
    expect(view.freeDetailGuidance?.options).toHaveLength(5);
    expect(view.paidOffer).toBeNull();
    expect(view.canPurchaseFullReading).toBe(false);
    const free = view.timeline.find(turn=>turn.kind==="free")?.content as AssistantTurnPayload;
    expect(free.directAnswer).toMatch(/쫓아오는.+때리거나 맞는.+피가 나는/);
    expect(free.directAnswer).not.toMatch(/내 대응|맞섰|뜻을.*전하고|→|때림.*피가 남/);
    await expect(createOrder(reading,"full_reading","ambiguous",repository)).rejects.toMatchObject({code:"MORE_DREAM_DETAIL_REQUIRED"});
  });

  it.each(["누가 쫓아오고 때리고 피가 났어요", "어떤 사람이 쫓아오고 때리고 피가 났어요", "내가 도망쳤는데 때리는 장면이 나왔어요"])("does not borrow an actor from a different action: %s", dream=>expect(unresolvedActionRole(dream)).toBe(true));
  it.each(["내가 그 사람을 때렸어요", "그 사람이 나를 때렸어요", "내가 맞았어요", "다른 사람들이 싸웠어요"])("recognizes explicit action roles: %s", dream=>expect(unresolvedActionRole(dream)).toBe(false));

  it("treats forgotten detail as final for this attempt, without a repeated question or checkout",async()=> {
    const repository = new TestRepository();
    const first = await createReading({dream:AMBIGUOUS,emotion:null},"forgot",repository);
    const updated = await supplementFreeReading(first,"기억나지 않아요",repository,undefined,"confirm-action-role");
    const reloaded = (await repository.getReading(updated.id))!;
    const view = await getPublicReading(reloaded,"https://dream.test",repository);
    expect(view.freeDetailGuidance).toMatchObject({ready:false,limited:true});
    expect(view.freeDetailGuidance?.questionId).toBeUndefined();
    expect(view.canPurchaseFullReading).toBe(false);
    expect(view.timeline.some(turn=>"text" in turn.content && turn.content.text==="기억나지 않아요")).toBe(true);
    expect(readingContext(reloaded).dreamEvidence).not.toContain("기억나지");
  });

  it("lets a substantive answer unlock a report, retaining the original and showing the added evidence",async()=> {
    const repository = new TestRepository();
    const first = await createReading({dream:AMBIGUOUS,emotion:null},"confirmed",repository);
    const updated = await supplementFreeReading(first,CONFIRMED,repository,undefined,"confirm-action-role");
    expect(readingDetailGuidance(updated).ready).toBe(true);
    expect(updated.safetyRoute).not.toBe("third_party");
    const context = readingContext(updated);
    expect(context.dreamEvidence).toContain("쫒아오고");
    expect(context.dreamEvidence).toContain("후련했어");
    const order = await createOrder(updated,"full_reading","confirmed",repository);
    const paid = await confirmPayment({paymentKey:"mock_confirmed",orderId:order.id,amount:990},"confirmed",repository);
    const view = await getPublicReading(paid,"https://dream.test",repository);
    const report = view.timeline.find(turn=>turn.kind==="detailed")?.content as AssistantTurnPayload;
    expect(report.interpretationChanges?.newlyLearned).toContain("후련했어");
    expect(report.sections.some(section=>/공간|현실/.test(section.title))).toBe(false);
  });

  it("keeps new ending emotions in the literal evidence, not only in engine labels",async()=> {
    const repository = new TestRepository();
    const first = await createReading({dream:"뱀이 다가왔어요",emotion:null},"emotion",repository);
    const updated = await supplementFreeReading(first,"마지막에는 오히려 후련했어요",repository,undefined,readingDetailGuidance(first).questionId);
    expect(readingContext(updated).dreamEvidence).toContain("마지막에는 오히려 후련했어요");
    expect(readingDetailGuidance(updated).ready).toBe(true);
  });

  it("does not manufacture place or reality sections for an absent field",()=> {
    const plan = buildConsultationPlan(analyzeDreamContextLocally(CONFIRMED,null).context);
    expect(plan.sectionTopics).not.toContain("place");
    expect(plan.sectionTopics).not.toContain("reality");
  });
});

describe("completion vs. paid deepening",()=> {
  it.each(["그렇구나", "그렇궂나", "아하", "알겠어요", "고마워요!"])("stores %s as a reaction, not another scene",text=>expect(classifyUserMessage(text)).toBe("reaction"));
  it.each([["아니, 내가 맞은 거야","correction"],["장소는 학교였어","dream_fact"],["문장이 이상해요. 다시 써줘","repair"],["이 꿈을 다른 관점으로 풀어줘","question"]])("classifies %s as %s",(text,intent)=>expect(classifyUserMessage(text)).toBe(intent));
  it.each([["관계에 대한 꿈인지 봐줘","question"],["처음 해석과 달라진 점을 말해줘","question"],["마지막으로 기억할 한마디를 써줘","question"],["기차를 탔어","dream_fact"]])("does not mistake a request or a new statement: %s",(text,intent)=>expect(classifyUserMessage(text)).toBe(intent));

  it("accepts reactions and corrects a paid reading with zero credits, idempotently",async()=> {
    const {repository,paid} = await paidFixture();
    const entitlement = (await repository.getEntitlement(paid.id))!;
    entitlement.usedQuestions=2;
    await repository.saveEntitlement(entitlement);
    const before = readingContext(paid).dreamEvidence;
    const reacted = await addConversationMessage(paid,{clientMessageId:"reaction_123",message:"그렇궂나"},repository);
    expect(readingContext(reacted).dreamEvidence).toBe(before);
    expect(decryptJson<ClarificationAnswer[]>(reacted.encryptedClarificationAnswers,"clarifications",reacted.id)).toEqual([]);
    const fixed = await addConversationMessage(reacted,{clientMessageId:"correction_123",message:"장소는 학교였어"},repository);
    const duplicate = await addConversationMessage(fixed,{clientMessageId:"correction_123",message:"장소는 학교였어"},repository);
    expect(readingContext(fixed).dreamEvidence).toContain("학교였어");
    expect((await repository.getEntitlement(paid.id))?.usedQuestions).toBe(2);
    expect(decryptJson<ClarificationAnswer[]>(duplicate.encryptedClarificationAnswers,"clarifications",duplicate.id)).toHaveLength(1);
    expect((await repository.getConversationTurns(paid.id)).filter(turn=>turn.kind==="detailed")).toHaveLength(1);
    expect((await getPublicReading(fixed,"https://dream.test",repository)).canCorrectReading).toBe(true);
    await expect(addConversationMessage(fixed,{clientMessageId:"new_question_123",message:"다른 관점으로 풀어줘"},repository)).rejects.toMatchObject({code:"QUESTION_CREDITS_EXHAUSTED"});
  });

  it("keeps all known elements when the correction only changes a role", async()=> {
    const repository=new TestRepository();
    const first=await createReading({dream:AMBIGUOUS,emotion:null},"role-correction",repository);
    const fixed=await supplementFreeReading(first,"아니, 내가 맞은 거야",repository,undefined,"confirm-action-role");
    const evidence=readingContext(fixed).dreamEvidence!;
    expect(evidence).toContain("쫒아오고");
    expect(evidence).toContain("피나오고");
    expect(evidence).toContain("내가 맞은 거야");
    expect(readingDetailGuidance(fixed).questionId).not.toBe("confirm-action-role");
  });

  it.each(["가장 선명한 아직 구체적이지 않은 장면 장면", "꿈에서의 꿈에서 남은 느낌", "장소가 선명하지 않은 공간은 생활의 경계", "나이·성별·직업을 말하지 않았다면 그 정보는 채워 넣지 않습니다."])("rejects visible assembly errors: %s",text=> {
    expect(reportCopyError({directAnswer:text,sections:[],interpretationChanges:null,uncertainty:[],suggestedQuestions:[],shareableSentences:[],generationSource:"local"})).toBe("REPORT_INTERNAL_OR_PLACEHOLDER");
  });
});
