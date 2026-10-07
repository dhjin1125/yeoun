import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeDreamContextLocally } from "@/lib/local-engine";
import { generateDetailedAssistant, generateFreeAssistant, getFreeReadingFailureDiagnostics } from "@/lib/ai";
import { generateWithLocalCodex, LocalCodexError } from "@/lib/ai/codex-local";
import { formatSymbolTitle } from "@/lib/symbolic-title";
import { symbolicOutputError, type ComposedReading } from "@/lib/symbolic-output";
import { culturalReferencesForDream } from "@/lib/cultural-references";
import { buildConsultationPlan } from "@/lib/consultation";
import { byIdFixture } from "./free-evidence-fixture";

vi.mock("@/lib/ai/codex-local", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/codex-local")>(),
  localCodexConfigured: () => true,
  generateWithLocalCodex: vi.fn()
}));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
const semanticPass = { severity: "pass", confidence: "high", verdict: "pass", reasonCodes: [], reason: "통과", findings: [], offerEligibility: { eligible: false, perspectives: [] } };
function mockFreeReading(value: unknown) {
  vi.mocked(generateWithLocalCodex).mockImplementation(async request =>
    request.schemaName === "free_semantic_review" ? semanticPass : value as never);
}

// These fixtures exercise symbol-level rules. Supply the current mandatory
// integration contract so a missing section does not mask the rule under test.
function completeReading(symbols: ComposedReading["symbols"], source: string) {
  return byIdFixture({ symbols, integratedReading: {
    title: "꿈에 남은 장면의 연결",
    paragraphs: ["기억에 남은 대상의 특징과 실제 행동을 함께 살펴볼 수 있어요. 어떤 느낌이 남았는지에 따라 그 장면을 읽는 방향도 달라질 수 있어요."],
    evidenceQuotes: [source]
  }, nextQuestion: null }, source);
}

