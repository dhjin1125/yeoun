import { describe, expect, it } from "vitest";
import { analyzeDreamContextLocally, applyClarificationsToContext, updateContextWithMessageLocally, buildFollowupAssistantPayload } from "@/lib/local-engine";
import { splitDreamEvidence, observedDreamText } from "@/lib/dream-evidence";
import { classifySafetyRoute } from "@/lib/safety";
import { symbolicOutputError } from "@/lib/symbolic-output";
import { generateFollowupAssistant } from "@/lib/ai";

describe("language and narrative refinements", () => {
  it.each([
    ["뱀이 나왔어요. 아니, 사실은 고양이였어요", "animal"],
    ["뱀이 나왔어요. 뱀이 아니라 고양이였어요", "animal"]
  ])("uses the correction rather than both versions: %s", (dream, key) => {
    expect(analyzeDreamContextLocally(dream,null).context.symbols.map(s=>s.key)).toEqual([key]);
  });
  it("keeps unrelated earlier scenes when correcting the latest one", () => {
    const context=analyzeDreamContextLocally("집에 있었어요. 뱀이 나왔어요. 아니 사실은 고양이였어요",null).context;
    expect(context.symbols.map(s=>s.key)).toEqual(["house","animal"]);
  });
  it("rebuilds previous facts when an additional answer corrects them", () => {
    const original=analyzeDreamContextLocally("뱀이 나왔어",null).context;
    const updated=applyClarificationsToContext(original,[{questionId:"correction",kind:"scene",answer:"정정할게요, 뱀이 아니라 고양이였어요",skipped:false}]);
    expect(updated.symbols.map(s=>s.key)).toEqual(["animal"]);
    expect(original.symbols.map(s=>s.key)).toEqual(["snake"]);
  });
  it("uses a follow-up correction without turning it into a real event", () => {
    const initial=analyzeDreamContextLocally("뱀이 나왔어요",null).context;
    const message="정정할게요, 뱀이 아니라 고양이였어요";
    const updated=updateContextWithMessageLocally(initial,message);
    expect(updated.symbols.map(s=>s.key)).toEqual(["animal"]);
    expect(updated.realityContexts).toEqual([]);
    expect(buildFollowupAssistantPayload(updated,message).interpretationChanges).not.toBeNull();
  });
  it("keeps a correction about reality outside the dreamed scene", () => {
    const original=analyzeDreamContextLocally("뱀이 나왔어요",null).context;
    const updated=updateContextWithMessageLocally(original,"현실에서는 친구가 아니라 동료가 다쳤어요");
    expect(updated.symbols).toEqual(original.symbols);
    expect(updated.scenes).toEqual(original.scenes);
    expect(updated.realityContexts.at(-1)).toContain("동료");
  });
  it("supports a correction on a saved context from before evidence tracking", async () => {
    const old=analyzeDreamContextLocally("뱀이 나왔어요",null).context;
    delete old.dreamEvidence;
    const updated=await generateFollowupAssistant(old,[],"정정할게요, 뱀이 아니라 고양이였어요","legacy-correction","뱀이 나왔어요");
    expect(updated.context.symbols.map(s=>s.key)).toEqual(["animal"]);
  });
  it.each([
    ["무섭지 않은 건 아니었어요",true], ["안 무서운 건 아니었어요",true],
    ["무섭지 않았어요",false], ["무서운 건 아니었어요",false]
  ])("respects the polarity of %s", (feeling, fear) => {
    expect(analyzeDreamContextLocally(`뱀이 나왔어요. ${feeling}`,null).context.emotions.includes("두려움")).toBe(fear);
  });
  it("does not extract quoted objects as observed objects or quoted settings as reality", () => {
    const source='친구가 "현실에서 뱀을 봤어"라고 말했어요. 고양이가 나타났어요';
    const evidence=splitDreamEvidence(source);
    expect(evidence.realityTexts).toEqual([]);
    expect(analyzeDreamContextLocally(source,null).context.symbols.map(s=>s.key)).toEqual(["animal"]);
    expect(observedDreamText(source)).not.toContain("뱀");
  });
  it("preserves quotation marks used only to emphasize an observed object", () => {
    expect(analyzeDreamContextLocally('꿈에서 "뱀"이 나타났어요',null).context.symbols.map(s=>s.key)).toEqual(["snake"]);
    expect(analyzeDreamContextLocally('"검은 뱀"이 눈앞에 있었어요',null).context.symbols.map(s=>s.key)).toEqual(["snake"]);
  });
  it.each([
    ['친구가 "나는 지금 죽고 싶어"라고 말했어요',"third_party"],
    ['나는 지금 "죽고 싶어"라는 생각이 들어요',"immediate_self"],
    ['책에서 "나는 지금 죽고 싶어"라는 문장을 읽었어요',"none"],
    ['꿈에서 친구가 "나는 죽고 싶어"라고 말했어요',"dream_only"]
  ])("keeps the speaker of a quoted statement: %s",(source, route)=>{
    expect(classifySafetyRoute(source)).toBe(route);
  });
  it("preserves turning points and the relieved ending of a long dream", () => {
    const source=["집에서 시작했어요",...Array.from({length:7},(_,i)=>`${i+1}번째 복도를 지나갔어요`),"그런데 알고 보니 다른 사람이었어요", "또 복도를 지나갔어요", "문을 열어 밖으로 나왔어요", "마지막에는 마음이 편안해졌어요"].join(". ");
    const {context}=analyzeDreamContextLocally(source,null);
    expect(context.scenes).toHaveLength(8);
    expect(context.scenes[0].place).toBe("집");
    expect(context.scenes.some(s=>s.action.includes("다른 사람임을 알아차림"))).toBe(true);
    expect(context.scenes.at(-1)?.emotion).toBe("안도감");
    expect(context.dreamEvidence).toContain("7번째 복도");
  });
  it("keeps the latest ending after many supplemental scenes", () => {
    const context=analyzeDreamContextLocally("뱀이 나와서 무서웠어요",null).context;
    const updated=applyClarificationsToContext(context,[{questionId:"ending",kind:"scene",answer:[...Array.from({length:10},()=>"복도를 지나갔어요"),"마지막에는 마음이 편안해졌어요"].join(". "),skipped:false}]);
    expect(updated.scenes).toHaveLength(8);
    expect(updated.scenes.at(-1)?.emotion).toBe("안도감");
  });
});

