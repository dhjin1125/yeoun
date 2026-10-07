import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeDreamContextLocally } from "@/lib/local-engine";
import { generateFreeAssistant } from "@/lib/ai";
import { generateWithLocalCodex, LocalCodexError } from "@/lib/ai/codex-local";

vi.mock("@/lib/ai/codex-local", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/ai/codex-local")>(),
  localCodexConfigured: () => true,
  generateWithLocalCodex: vi.fn()
}));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

const dream = "엘리베이터가 나왔어";
const candidate = {
  symbols: [{ evidenceRef: { startId: "E1", endId: "E2" }, referenceIds: [], title: "엘리베이터의 상징", meaning: "엘리베이터는 위치나 상태의 변화를 나타내는 상징으로 읽을 수 있어요. 올라가고 내려가는 움직임을 목표와 기대의 변화에 빗대어 보기도 해요." }],
  integratedReading: { title: "장면을 연결하면", paragraphs: ["엘리베이터가 나온 장면은 지금의 위치에서 다른 단계로 옮겨가려는 생각과 연결해볼 수 있어요."], evidenceRefs: [{ startId: "E1", endId: "E2" }] },
  nextQuestion: null
};
const pass = { severity: "pass", confidence: "high", verdict: "pass", reasonCodes: [], reason: "통과", findings: [], offerEligibility: { eligible: false, perspectives: [] } };
const rewrite = { ...pass, severity: "major", verdict: "rewrite", reasonCodes: ["overinterpretation"], reason: "입력에 없는 원인", findings: [{ sentenceId: "S2", rule: "unsupported_certainty", explanation: "실제 마음을 단정한 것으로 평가한 모의 검수" }] };
const run = () => {
  vi.stubEnv("APP_PROFILE", "local-ai");
  return generateFreeAssistant(analyzeDreamContextLocally(dream, null).context, "repair-budget-fixture", dream);
};

describe("separate free reading repair budgets", () => {
  it.each(["grounding", "format"])("permits a semantic rewrite after %s repair", async kind => {
    const mock = vi.mocked(generateWithLocalCodex);
    if (kind === "format") mock.mockRejectedValueOnce(new LocalCodexError("LOCAL_CODEX_INVALID_OUTPUT", "invalid format"));
    else mock.mockResolvedValueOnce({ ...candidate, integratedReading: { ...candidate.integratedReading, evidenceRefs: [{ startId: "E999", endId: "E999" }] } });
    mock.mockResolvedValueOnce(kind === "format" ? candidate : { replacements: [{ field: "integratedReading", index: 0, evidenceRef: { startId: "E1", endId: "E2" } }] })
      .mockResolvedValueOnce(rewrite).mockResolvedValueOnce(candidate).mockResolvedValueOnce(pass);
    expect((await run()).freeReadingMode).toBe("symbolic");
    expect(mock).toHaveBeenCalledTimes(5);
    expect(JSON.parse(mock.mock.calls[3][0].inputJson).revisionRequest).toContain("unsupported_certainty");
    if (kind === "grounding") expect(mock.mock.calls[1][0].schemaName).toBe("free_evidence_ref_repair");
  });
  it("rejects repeated semantic failures instead of delivering the rejected reading", async () => {
    const mock = vi.mocked(generateWithLocalCodex);
    mock.mockResolvedValueOnce(candidate).mockResolvedValueOnce(rewrite).mockResolvedValueOnce(candidate).mockResolvedValueOnce(rewrite);
    await expect(run()).rejects.toMatchObject({ code: "AI_FREE_QUALITY_FAILED" });
    expect(mock).toHaveBeenCalledTimes(4);
  });
  it("does not turn low-confidence or human-review results into automatic rewrites", async () => {
    const mock = vi.mocked(generateWithLocalCodex);
    mock.mockResolvedValueOnce(candidate).mockResolvedValueOnce({ ...rewrite, confidence: "low", verdict: "human_review" });
    await expect(run()).rejects.toMatchObject({ code: "AI_FREE_QUALITY_FAILED" });
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("delivers a minor style issue without another generation", async () => {
    const mock = vi.mocked(generateWithLocalCodex);
    mock.mockResolvedValueOnce(candidate).mockResolvedValueOnce({ ...pass, severity: "minor", verdict: "rewrite", reasonCodes: ["repetitive_or_report_like"], findings: [{ sentenceId: "S2", rule: "style", explanation: "취향 차이" }] });
    expect((await run()).freeReadingMode).toBe("symbolic");
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("stops after a second grounding rejection", async () => {
    const mock = vi.mocked(generateWithLocalCodex);
    mock.mockResolvedValueOnce({ ...candidate, integratedReading: { ...candidate.integratedReading, evidenceRefs: [{ startId: "bad", endId: "bad" }] } })
      .mockResolvedValueOnce({ replacements: [{ field: "integratedReading", index: 0, evidenceRef: { startId: "bad", endId: "bad" } }] });
    await expect(run()).rejects.toMatchObject({ code: "AI_FREE_GENERATION_FAILED" });
    expect(mock).toHaveBeenCalledTimes(2);
  });
});
