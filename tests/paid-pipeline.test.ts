import { describe, expect, it, vi } from "vitest";
import { paidField, paidReviewProblems, runPaidPipeline, type PaidFinding, type PaidPipelineAdapter, type PaidPipelineState } from "@/lib/ai/paid-pipeline";
import { normalizePaidParagraphs } from "@/lib/ai";
import { pipelineReport as report, pipelineApproval as approved, acceptedCheckpoint } from "./helpers/paid-pipeline";
const evidence = [{ id: "original", kind: "dream", text: "문을 열었어요. 마지막에는 편안했어요." }];
const finding: PaidFinding = { kind: "unsupported_fact", target: "directAnswer", quote: report.directAnswer, basis: "not_in_sources", evidence: [], explanation: "사용자가 이 감정을 느낀 시점을 확인할 수 없습니다.", requiredChange: "문을 여는 순간의 감정으로 단정하지 않고 마지막 감정이라고 써 주세요." };
function adapter(): PaidPipelineAdapter {
  return { evidence, draft: vi.fn(async () => structuredClone(report)), repair: vi.fn(async value => value), review: vi.fn(async () => approved), normalize: value => value, localError: () => null };
}
describe("grounded paid pipeline", () => {
  it("does not rewrite an unrelated section when the local gate identified a different target", async () => {
    const a = adapter(); a.localError = () => "AI_DETAILED_UNGROUNDED_SCENE";
    a.localTargets = () => ["section:1"];
    vi.mocked(a.review).mockResolvedValue({...approved,approved:false,findings:[finding]});
    const save = vi.fn();
    await expect(runPaidPipeline(a,{save})).rejects.toThrow("PAID_REVIEW_EVIDENCE_INVALID");
    expect(a.repair).not.toHaveBeenCalled();
    expect(save.mock.calls.at(-1)?.[0].reviewProblems).toContain("local_rule_target_required:section:1");
  });
  it("targets a rejected reference ID even when it has no resolved source", async () => {
    const invalid = Object.assign(structuredClone(report), {referenceIds:["original"],sources:[]});
    const idsFinding: PaidFinding = {kind:"local_rule",target:"referenceIds",quote:"original",basis:"local_rule",evidence:[],explanation:"입력 증거 식별자는 외부 참고문헌이 아닙니다.",requiredChange:"허용된 외부 참고문헌이 없어 referenceIds를 빈 배열로 바꾸세요."};
    expect(paidField(invalid,"referenceIds")).toEqual(["original"]);
    expect(paidReviewProblems({...approved,approved:false,findings:[idsFinding]},invalid,evidence)).toEqual([]);
    const api=adapter(); api.draft=vi.fn(async()=>invalid);
    api.localError=value=>(paidField(value,"referenceIds") as string[]).length?"AI_DETAILED_UNGROUNDED_SOURCE":null;
    api.review=vi.fn().mockResolvedValueOnce({...approved,approved:false,findings:[idsFinding]}).mockResolvedValueOnce(approved);
    api.repair=vi.fn(async value=>Object.assign(structuredClone(value),{referenceIds:[]}));
    const result=await runPaidPipeline(api,{save:async()=>{}});
    expect(result.sections).toEqual(report.sections);expect(result.directAnswer).toBe(report.directAnswer);
    expect(paidField(result,"referenceIds")).toEqual([]);
  });
  it("requires the rejected phrase to exist in the specified field and the cited source to exist", () => {
    const review = { ...approved, approved: false, findings: [{ ...finding, quote: "없는 문장", basis: "contradicts_source" as const, evidence: [{ sourceId: "original", quote: "주장하지 않은 감정" }] }] };
    expect(paidReviewProblems(review, report, evidence)).toEqual(expect.arrayContaining(["finding:0:quote_not_in_target", "finding:0:source_quote_invalid"]));
  });
  it("does not fabricate a patch from a reviewer citation error", async () => {
    const a = adapter();
    vi.mocked(a.review).mockResolvedValueOnce({ ...approved, approved: false, findings: [{ ...finding, quote: "없는 구절" }] }).mockResolvedValueOnce(approved);
    const save = vi.fn();
    expect(await runPaidPipeline(a, { save })).toEqual(report);
    expect(a.repair).not.toHaveBeenCalled(); expect(a.review).toHaveBeenCalledTimes(2);
    expect(save.mock.calls.some(([s]) => s.reviewProblems.includes("finding:0:quote_not_in_target"))).toBe(true);
  });
  it("preserves the good sections while applying a grounded correction", async () => {
    const a = adapter(), corrected = { ...report, directAnswer: "문을 열었고 마지막에 편안했다고 했어요." };
    vi.mocked(a.review).mockResolvedValueOnce({ ...approved, approved: false, findings: [finding] }).mockResolvedValueOnce(approved);
    vi.mocked(a.repair).mockResolvedValueOnce(corrected);
    const result = await runPaidPipeline(a, { save: vi.fn() });
    expect(result).toEqual(corrected); expect(result.sections).toEqual(report.sections);
  });
  it("rejects a patch that changes untargeted material", async () => {
    const a = adapter(); vi.mocked(a.review).mockResolvedValue({ ...approved, approved: false, findings: [finding] });
    vi.mocked(a.repair).mockResolvedValue({ ...report, suggestedQuestions: ["요청하지 않은 변경"] });
    await expect(runPaidPipeline(a, { save: vi.fn() })).rejects.toThrow("PAID_PATCH_OUTSIDE_TARGET");
  });
  it("resumes at review after a connection failure without generating a fresh draft", async () => {
    const a = adapter(); let checkpoint: PaidPipelineState | undefined;
    vi.mocked(a.review).mockRejectedValueOnce(new Error("connection"));
    await expect(runPaidPipeline(a, { save: async state => { checkpoint = state; } })).rejects.toThrow("connection");
    expect(checkpoint?.stage).toBe("review");
    expect(await runPaidPipeline(a, { state: checkpoint, save: vi.fn() })).toEqual(report);
    expect(a.draft).toHaveBeenCalledTimes(1);
  });
  it("ends repeated real rejection after three partial repairs and saves the final diagnosis", async () => {
    const a = adapter(); vi.mocked(a.review).mockResolvedValue({ ...approved, approved: false, findings: [finding] });
    let checkpoint: PaidPipelineState | undefined;
    await expect(runPaidPipeline(a, { save: async state => { checkpoint = state; } })).rejects.toThrow("PAID_REPAIR_EXHAUSTED");
    expect(a.repair).toHaveBeenCalledTimes(3); expect(checkpoint?.findings).toEqual([finding]);
    await expect(runPaidPipeline(a, { state: checkpoint, save: vi.fn() })).rejects.toThrow("PAID_REPAIR_EXHAUSTED");
    expect(a.repair).toHaveBeenCalledTimes(3);
  });
  it("never accepts a reviewer approval when the local factual gate still rejects", async () => {
    const a = adapter(); a.localError = () => "AI_DETAILED_UNGROUNDED_SCENE";
    await expect(runPaidPipeline(a, { save: vi.fn() })).rejects.toThrow("PAID_REVIEW_EVIDENCE_INVALID");
    expect(a.review).toHaveBeenCalledTimes(2);
  });
  it("requires missing paid coverage to identify its exact section", () => {
    const review = { ...approved, approved: false, offerCoverage: approved.offerCoverage.map((c, i) => i === 2 ? { ...c, fulfilled: false } : c), findings: [finding] };
    expect(paidReviewProblems(review, report, evidence)).toContain("coverage:2:finding_required");
  });
  it("rechecks an accepted checkpoint before publishing after restart", async () => {
    const a = adapter(); a.localError = () => "newly_detected_error";
    await expect(runPaidPipeline(a, { state: acceptedCheckpoint(), save: vi.fn() })).rejects.toThrow("PAID_CHECKPOINT_INVALID");
    expect(a.draft).not.toHaveBeenCalled();
  });
  it("accepts a safe, complete report when the reviewer only objects to repetition", async () => {
    const a = adapter();
    const editorialFinding: PaidFinding = { kind: "repetition", target: "section:1", quote: "낯선 대상을 바라본 행동에서 거리를 조절하려는 마음을 살펴볼 수 있어요.", basis: "delivery_requirement", evidence: [], explanation: "비슷한 뜻이 반복됩니다.", requiredChange: "반복을 줄이세요." };
    vi.mocked(a.review).mockResolvedValue({ ...approved, approved: false, findings: [editorialFinding] });
    let checkpoint: PaidPipelineState | undefined;
    expect(await runPaidPipeline(a, { save: async state => { checkpoint = state; } })).toEqual(report);
    expect(a.repair).not.toHaveBeenCalled();
    expect(checkpoint).toMatchObject({ stage: "accepted", review: { approved: true, findings: [] } });
    expect(paidReviewProblems({ ...approved, approved: false, findings: [editorialFinding] }, report, evidence)).toEqual([]);
  });
  it("migrates a stored style-only review without losing its accepted report", async () => {
    const checkpoint = acceptedCheckpoint();
    checkpoint.review = { ...approved, approved: false, findings: [{
      kind: "repetition", target: "section:1", quote: "낯선 대상을 바라본 행동에서 거리를 조절하려는 마음을 살펴볼 수 있어요.", basis: "delivery_requirement", evidence: [], explanation: "비슷한 뜻이 반복됩니다.", requiredChange: "반복을 줄이세요."
    }] };
    expect(await runPaidPipeline(adapter(), { state: checkpoint, save: vi.fn() })).toEqual(report);
  });
  it("splits long paragraphs while preserving every sentence and condition", () => {
    const paragraph = "최근 평가받은 일이 있었다면, 그 기억과 연결해볼 수 있어요. 꿈에서 문을 열었어요. 편안함은 끝에 나타났어요. 당시의 부담을 정리하는 마음을 살펴볼 수 있어요. 마지막 설명도 삭제하지 않아요.";
    const before = { ...report, sections: [{ title: "최근 계기", paragraphs: [paragraph] }] };
    const after = normalizePaidParagraphs(before);
    expect(after.sections[0].paragraphs).toHaveLength(2);
    expect(after.sections[0].paragraphs.join(" ")).toBe(paragraph);
  });
});
