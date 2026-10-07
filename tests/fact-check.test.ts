import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkFactPlan, type FactCheckPlan } from "@/lib/ai/fact-check";
import { observedDreamText, splitDreamEvidence } from "@/lib/dream-evidence";

function plan(quote: string): FactCheckPlan {
  return {facts:[quote],keyElements:[{label:"걷는 장면",evidence:quote}],supportedTopics:[],sequenceConfirmed:false,unresolved:[],ready:true,question:null};
}

describe("fact check recovery",()=> {
  it.skipIf(!process.env.FACT_ANALYSIS_REPLAY_ARCHIVE)("accepts both saved real-model responses after correcting only their duplicate waking classification",()=> {
    const root=process.env.FACT_ANALYSIS_REPLAY_ARCHIVE!;
    const saved=JSON.parse(readFileSync(join(root,"input.json"),"utf8"));
    const request=JSON.parse(readFileSync(join(root,"1-request.json"),"utf8"));
    const reality=request.input.readingContext.evidence.realityTexts as string[];
    const sources={dream:[saved.localPlan.sourceText],reality:[saved.input.dream,...reality],original:[saved.input.dream],explicitReality:[observedDreamText(reality.join(". "))]};
    for(const filename of ["1-response.json","2-response.json"]) {
      const response=JSON.parse(readFileSync(join(root,filename),"utf8"));
      const checked=checkFactPlan(response,sources);
      expect(checked.errorCode).toBeNull();
      expect(checked.issues.filter(issue=>issue.action==="reclassified_as_reality")).toHaveLength(1);
      expect(checked.plan.facts.length).toBe(response.facts.length-1);
      expect(JSON.stringify(checked.plan.supportedTopics)===JSON.stringify(response.supportedTopics)).toBe(true);
      expect(JSON.stringify(checked.plan.keyElements)===JSON.stringify(response.keyElements)).toBe(true);
    }
  });
  it("keeps an explicitly waking fact under its already-grounded reality topic instead of duplicating it as a dream",()=> {
    const dream="꿈에서 시험지를 읽었어요", waking="현실에서는 다음 주 면접이 있어요";
    const initial={...plan(dream),facts:[dream,`${waking}.`],supportedTopics:[{topic:"reality" as const,evidence:waking}]};
    const checked=checkFactPlan(initial,{dream:[dream],reality:[waking],original:[`${dream}. ${waking}.`],explicitReality:[waking]});
    expect(checked.errorCode).toBeNull();
    expect(checked.plan.facts).toEqual([dream]);
    expect(checked.plan.supportedTopics).toEqual(initial.supportedTopics);
    expect(checked.issues).toEqual([expect.objectContaining({field:"facts",index:1,reason:"outside_allowed_sources",action:"reclassified_as_reality"})]);
    expect(initial.facts).toHaveLength(2);
  });
  it.each(["no_explicit_scope","no_reality_topic","no_dream_fact","invalid_element","invented_waking_fact","unverifiable_reality_topic"])("keeps an invalid core plan blocked: %s",mode=> {
    const dream="꿈에서 시험지를 읽었어요", waking="현실에서는 다음 주 면접이 있어요", invented="상사와 다퉜어요";
    const initial={...plan(dream),facts:[dream,waking],supportedTopics:[{topic:"reality" as const,evidence:waking}]};
    const sources={dream:[dream],reality:[waking],original:[`${dream}. ${waking}.`],explicitReality:[waking]};
    if(mode==="no_explicit_scope") sources.explicitReality=[];
    if(mode==="no_reality_topic") initial.supportedTopics=[];
    if(mode==="no_dream_fact") initial.facts=[waking];
    if(mode==="invalid_element") initial.keyElements[0].evidence=waking;
    if(mode==="invented_waking_fact") {initial.facts[1]=invented;initial.supportedTopics[0].evidence=invented;}
    if(mode==="unverifiable_reality_topic") sources.reality=[];
    expect(checkFactPlan(initial,sources).errorCode).not.toBeNull();
  });
  it("restores exact source text for outer quotes, final punctuation and repeated whitespace",()=> {
    const source="친구와  공원을\n걸었어요";
    const checked=checkFactPlan(plan("“친구와 공원을 걸었어요.”"),{dream:[source],reality:[],original:[source]});
    expect(checked.errorCode).toBeNull();
    expect(checked.plan.facts).toEqual([source]);
    expect(checked.plan.keyElements[0].evidence).toBe(source);
    expect(checked.issues.every(issue=>issue.action==="normalized")).toBe(true);
  });
  it.each(["?", "!", "?!"])("restores a literal quote when preprocessing removed its final %s", punctuation=> {
    const first="오래전 동료가 나오는 꿈을 꿨어";
    const last="공원 벤치에 앉아 있었는데 이거 왜이래";
    const original=`${first}. ${last}${punctuation}`;
    const source=observedDreamText(splitDreamEvidence(original).dreamText);
    const checked=checkFactPlan({...plan(`${last}${punctuation}`),facts:[first,`${last}${punctuation}`]},
      {dream:[source],reality:[],original:[original]});
    expect(checked.errorCode).toBeNull();
    expect(checked.plan.facts).toEqual([first,last]);
    expect(checked.plan.keyElements[0].evidence).toBe(last);
    expect(checked.issues).toEqual([
      expect.objectContaining({field:"facts",index:1,reason:"quote_format",action:"normalized"}),
      expect.objectContaining({field:"keyElements",index:0,reason:"quote_format",action:"normalized"})
    ]);
  });
  it.each([
    ['친구가 "뱀을 봤어요?"라고 말했어요.',"뱀을 봤어요?"],
    ["공원을 걸었어요. 현실에서는 기차를 탔어요!","기차를 탔어요!"],
    ["공원을 걸었어요. 무슨 뜻?","무슨 뜻?"],
    ["기차를 봤어요! 정정할게요 버스를 봤어요.","기차를 봤어요!"]
  ])("keeps excluded evidence blocked after punctuation normalization: %s",(original,quote)=> {
    const evidence=splitDreamEvidence(original);
    const checked=checkFactPlan(plan(quote),{
      dream:[observedDreamText(evidence.dreamText)],reality:evidence.realityTexts,original:[original]
    });
    expect(checked.errorCode).toBe("AI_FACT_CHECK_UNGROUNDED_FACT");
    expect(checked.issues[0]).toMatchObject({reason:"outside_allowed_sources",action:"repair_required"});
  });
  it.each([
    ["내가 친구를 밀었어요","친구가 나를 밀었어요"],
    ["아프지 않았어요","아팠어요"],
    ["아버지 가방을 봤어요","아버지가 방을 봤어요"],
    ["한 사람을 봤어요","두 사람을 봤어요"]
  ])("does not repair changed meaning or word boundaries: %s",(source,quote)=> {
    const checked=checkFactPlan(plan(quote),{dream:[source],reality:[],original:[source]});
    expect(checked.errorCode).toBe("AI_FACT_CHECK_UNGROUNDED_FACT");
    expect(checked.issues[0]).toMatchObject({field:"facts",index:0,reason:"quote_not_found",action:"repair_required"});
  });
  it("does not restore a superseded, quoted or real-world event as an active dream fact",()=> {
    const original='친구가 "뱀을 봤어요"라고 말했어요. 현실에서는 공원을 걸었어요';
    for (const quote of ["뱀을 봤어요","공원을 걸었어요"]) {
      const checked=checkFactPlan(plan(quote),{dream:["친구가 말했어요"],reality:["공원을 걸었어요"],original:[original]});
      expect(checked.errorCode).not.toBeNull();
      expect(checked.issues[0].reason).toBe("outside_allowed_sources");
    }
  });
  it("omits an unsupported optional topic but never deletes a bad core fact to pass",()=> {
    const initial={...plan("공원을 걸었어요"),supportedTopics:[{topic:"place" as const,evidence:"병원에서"}]};
    const checked=checkFactPlan(initial,{dream:["공원을 걸었어요"],reality:[],original:["공원을 걸었어요"]});
    expect(checked.plan.supportedTopics).toEqual([]);
    expect(checked.issues[0]).toMatchObject({field:"supportedTopics",index:0,topic:"place",action:"omitted"});
    expect(initial.supportedTopics).toHaveLength(1);
    const invalid=checkFactPlan({...initial,facts:["병원에서 기다렸어요"]},{dream:["공원을 걸었어요"],reality:[],original:["공원을 걸었어요"]});
    expect(invalid.errorCode).not.toBeNull();
  });
});