describe("symbolic free reading", () => {
  it("shares the same evidence envelope between free and detailed generation", async () => {
    vi.stubEnv("APP_PROFILE", "local-ai");
    const dream = "꿈에서 이름 모를 악기를 연주했어요. 마지막에 마음이 편안해졌어요.";
    const context = analyzeDreamContextLocally(dream, null).context;
    context.consultation = { ...buildConsultationPlan(context, []), ready: true, unresolved: [], question: null };
    mockFreeReading(completeReading([{ name: "악기", evidence: "악기를 연주했어요", title: "악기를 연주하는 장면", meaning: "악기를 연주하는 모습은 내 방식대로 표현하는 즐거움을 떠올리게 해요. 끝에 편안해진 마음은 표현을 마친 만족감과 연결해볼 수 있어요." }], dream));
    await generateFreeAssistant(context, "shared-context", dream);
    const freeInput = JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[0][0].inputJson);
    vi.mocked(generateWithLocalCodex).mockRejectedValueOnce(new Error("intentional provider stop after request capture"));
    await expect(generateDetailedAssistant(context, "shared-context", "none", dream)).rejects.toThrow();
    const detailedInput = JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[2][0].inputJson);
    expect(detailedInput.readingContext).toEqual(freeInput.readingContext);
  });
  it("passes narrative hints and typed supplemental evidence to the actual free generator", async () => {
    const dream = "이름 모를 악기를 연주하다가 멈췄어요";
    const context = analyzeDreamContextLocally(dream, null).context;
    mockFreeReading(completeReading([{ name: "악기", evidence: "악기를 연주하다가", title: "악기를 연주하는 장면", meaning: "악기를 연주하는 모습은 나만의 방식으로 표현하려는 마음을 떠올리게 해요. 멈추는 순간에는 표현을 이어가기 어려운 지점을 살펴볼 수 있어요." }], dream));
    await generateFreeAssistant(context, "narrative-input", dream, { selectedEmotion: null, clarificationAnswers: [
      { questionId: "feeling", kind: "emotion", answer: "멈춘 뒤에는 오히려 후련했어요", skipped: false },
      { questionId: "reality", kind: "recent_context", answer: "현실에서는 이직을 고민해요", skipped: false }
    ] });
    const input = JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[0][0].inputJson);
    expect(input.readingContext.engineHints.scenes.length).toBeGreaterThan(0);
    expect(input.readingContext.evidence.clarifications[0]).toEqual({ kind: "emotion", text: "멈춘 뒤에는 오히려 후련했어요" });
    expect(input.readingContext.evidence.realityTexts).toContain("현실에서는 이직을 고민해요");
    expect(input.userContent).not.toContain("이직");
    expect(input.userContent).not.toContain("후련");
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(2);
  });
  it("rejects the repeated traditional/symbolic paragraph formula", () => {
    const source = "돼지와 가위";
    expect(symbolicOutputError([
      { name: "돼지", evidence: "돼지", title: "돼지의 상징", referenceIds: ["aks-pig-provisions"], meaning: "전통적 관점에서는 돼지가 풍요를 뜻하기도 해요. 상징적 해석으로는 넉넉한 모습을 볼 수 있어요." },
      { name: "가위", evidence: "가위", title: "가위의 상징", referenceIds: ["aks-scissors-wealth"], meaning: "전통적 관점에서는 가위가 재물을 뜻하기도 해요. 상징적으로는 잘라내는 표현으로 볼 수 있어요." }
    ], source, culturalReferencesForDream(source))).toBe("AI_SYMBOL_FORMULAIC");
  });

  it("rejects attacking rewritten as being attacked even under a correct title", () => {
    expect(symbolicOutputError([{ name: "때리고", evidence: "때리고", title: "때리는 장면", meaning: "전통적 관점에서는 공격받는 장면이 갈등의 상징으로 여겨지기도 해요." }], "때리고")).toBe("AI_SYMBOL_REVERSED_ACTION");
  });

  it("lets the semantic reviewer decide whether repeated wording is substantive", async () => {
    const dream = "돼지와 가위가 나왔어요";
    const symbols = [
      { name: "돼지", evidence: "돼지", title: "돼지의 상징", referenceIds: ["aks-pig-provisions"], meaning: "전통적 관점에서는 돼지가 풍요를 뜻하기도 해요. 상징적 해석으로는 넉넉한 모습을 볼 수 있어요." },
      { name: "가위", evidence: "가위", title: "가위의 상징", referenceIds: ["aks-scissors-wealth"], meaning: "전통적 관점에서는 가위가 재물을 뜻하기도 해요. 상징적으로는 잘라내는 표현으로 볼 수 있어요." }
    ];
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(completeReading(symbols, dream)).mockResolvedValueOnce(semanticPass);
    const result = await generateFreeAssistant(analyzeDreamContextLocally(dream, null).context, "editorial-retry", dream);
    expect(result.directAnswer).toBe(symbols[0].meaning);
    expect(result.sections[0].paragraphs).toEqual([symbols[1].meaning]);
    expect(vi.mocked(generateWithLocalCodex).mock.calls[1][0].schemaName).toBe("free_semantic_review");
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(2);
  });
  it.each([
    "피는 생명력의 상징으로 볼 수 있어요. 실제 생",
    "피는 생명력의 상징으로 볼 수",
    "피는 생명력의 상징으로 볼 수 있어요. 실제 생.",
    "피는 생명력을 뜻하며,",
    "피는 생명력의 상징으로 볼 수 있어요…"
  ])("rejects an unfinished explanation: %s", (meaning) => {
    expect(symbolicOutputError([{ name: "피", evidence: "피", title: "피의 상징", meaning }], "피")).toBe("AI_SYMBOL_UNFINISHED");
  });

  it("rewrites a cut-off explanation as connected complete sentences", async () => {
    const dream = "팔에서 피가 나왔어요";
    const symbol = { name: "피", evidence: "피가 나왔어요", title: "피가 나는 장면", meaning: "피는 생명력과 몸 안에서 움직이는 강한 에너지를 떠올리게 해요. 실제 생" };
    const meaning = "피는 생명력과 강한 에너지의 상징으로 볼 수 있어요. 몸 밖으로 흐르는 모습은 쌓인 감정이 드러나거나 힘을 많이 쏟는 모습을 나타낼 수 있어요.";
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(completeReading([symbol], dream))
      .mockResolvedValueOnce(completeReading([{ ...symbol, meaning }], dream)).mockResolvedValueOnce(semanticPass);
    const result = await generateFreeAssistant(analyzeDreamContextLocally(dream, null).context, "complete-prose", dream);
    expect(result.directAnswer).toBe(meaning);
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(3);
    expect(JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[1][0].inputJson).revisionRequest).toContain("설명 전체");
  });

  it.each([
    "공격받는 장면은 압박의 상징으로 볼 수 있지만, 현실의 사건을 예고하지는 않아요.",
    "피는 생명력을 나타낼 수 있으며, 건강이나 미래를 뜻한다고 단정할 수는 없어요."
  ])("rewrites a disclaimer ending as a possible symbolic meaning: %s", async (meaning) => {
    const dream = "공격받고 피가 나는 꿈";
    const symbol = { name: "피", evidence: "피가 나는", title: "피가 나는 장면", meaning };
    expect(symbolicOutputError([symbol], dream)).toBe("AI_SYMBOL_DISCLAIMER");
    const revised = "피는 생명력과 강한 에너지의 상징으로 볼 수 있어요. 눌려 있던 감정의 표출이나 기운의 소모를 나타낼 수 있어요.";
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(completeReading([symbol], dream))
      .mockResolvedValueOnce(completeReading([{ ...symbol, meaning: revised }], dream)).mockResolvedValueOnce(semanticPass);
    const result = await generateFreeAssistant(analyzeDreamContextLocally(dream, null).context, "meaning-tone", dream);
    expect(result.directAnswer).toBe(revised);
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(3);
    const retry = vi.mocked(generateWithLocalCodex).mock.calls[1][0];
    expect(JSON.parse(retry.inputJson).revisionRequest).toContain("같은 한계를 반복하지 마세요");
  });

  it("allows possible meanings while still rejecting definite predictions", () => {
    const symbol = { name: "피", evidence: "피", title: "피가 나는 장면", meaning: "피는 생명력의 상징으로 볼 수 있어요." };
    expect(symbolicOutputError([symbol], "피")).toBeNull();
    expect(symbolicOutputError([{ ...symbol, meaning: "반드시 사고가 일어나요." }], "피")).toBe("AI_SYMBOL_UNSAFE_CLAIM");
  });

  it("does not regenerate solely for a title style preference approved by semantic review", async () => {
    const dream = "피나오고";
    const symbol = {name: dream, evidence: dream, title: "피나오고의 상징", meaning: "피가 나는 장면은 강한 감정이나 기운의 소모를 떠올리게 해요. 감정이 드러나는 모습으로 읽기도 해요."};
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(completeReading([symbol], dream)).mockResolvedValueOnce(semanticPass);
    const result = await generateFreeAssistant(analyzeDreamContextLocally(dream,null).context,"repair-title",dream);
    expect(result.directAnswerTitle).toBe(symbol.title);
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(2);
  });

  it("rejects reversed actions and duplicate headings", () => {
    const source = "막 때리고";
    const symbol = {name: source, evidence: source, title: "맞는 장면", meaning: "감정이 드러나는 장면으로 읽을 수 있어요."};
    expect(symbolicOutputError([symbol],source)).toBe("AI_SYMBOL_REVERSED_ACTION");
    const corrected = {...symbol,title:"때리는 장면"};
    expect(symbolicOutputError([corrected,corrected],source)).toBe("AI_SYMBOL_DUPLICATE");
  });
  it("keeps literal evidence separate from readable action titles", async () => {
    const dream = "내가 막 때리고 피나오고";
    mockFreeReading(completeReading([
      { name: "막 때리고", evidence: "막 때리고", title: "때리는 장면", meaning: "때리는 장면은 강하게 표출되는 감정이나 대립을 나타낼 수 있어요. 억눌린 힘이 밖으로 향하는 모습으로 읽기도 해요." },
      { name: "피나오고", evidence: "피나오고", title: "피가 나는 장면", meaning: "피가 나는 장면은 강한 충격이나 기운의 소모를 떠올리게 해요. 감정이 밖으로 드러나는 모습으로 읽기도 해요." }
    ], dream));
    const result = await generateFreeAssistant(analyzeDreamContextLocally(dream, null).context, "natural-titles", dream);
    expect(result.directAnswerTitle).toBe("때리는 장면");
    expect(result.sections[0].title).toBe("피가 나는 장면");
    expect(result.directAnswer).not.toContain("맞는");
  });

  it("corrects legacy fragment titles without reversing the action", () => {
    expect(formatSymbolTitle("막 때리고의 상징")).toBe("때리는 장면");
    expect(formatSymbolTitle("피나오고의 상징")).toBe("피가 나는 장면");
    expect(formatSymbolTitle("맞고의 상징")).toBe("맞는 장면");
    expect(formatSymbolTitle("엘리베이터의 상징")).toBe("엘리베이터의 상징");
  });

  it("reads symbols outside the catalog from the actual dream instead of returning a generic question", async () => {
    const dream = "엘리베이터가 나왔어";
    mockFreeReading(completeReading([{
      name: "엘리베이터", title: "엘리베이터의 상징", evidence: "엘리베이터가 나왔어",
      meaning: "엘리베이터는 위치나 상태의 변화를 나타내는 상징으로 읽을 수 있어요. 올라가고 내려가는 움직임을 목표와 기대의 변화에 빗대어 보기도 해요."
    }], dream));
    const result = await generateFreeAssistant(analyzeDreamContextLocally(dream, null).context, "unknown-symbol", dream);
    expect(result).toMatchObject({ freeReadingMode: "symbolic", generationSource: "codex", directAnswerTitle: "엘리베이터의 상징" });
    expect(result.directAnswer).toContain("상태의 변화");
  });

  it("rejects invented symbol evidence", async () => {
    vi.stubEnv("APP_PROFILE", "local-ai");
    const dream = "기억이 안 나요";
    vi.mocked(generateWithLocalCodex).mockResolvedValue({ symbols: [{
      name: "엘리베이터", title: "엘리베이터의 상징", evidence: "엘리베이터가 나왔어",
      meaning: "엘리베이터는 위치나 상태의 변화를 나타내는 상징으로 읽을 수 있어요."
    }] });
    await expect(generateFreeAssistant(analyzeDreamContextLocally(dream, null).context, "invented-symbol", dream))
      .rejects.toMatchObject({ code: "AI_FREE_GENERATION_FAILED" });
  });

  it("does not blame missing dream detail when the provider fails", async () => {
    vi.stubEnv("APP_PROFILE", "local-ai");
    const dream = "엘리베이터가 나왔어";
    vi.mocked(generateWithLocalCodex).mockRejectedValue(new Error("provider unavailable"));
    await expect(generateFreeAssistant(analyzeDreamContextLocally(dream,null).context,"provider-error",dream))
      .rejects.toMatchObject({code:"AI_FREE_GENERATION_FAILED",status:503});
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(1);
  });

  it("repairs one malformed structured response before failing the experiment", async () => {
    const dream = "엘리베이터가 나왔어";
    vi.mocked(generateWithLocalCodex)
      .mockRejectedValueOnce(new LocalCodexError("LOCAL_CODEX_INVALID_OUTPUT", "형식 오류", {kind:"schema_mismatch",fields:["symbols.0.meaning"]}))
      .mockResolvedValueOnce({ symbols: [{
        evidenceRef: { startId: "E1", endId: "E2" }, referenceIds: [], title:"엘리베이터의 상징",
        meaning:"엘리베이터는 위치나 상태가 달라지는 장면을 떠올리게 해요. 어디로 움직이는지에 따라 변화에 대한 기대나 망설임을 비춰볼 수 있어요."
      }],integratedReading:{title:"꿈 장면을 함께 보면",paragraphs:["엘리베이터가 나온 장면은 지금의 위치에서 다른 단계로 옮겨가려는 생각과 연결해볼 수 있어요."],evidenceRefs:[{ startId: "E1", endId: "E2" }]},nextQuestion:null }).mockResolvedValueOnce(semanticPass);
    const result = await generateFreeAssistant(analyzeDreamContextLocally(dream,null).context,"format-repair",dream);
    expect(result.directAnswerTitle).toBe("엘리베이터의 상징");
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(3);
    expect(JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[1][0].inputJson).revisionRequest).toContain("JSON Schema");
  });

  it("does not skip an uncatalogued symbol just because a known symbol also appears", async () => {
    const dream = "뱀이 엘리베이터에 있었어";
    mockFreeReading(completeReading([
      { name: "뱀", evidence: "뱀이", title: "뱀의 상징", meaning: "뱀은 생명력과 변화를 나타내는 상징으로 볼 수 있어요. 다가오는 변화에 대한 경계를 떠올리게 하기도 해요." },
      { name: "엘리베이터", evidence: "엘리베이터에", title: "엘리베이터의 상징", meaning: "엘리베이터는 상태나 위치가 달라지는 모습을 떠올리게 해요. 목표를 향한 이동을 나타내기도 해요." }
    ], dream));
    const result = await generateFreeAssistant(analyzeDreamContextLocally(dream, null).context, "mixed-symbols", dream);
    expect(result.freeReadingMode).toBe("symbolic");
    expect(result.sections[0].title).toBe("엘리베이터의 상징");
    expect(generateWithLocalCodex).toHaveBeenCalled();
  });
});
