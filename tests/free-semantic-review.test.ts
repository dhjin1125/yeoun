import { describe, expect, it } from "vitest";
import { FREE_INTERPRETATION_POLICY } from "@/lib/ai/free-interpretation-policy";
import { FREE_SEMANTIC_REVIEW_PROMPT, freeSemanticDecision, freeSemanticRepairInstruction, reviewSentenceCatalog, type FreeSemanticReview } from "@/lib/ai/free-semantic-review";

const candidate = "현재 연인에게 불만이 있어서 나온 꿈이에요.";
const sentences = reviewSentenceCatalog([candidate]);
const pass: FreeSemanticReview = { severity: "pass", confidence: "high", verdict: "pass", reasonCodes: [], reason: "통과", findings: [], offerEligibility: { eligible: false, perspectives: [] } };
const rewrite: FreeSemanticReview = { ...pass, severity: "major", verdict: "rewrite", reasonCodes: ["overinterpretation"], findings: [{ sentenceId: "S1", rule: "unsupported_certainty", explanation: "확인하지 않은 현실 관계 상태를 단정함" }] };

describe("approved interpretation review policy", () => {
  it("uses the shared policy for both review and repair, with precise problem sentences", () => {
    expect(FREE_SEMANTIC_REVIEW_PROMPT).toContain(FREE_INTERPRETATION_POLICY);
    const instruction = freeSemanticRepairInstruction(rewrite, sentences);
    expect(instruction).toContain(FREE_INTERPRETATION_POLICY);
    expect(instruction).toContain(candidate);
    expect(instruction).toContain("unsupported_certainty");
    expect(instruction).not.toContain("조건문도 넣지 말고");
  });
  it("passes minor stylistic preferences but preserves factual and confidence gates", () => {
    expect(freeSemanticDecision(pass, sentences)).toBe("pass");
    expect(freeSemanticDecision({ ...pass, severity: "minor", verdict: "rewrite", reasonCodes: ["repetitive_or_report_like"], findings: [{ sentenceId: "S1", rule: "style", explanation: "말투 취향" }] }, sentences)).toBe("pass");
    expect(freeSemanticDecision(rewrite, sentences)).toBe("rewrite");
    expect(freeSemanticDecision({ ...rewrite, severity: "minor" }, sentences)).toBe("rewrite");
    expect(freeSemanticDecision({ ...pass, confidence: "low" }, sentences)).toBe("human_review");
    expect(freeSemanticDecision({ ...pass, verdict: "human_review" }, sentences)).toBe("human_review");
  });
  it("does not rewrite on invented review sentence IDs or unspecified allegations", () => {
    expect(freeSemanticDecision({ ...rewrite, findings: [{ ...rewrite.findings[0], sentenceId: "S99" }] }, sentences)).toBe("human_review");
    expect(freeSemanticDecision({ ...rewrite, findings: [] }, sentences)).toBe("human_review");
    expect(freeSemanticDecision({ ...rewrite, verdict: "pass" }, sentences)).toBe("human_review");
  });
  it("preserves the staged paid perspective threshold", () => {
    expect(FREE_SEMANTIC_REVIEW_PROMPT).toContain("같은 underlying flow");
    expect(FREE_SEMANTIC_REVIEW_PROMPT).toContain("서로 다른 해석 층위인 관점이 2개 있을 때만 eligible=true");
  });
});
