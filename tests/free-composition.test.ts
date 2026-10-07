import { afterEach, describe, expect, it, vi } from "vitest";
import { generateFreeAssistant } from "@/lib/ai";
import { generateWithLocalCodex } from "@/lib/ai/codex-local";
import { analyzeDreamContextLocally, buildBriefFreePayload, buildFreeAssistantPayload } from "@/lib/local-engine";
import { prepareSymbolicEvidence, symbolFirstReadingError, type ComposedReading } from "@/lib/symbolic-output";
import { createReading, getPublicReading } from "@/lib/readings";
import { TestRepository } from "./helpers/repository";

vi.mock("@/lib/ai/codex-local",async importOriginal=>({
  ...await importOriginal<typeof import("@/lib/ai/codex-local")>(),
  localCodexConfigured:()=>true,generateWithLocalCodex:vi.fn()
}));
afterEach(()=>{vi.resetAllMocks();vi.restoreAllMocks();vi.unstubAllEnvs();});
const semanticPass = { severity: "pass", confidence: "high", verdict: "pass", reasonCodes: [], reason: "통과" };
function mockFreeReading(value: unknown) {
  vi.mocked(generateWithLocalCodex).mockImplementation(async request =>
    request.schemaName === "free_semantic_review" ? semanticPass : value as never);
}

const dream="자전거를 타고 지도를 보며 길을 찾았어요. 다리를 건넌 뒤에도 지도를 다시 확인했어요.";
const composed: ComposedReading = {
  symbols:[
    {name:"자전거",evidence:"자전거를 타고",title:"스스로 움직이는 장면",referenceIds:[],meaning:"자전거를 타는 장면은 자신의 힘과 속도로 이동하는 모습을 떠올리게 해요. 지도를 보며 길을 찾았다는 점에서, 앞으로 나아가면서도 방향을 살피는 과정에 눈길이 가요."},
    {name:"지도",evidence:"지도를 보며 길을 찾았어요",title:"방향을 알려주는 지도",referenceIds:[],meaning:"지도는 낯선 길에서 다음 방향을 정할 기준이 되어줘요. 이동 중에 지도를 확인하는 행동은 목적지까지의 경로를 살피려는 신중함으로 읽어볼 수 있어요."},
    {name:"다리",evidence:"다리를 건넌 뒤에도",title:"다리를 건넌 뒤",referenceIds:[],meaning:"다리는 서로 떨어진 곳을 이어주는 구조예요. 건넌 뒤에도 지도를 다시 봤다는 점은 한 구간을 지나고도 다음 방향을 확인하는 모습으로 이어져요."}
  ],
  integratedReading:{
    title:"나아가면서도 다시 확인하는 방향",
    paragraphs:[
      "이 꿈에서는 이동 자체와 방향을 확인하는 행동이 함께 이어져요. 자전거로 길을 찾고 다리를 건넜지만, 거기서 멈추지 않고 지도를 다시 확인했다는 연결에 중심을 두어 읽어볼 수 있어요.",
      "지도를 볼 때 마음이 편했는지 초조했는지에 따라, 차분히 경로를 점검한 장면인지 길을 놓칠까 염려한 장면인지 읽기가 달라질 수 있어요. 지금은 확인한 행동의 연결을 중심에 두고 그 느낌을 열어둘 수 있어요."
    ],evidenceQuotes:["자전거를 타고 지도를 보며 길을 찾았어요","다리를 건넌 뒤에도 지도를 다시 확인했어요"]
  },
  nextQuestion:"지도를 다시 확인할 때 어떤 기분이었나요?"
};

