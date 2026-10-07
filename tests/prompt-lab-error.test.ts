import { describe, expect, it } from "vitest";
import { promptLabProposalFailureHelp, promptLabReadingFailureHelp, promptLabReadingOutputIssueText } from "@/lib/prompt-lab-error";

describe("prompt lab actionable failure help",()=>{
  it("explains local model output failures without implying the user's dream is wrong",()=>{
    expect(promptLabReadingFailureHelp("LOCAL_CODEX_INVALID_OUTPUT")).toMatchObject({
      title: "AI 응답을 풀이 결과로 읽지 못했어요",
      explanation: expect.stringContaining("비교 목록에 추가하지 않았어요"),
      nextStep: expect.stringContaining("꿈을 바꿔 승인한 지침으로 새 실험")
    });
  });
  it("offers a focused feedback repair for an invalid edit span",()=>{
    expect(promptLabProposalFailureHelp("INVALID_PROMPT_EDIT").feedbackAddition).toContain("한 번만 나오는 짧은 범위");
  });
  it("translates safe local output diagnostics into an explanation the user can act on",()=>{
    expect(promptLabReadingOutputIssueText({kind:"invalid_json"})).toContain("JSON 형식이 아니어서");
    expect(promptLabReadingOutputIssueText({kind:"schema_mismatch",fields:["symbols.0.meaning"]})).toContain("symbols.0.meaning");
    expect(promptLabReadingOutputIssueText({kind:"empty_output"})).toContain("응답 내용을 돌려주지 않았어요");
  });
  it("gives a useful fallback for unknown safe error codes",()=>{
    expect(promptLabReadingFailureHelp("UNEXPECTED_SAFE_CODE").nextStep).toContain("같은 내용으로 다시 실험");
  });
});