describe("specific symbolic prose", () => {
  const meaning={name:"뱀",evidence:"뱀이 나왔어요",title:"뱀의 상징",meaning:"뱀은 감정의 변화와 마음의 흐름을 나타낼 수 있어요. 관계의 경계와 상황의 변화를 보여줄 수 있어요."};
  it("rejects prose made only of generic abstractions",()=>{
    expect(symbolicOutputError([meaning],meaning.evidence)).toBe("AI_SYMBOL_ABSTRACT");
  });
  it("accepts a concrete feature connected to a symbolic meaning",()=>{
    expect(symbolicOutputError([{...meaning,meaning:"뱀은 허물을 벗는 모습 때문에 회복이나 새로운 시작의 상징으로 읽기도 해요. 길고 유연한 몸은 생명력을 떠올리게 해요."}],meaning.evidence)).toBeNull();
  });
  it("rejects repeating the same interpretation under another symbol",()=>{
    const first={...meaning,meaning:"뱀은 허물을 벗는 모습 때문에 회복이나 새로운 시작의 상징으로 읽기도 해요. 길고 유연한 몸은 생명력을 떠올리게 해요."};
    const second={...first,name:"고양이",evidence:"고양이도 나왔어요",title:"고양이의 상징",meaning:first.meaning.replaceAll("뱀","고양이")};
    expect(symbolicOutputError([first,second],`${first.evidence}. ${second.evidence}`)).toBe("AI_SYMBOL_REPETITIVE");
  });
});