describe("complete free reading delivery",()=> {
  it("keeps an experiment prompt request-local while preserving normal composition checks",async()=> {
    mockFreeReading(composed);
    const context=analyzeDreamContextLocally(dream,null).context;
    const custom="사용자의 질문에 먼저 답하는 실험 지침";
    await generateFreeAssistant(context,"lab",dream,undefined,undefined,custom);
    expect(vi.mocked(generateWithLocalCodex).mock.calls[0][0].instructions).toBe(custom);
    await generateFreeAssistant(context,"normal",dream);
    expect(vi.mocked(generateWithLocalCodex).mock.calls[2][0].instructions).not.toBe(custom);
  });
  it("preserves main symbol, grouped secondary symbols, integrated reading and question through storage and restore",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    vi.stubEnv("PAYMENTS_MODE","mock");
    const repository=new TestRepository();
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce({
      facts:["자전거를 타고 지도를 보며 길을 찾았어요"],
      keyElements:composed.symbols.map(symbol=>({label:symbol.title,evidence:symbol.evidence})),
      supportedTopics:[],sequenceConfirmed:true,unresolved:["지도를 확인할 때의 감정"],ready:false,
      question:{kind:"emotion",prompt:composed.nextQuestion,options:[],reason:"확인이 차분한 점검인지 염려인지에 따라 풀이가 달라져요.",placeholder:"그때의 기분을 적어주세요."}
    }).mockResolvedValueOnce(composed).mockResolvedValueOnce(semanticPass);
    const reading=await createReading({dream,emotion:null},"full-composition",repository);
    const saved=(await repository.getReading(reading.id))!;
    const restored=await getPublicReading(saved,"https://dream.test",repository);
    const answer=restored.timeline.find(turn=>turn.kind==="free")?.content;
    expect(answer).toMatchObject({
      generationSource:"codex",freeCompositionVersion:2,
      directAnswerTitle:composed.symbols[0].title,directAnswer:composed.symbols[0].meaning,
      sections:[{title:"함께 나타난 상징들",paragraphs:composed.symbols.slice(1).map(symbol=>symbol.meaning)},
        {title:composed.integratedReading!.title,paragraphs:composed.integratedReading!.paragraphs}],
      readingQuestion:composed.nextQuestion
    });
    expect(restored.freeDetailGuidance?.question).toBe(composed.nextQuestion);
    expect(restored.canPurchaseFullReading).toBe(false);
    expect(repository.orders.size).toBe(0);
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(3);
  });
  it("fixes quote formatting without rewriting any headings, meanings or integrated paragraphs",()=> {
    const candidate=structuredClone(composed);
    candidate.symbols[0].evidence="‘자전거를 타고.’";
    candidate.integratedReading!.evidenceQuotes[1]+=".";
    const prepared=prepareSymbolicEvidence(candidate,dream);
    expect(symbolFirstReadingError(prepared.reading,dream,[])).toBeNull();
    expect(prepared.reading.symbols.map(symbol=>symbol.meaning)).toEqual(composed.symbols.map(symbol=>symbol.meaning));
    expect(prepared.reading.integratedReading?.paragraphs).toEqual(composed.integratedReading?.paragraphs);
    expect(prepared.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({field:"symbols.evidence",index:0,action:"normalized"}),
      expect.objectContaining({field:"integratedReading.evidenceQuotes",index:1,action:"normalized"})
    ]));
  });
  it("sends the rejected quote location and previous composition to the existing one-time repair",async()=> {
    const logs=vi.spyOn(console,"info").mockImplementation(()=>undefined);
    const invalid=structuredClone(composed);
    invalid.symbols[0].name="자유로운 이동";
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(invalid).mockResolvedValueOnce(composed).mockResolvedValueOnce(semanticPass);
    const result=await generateFreeAssistant(analyzeDreamContextLocally(dream,null).context,"free-repair",dream);
    expect(result.sections.at(-1)?.paragraphs).toEqual(composed.integratedReading?.paragraphs);
    expect(result.readingQuestion).toBe(composed.nextQuestion);
    const request=JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[1][0].inputJson);
    expect(request.previousReading.integratedReading).toEqual(composed.integratedReading);
    expect(request.groundingIssues).toContainEqual(expect.objectContaining({field:"symbols.name",index:0,reason:"quote_not_found"}));
    const events=logs.mock.calls.map(([entry])=>JSON.parse(String(entry))).filter(entry=>entry.event==="dream_free_reading");
    expect(events.map(event=>event.outcome)).toEqual(["repair_requested","accepted"]);
    expect(events[0].requestId).toBe(events[1].requestId);
    expect(JSON.stringify(events)).not.toContain("자전거");
    expect(JSON.stringify(events)).not.toContain("자유로운 이동");
  });
  it("gives one targeted rewrite after a major semantic rejection, then requires a pass",async()=> {
    const major={severity:"major",confidence:"high",verdict:"rewrite",reasonCodes:["weak_narrative_link"],reason:"장면의 관계를 더 분명히 설명해야 해요."};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(composed).mockResolvedValueOnce(major)
      .mockResolvedValueOnce(composed).mockResolvedValueOnce(semanticPass);
    const result=await generateFreeAssistant(analyzeDreamContextLocally(dream,null).context,"semantic-rewrite",dream);
    expect(result.directAnswer).toBe(composed.symbols[0]!.meaning);
    expect(vi.mocked(generateWithLocalCodex).mock.calls.map(([request])=>request.schemaName)).toEqual([
      "dream_symbol_meanings","free_semantic_review","dream_symbol_meanings","free_semantic_review"
    ]);
    const repairInput=JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[2]![0].inputJson);
    expect(repairInput.revisionRequest).toContain("앞뒤 장면의 관계");
  });
  it("gives one targeted rewrite after a minor semantic rewrite verdict",async()=> {
    const logs=vi.spyOn(console,"info").mockImplementation(()=>undefined);
    const minor={severity:"minor",confidence:"high",verdict:"rewrite",reasonCodes:["emotion_not_precise","repetitive_or_report_like"],reason:"중심 감정과 장면 연결을 더 정확히 정리해야 해요."};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(composed).mockResolvedValueOnce(minor)
      .mockResolvedValueOnce(composed).mockResolvedValueOnce(semanticPass);
    const result=await generateFreeAssistant(analyzeDreamContextLocally(dream,null).context,"semantic-minor-rewrite",dream);
    expect(result.directAnswer).toBe(composed.symbols[0]!.meaning);
    expect(vi.mocked(generateWithLocalCodex).mock.calls.map(([request])=>request.schemaName)).toEqual([
      "dream_symbol_meanings","free_semantic_review","dream_symbol_meanings","free_semantic_review"
    ]);
    const repairInput=JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[2]![0].inputJson);
    expect(repairInput.revisionRequest).toContain("막연한 불안");
    const events=logs.mock.calls.map(([entry])=>JSON.parse(String(entry))).filter(entry=>entry.event==="dream_free_reading");
    expect(events.map(event=>event.outcome)).toEqual(["repair_requested","accepted"]);
    expect(events[0].semanticSeverity).toBe("minor");
    expect(events[0].semanticVerdict).toBe("rewrite");
  });
  it("falls back to the established complete local reading after one unsuccessful rewrite",async()=> {
    const major={severity:"major",confidence:"high",verdict:"rewrite",reasonCodes:["repetitive_or_report_like"],reason:"반복이 남아 있어요."};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(composed).mockResolvedValueOnce(major)
      .mockResolvedValueOnce(composed).mockResolvedValueOnce(major);
    const context=analyzeDreamContextLocally(dream,null).context;
    const result=await generateFreeAssistant(context,"semantic-still-major",dream);
    expect(result).toEqual(buildFreeAssistantPayload(context,"local_fallback"));
    expect(result.generationSource).toBe("local_fallback");
    expect(vi.mocked(generateWithLocalCodex)).toHaveBeenCalledTimes(4);
  });
  it("does not return a rules-based reading when the local AI profile's provider fails",async()=> {
    vi.stubEnv("APP_PROFILE","local-ai");
    vi.mocked(generateWithLocalCodex).mockRejectedValue(new Error("offline"));
    const context=analyzeDreamContextLocally(dream,null).context;
    await expect(generateFreeAssistant(context,"local-ai-provider-failure",dream)).rejects.toMatchObject({
      code:"AI_FREE_GENERATION_FAILED",
      status:503
    });
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(1);
  });
  it.each(["provider","grounding","integration"])("uses the complete local reading when %s generation fails",async failure=> {
    const source="뱀이 천천히 다가왔다가 멀어졌어요";
    const context=analyzeDreamContextLocally(source,null).context;
    expect(buildBriefFreePayload(context).freeReadingMode).toBe("symbolic");
    if (failure==="provider") vi.mocked(generateWithLocalCodex).mockRejectedValue(new Error("offline"));
    else vi.mocked(generateWithLocalCodex).mockResolvedValue(failure==="grounding" ? composed : {
      symbols:[{name:"뱀",evidence:"뱀이 천천히 다가왔다가",title:"다가오는 뱀",referenceIds:[],meaning:"다가왔다가 멀어지는 뱀은 조심스럽게 살피던 대상과 거리가 달라지는 모습을 떠올리게 해요."}],integratedReading:null,nextQuestion:null
    });
    const result=await generateFreeAssistant(context,"existing-local-fallback",source);
    expect(result).toEqual(buildFreeAssistantPayload(context,"local_fallback"));
    expect(result).not.toEqual(buildBriefFreePayload(context));
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(failure==="provider" ? 1 : 2);
  });
});
