import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPromptEdits } from "@/lib/prompt-edit";
import { discussPromptGoal,getPromptProposalFailureDiagnostics,proposePromptEdit } from "@/lib/ai";
import { goalMemory,goalAgreement } from "./helpers/prompt-goal";
import { generateWithLocalCodex,LocalCodexError } from "@/lib/ai/codex-local";

vi.mock("@/lib/ai/codex-local",async importOriginal=>({...await importOriginal<typeof import("@/lib/ai/codex-local")>(),localCodexConfigured:()=>true,generateWithLocalCodex:vi.fn()}));
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});
const edit={before:"장면을 설명한다.",after:"궁금한 점에 먼저 답한다.",reason:"사용자 질문에 집중하기 위해 바꿔요."};

describe("reviewable prompt proposals",()=>{
  it("changes only the reviewed spans and preserves all other instructions",()=>{
    const original="사실을 만들지 않는다.\n장면을 설명한다.\n가능성으로 말한다.";
    expect(applyPromptEdits(original,{summary:"질문에 먼저 답하도록 수정하겠습니다.",edits:[edit]})).toBe("사실을 만들지 않는다.\n궁금한 점에 먼저 답한다.\n가능성으로 말한다.");
  });
  it.each([
    {original:"장면을 설명한다. 장면을 설명한다.",edits:[edit]},
    {original:"다른 지침",edits:[edit]},
    {original:"장면을 설명한다.",edits:[edit,{...edit,before:"설명한다."}]},
    {original:"장면을 설명한다.",edits:[{...edit,after:edit.before}]}
  ])("rejects ambiguous, absent, overlapping or unchanged patches",({original,edits})=>{
    expect(()=>applyPromptEdits(original,{summary:"변경",edits})).toThrow();
  });
  it("uses the supplied result and feedback to propose a patch without running a new reading",async()=>{
    vi.stubEnv("CODEX_LOCAL_PROMPT_EDIT_MODEL","gpt-6-astra");
    vi.stubEnv("CODEX_LOCAL_PROMPT_EDIT_REASONING_EFFORT","medium");
    vi.mocked(generateWithLocalCodex).mockResolvedValue({summary:"질문에 먼저 답하도록 수정하겠습니다.",edits:[edit]});
    const input={instructions:edit.before,resultInstructions:"이전 지침",feedback:"질문에 답해주세요",dream:"친구와 걸었어요",result:"함께 걷는 장면",memory:goalMemory};
    const proposal=await proposePromptEdit(input,"edit-session");
    expect(proposal.instructions).toBe(edit.after);
    expect(input.instructions).toBe(edit.before);
    expect(generateWithLocalCodex).toHaveBeenCalledOnce();
    const sent=vi.mocked(generateWithLocalCodex).mock.calls[0][0];
    expect(sent.model).toBe("gpt-6-astra");
    expect(sent.reasoningEffort).toBe("medium");
    expect(sent.schemaName).toBe("prompt_edit_proposal");
    expect(JSON.parse(sent.inputJson)).toEqual(input);
  });
  it("returns a retryable error instead of applying an ungrounded patch",async()=>{
    vi.mocked(generateWithLocalCodex).mockResolvedValue({summary:"변경",edits:[{...edit,before:"없는 지침"}]});
    await expect(proposePromptEdit({instructions:edit.before,resultInstructions:edit.before,feedback:"고쳐줘요",dream:"친구를 봤어요",result:"친구",memory:goalMemory},"edit")).rejects.toMatchObject({code:"PROMPT_PROPOSAL_FAILED",message:expect.stringContaining("2회 시도")});
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(2);
    expect(JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[1][0].inputJson)).toMatchObject({repairContext:{errorCode:"INVALID_PROMPT_EDIT",previousProposal:{edits:[{before:"없는 지침"}]}}});
  });
  it("retries malformed provider output once, then retains a safe failure code",async()=>{
    vi.mocked(generateWithLocalCodex)
      .mockRejectedValueOnce(new LocalCodexError("LOCAL_CODEX_INVALID_OUTPUT","private provider detail"))
      .mockRejectedValueOnce(new LocalCodexError("LOCAL_CODEX_INVALID_OUTPUT","private provider detail"));
    let failure:unknown;
    try {await proposePromptEdit({instructions:edit.before,resultInstructions:edit.before,feedback:"고쳐줘요",dream:"친구를 봤어요",result:"친구",memory:goalMemory},"edit");}
    catch(error){failure=error;}
    expect(failure).toMatchObject({code:"PROMPT_PROPOSAL_FAILED",message:expect.not.stringContaining("private provider detail")});
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(2);
    expect(getPromptProposalFailureDiagnostics(failure)).toEqual({stage:"provider",errorCode:"LOCAL_CODEX_INVALID_OUTPUT",attempts:2});
  });
  it("does not retry provider or connection errors that repair instructions cannot fix",async()=>{
    vi.mocked(generateWithLocalCodex).mockRejectedValueOnce(new LocalCodexError("LOCAL_CODEX_TIMEOUT","private timeout detail"));
    let failure:unknown;
    try {await proposePromptEdit({instructions:edit.before,resultInstructions:edit.before,feedback:"고쳐줘요",dream:"친구를 봤어요",result:"친구",memory:goalMemory},"edit");}
    catch(error){failure=error;}
    expect(generateWithLocalCodex).toHaveBeenCalledOnce();
    expect(getPromptProposalFailureDiagnostics(failure)).toEqual({stage:"provider",errorCode:"LOCAL_CODEX_TIMEOUT",attempts:1});
    expect(failure).toMatchObject({message:expect.stringContaining("1회 시도")});
    expect((failure as Error).message).not.toContain("private timeout detail");
  });
  it("keeps the original inputs unchanged when the single repair succeeds",async()=>{
    vi.mocked(generateWithLocalCodex)
      .mockRejectedValueOnce(new LocalCodexError("LOCAL_CODEX_INVALID_OUTPUT","bad format"))
      .mockResolvedValueOnce({summary:"질문에 먼저 답하도록 수정하겠습니다.",edits:[edit]});
    const input={instructions:edit.before,resultInstructions:"이전 지침",feedback:"질문에 답해주세요",dream:"친구와 걸었어요",result:"함께 걷는 장면이에요.",memory:goalMemory};
    const proposal=await proposePromptEdit(input,"edit");
    expect(proposal.instructions).toBe(edit.after);
    expect(JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[1][0].inputJson)).toMatchObject({
      ...input,
      repairContext:{errorCode:"LOCAL_CODEX_INVALID_OUTPUT",hint:expect.any(String)}
    });
  });
  it("asks instead of editing when the new request conflicts with the agreed goal",async()=>{
    vi.mocked(generateWithLocalCodex).mockResolvedValue({summary:"방향 확인이 필요해요",question:"유지하던 자세한 설명도 줄일까요?",edits:[]});
    await expect(proposePromptEdit({instructions:edit.before,resultInstructions:edit.before,feedback:"전부 짧게",dream:"친구를 봤어요",result:"친구",memory:goalMemory},"edit")).rejects.toMatchObject({code:"LAB_GOAL_CLARIFICATION_REQUIRED",message:"유지하던 자세한 설명도 줄일까요?"});
  });
  it("carries the agreed example and rejection reasons into each edit",async()=>{
    vi.mocked(generateWithLocalCodex).mockResolvedValue({summary:"변경",question:"",edits:[edit]});
    const memory={...goalMemory,decisions:[{status:"rejected" as const,sourceRunId:1,feedback:"더 간단히",summary:"전부 축약",reason:"좋았던 구체적인 설명까지 사라졌어요"}]};
    await proposePromptEdit({instructions:edit.before,resultInstructions:edit.before,feedback:"마지막 문장만",dream:"친구를 봤어요",result:"친구",memory},"edit");
    expect(JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[0][0].inputJson).memory).toEqual(memory);
  });
  it("does not call AI without an answered and confirmed goal",async()=>{
    await expect(proposePromptEdit({instructions:edit.before,resultInstructions:edit.before,feedback:"고쳐줘요",dream:"친구",result:"친구",memory:{...goalMemory,agreement:{...goalAgreement,brief:{...goalAgreement.brief,question:"어떤 설명이 좋았나요?"}}}},"edit")).rejects.toMatchObject({code:"LAB_GOAL_REQUIRED"});
    expect(generateWithLocalCodex).not.toHaveBeenCalled();
  });
  it("uses the editing model to clarify goals without editing instructions",async()=>{
    vi.stubEnv("CODEX_LOCAL_PROMPT_EDIT_MODEL","gpt-6-astra");vi.stubEnv("CODEX_LOCAL_PROMPT_EDIT_REASONING_EFFORT","medium");
    vi.mocked(generateWithLocalCodex).mockResolvedValue({...goalAgreement.brief,question:"직접적인 설명의 예시를 알려주세요."});
    const result=await discussPromptGoal({draft:goalAgreement.draft,answers:[],reference:goalAgreement.reference,previousAgreement:null,decisions:[]},"goal");
    expect(result.question).toBe("직접적인 설명의 예시를 알려주세요.");expect(result).not.toHaveProperty("instructions");
    expect(vi.mocked(generateWithLocalCodex).mock.calls[0][0]).toMatchObject({schemaName:"prompt_goal_discussion",model:"gpt-6-astra",reasoningEffort:"medium"});
  });
});
