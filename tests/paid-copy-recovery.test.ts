import { describe, expect, it, vi } from "vitest";
import { reportCopyError, reportCopyFindings } from "@/lib/consultation";
import { paidLocalRuleFindings } from "@/lib/ai";
import { runPaidPipeline, type PaidFinding, type PaidPipelineAdapter, type PaidPipelineState } from "@/lib/ai/paid-pipeline";
import type { AssistantTurnPayload, PaidOffer } from "@/lib/types";
import { pipelineReport, pipelineApproval } from "./helpers/paid-pipeline";

describe("paid copy diagnostics and recovery", () => {
  it("does not count prediction words or useful limits as a delivery failure", () => {
    const report = structuredClone(pipelineReport);
    report.sections[2].paragraphs = ["접한 이야기가 꿈의 소재가 됐을 수 있어요. 실제 사건을 예고하기보다 기억을 엮어 보는 풀이예요."];
    report.sections[3].paragraphs = ["행운의 예고로 넓히기보다 문을 연 선택과 연결해서 살펴볼 수 있어요."];
    expect(reportCopyError(report)).toBeNull();
    expect(reportCopyFindings(report)).toEqual([]);
  });

  it("keeps exact locations for internal instructions, including titles", () => {
    const report = structuredClone(pipelineReport);
    report.directAnswerTitle = "dreamContext";
    report.sections[2].paragraphs = ["내부 지침을 확인해요. promisedSectionTitle을 사용해요."];
    expect(reportCopyError(report)).toBe("REPORT_INTERNAL_OR_PLACEHOLDER");
    expect(reportCopyFindings(report)).toEqual([
      { target: "directAnswerTitle", quote: "dreamContext" },
      { target: "section:2", quote: "내부 지침" },
      { target: "section:2", quote: "promisedSectionTitle" }
    ]);
  });

  it("repairs the code-identified field despite reviewer approval, then reviews again", async () => {
    const report = structuredClone(pipelineReport);
    report.sections[2].paragraphs = ["내부 지침이 들어간 문장이에요."];
    const fixed = structuredClone(report);
    fixed.sections[2].paragraphs = ["최근 접한 이야기가 낯선 대상의 모습과 연결됐을 수 있어요."];
    const adapter: PaidPipelineAdapter = {
      evidence: [], draft: vi.fn(async () => report), normalize: value => value,
      review: vi.fn(async () => structuredClone(pipelineApproval)),
      localError: value => reportCopyError(value) ? "AI_DETAILED_REPORT_COPY" : null,
      localFindings: (value, error) => paidLocalRuleFindings(value, {} as PaidOffer, "", error),
      repair: vi.fn(async (_value: AssistantTurnPayload, findings: PaidFinding[]) => {
        expect(findings.map(f => f.target)).toEqual(["section:2"]);
        expect(findings[0].quote).toBe("내부 지침");
        return fixed;
      })
    };
    let checkpoint: PaidPipelineState | undefined;
    const result = await runPaidPipeline(adapter, { save: async state => { checkpoint = state; } });
    expect(result.directAnswer).toBe(report.directAnswer);
    expect(result.sections[0]).toEqual(report.sections[0]);
    expect(adapter.review).toHaveBeenCalledTimes(2);
    expect(adapter.repair).toHaveBeenCalledTimes(1);
    expect(checkpoint).toMatchObject({ stage: "accepted", repairs: 1, localError: null });
  });

  it("does not trust a code finding whose quote is absent from its target", async () => {
    const adapter: PaidPipelineAdapter = {
      evidence: [], draft: async () => pipelineReport, normalize: value => value,
      review: async () => pipelineApproval, localError: () => "AI_DETAILED_REPORT_COPY",
      localFindings: () => paidLocalRuleFindings({ ...pipelineReport, directAnswer: "내부 지침" }, {} as PaidOffer, "", "AI_DETAILED_REPORT_COPY"),
      repair: vi.fn(async value => value)
    };
    await expect(runPaidPipeline(adapter, { save: async () => {} })).rejects.toThrow("PAID_REVIEW_EVIDENCE_INVALID");
    expect(adapter.repair).not.toHaveBeenCalled();
  });
});
