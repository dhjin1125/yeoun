import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/prompt-lab/route";
import { POST as propose } from "@/app/api/prompt-lab/propose/route";
import { accessGatePassed } from "@/lib/access-gate";
import { generateDetailedAssistant, getPromptProposalFailureDiagnostics, prepareConsultation, proposePromptEdit } from "@/lib/ai";
import { promptLabArchive } from "@/lib/prompt-lab-archive";
import { AppError } from "@/lib/http";
import { PAID_READING_PROMPT } from "@/lib/ai/prompts";
import { goalMemory } from "./helpers/prompt-goal";

vi.mock("@/lib/prompt-lab-archive",()=>({promptLabArchive:{record:vi.fn(async()=>({id:"archive-test",savedAt:"2026-09-23T00:00:00.000Z"}))},labModelSettings:()=>({provider:"codex",model:"test-model",reasoningEffort:"high"})}));
vi.mock("@/lib/access-gate", () => ({accessGatePassed:vi.fn(async()=>true)}));
vi.mock("@/lib/session",()=>({getOrCreateDreamSession:vi.fn(async()=>({hash:"lab-session"}))}));
vi.mock("@/lib/ai/codex-local",()=>({localCodexConfigured:()=>true,localCodexModelLabel:()=>"configured-model"}));
vi.mock("@/lib/ai",()=>({
  analyzeDreamInput:vi.fn(async()=>({context:{}})),
  prepareConsultation:vi.fn(async()=>({ready:true})),
  proposePromptEdit:vi.fn(async()=>({summary:"질문에 먼저 답하도록 수정하겠습니다.",edits:[],instructions:"수정 지침"})),
  getPromptProposalFailureDiagnostics:vi.fn((error:unknown)=>(error as {diagnostic?:unknown})?.diagnostic??null),
  getFreeReadingFailureDiagnostics:vi.fn((error:unknown)=>(error as {diagnostic?:unknown})?.diagnostic??null),
  generateDetailedAssistant:vi.fn(async(...args: unknown[])=>({generationSource:"codex",directAnswer:"함께 걷는 꿈",sections:[],__args:args}))
}));
const body={dream:"오랜 친구와 공원을 걷는 꿈을 꿨어요.",instructions:"사용자의 궁금함에 먼저 답해주세요."};
function request(input=body,origin="http://localhost:3000") {
  return new Request("http://localhost:3000/api/prompt-lab",{method:"POST",headers:{"Content-Type":"application/json",origin},body:JSON.stringify(input)});
}
beforeEach(()=>{vi.stubEnv("NODE_ENV","development");vi.stubEnv("VERCEL","");vi.mocked(accessGatePassed).mockResolvedValue(true);});
afterEach(()=>{vi.clearAllMocks();vi.unstubAllEnvs();});

describe("prompt lab isolation and access",()=>{
  it("protects proposal requests with the same environment, gate and origin checks",async()=>{
    vi.stubEnv("NODE_ENV","production");
    expect((await propose(request())).status).toBe(404);
    vi.stubEnv("NODE_ENV","development");vi.mocked(accessGatePassed).mockResolvedValue(false);
    expect((await propose(request())).status).toBe(403);
    vi.mocked(accessGatePassed).mockResolvedValue(true);
    expect((await propose(request(body,"https://untrusted.test"))).status).toBe(403);
    expect(proposePromptEdit).not.toHaveBeenCalled();
  });
  it("returns a proposal without generating a new interpretation",async()=>{
    const response=await propose(new Request("http://localhost:3000/api/prompt-lab/propose",{method:"POST",headers:{origin:"http://localhost:3000","Content-Type":"application/json"},body:JSON.stringify({
      instructions:"질문에 답한다",resultInstructions:"장면을 설명한다",feedback:"조금 더 직접 답해주세요",dream:"친구와 걷는 꿈",result:"친구와 걷는 장면이에요.",memory:goalMemory
    })}));
    expect(response.status).toBe(200);
    expect(proposePromptEdit).toHaveBeenCalledOnce();
    expect(generateDetailedAssistant).not.toHaveBeenCalled();
    expect(promptLabArchive.record).toHaveBeenCalledWith("proposal_completed",expect.objectContaining({input:expect.objectContaining({feedback:"조금 더 직접 답해주세요"}),result:expect.objectContaining({instructions:"수정 지침"})}));
  });
  it("archives only sanitized proposal failure diagnostics and keeps the public error generic",async()=>{
    const diagnostic={stage:"provider",errorCode:"LOCAL_CODEX_INVALID_OUTPUT",attempts:2};
    const error=Object.assign(new AppError("PROMPT_PROPOSAL_FAILED","수정안을 2회 시도했지만 완성하지 못했어요 (LOCAL_CODEX_INVALID_OUTPUT). 현재 지침과 결과, 입력한 피드백은 유지돼요. 지침이나 바라는 변화를 구체적으로 다듬어 다시 요청해 주세요.",503),{diagnostic});
    vi.mocked(proposePromptEdit).mockRejectedValueOnce(error);
    const response=await propose(new Request("http://localhost:3000/api/prompt-lab/propose",{method:"POST",headers:{origin:"http://localhost:3000","Content-Type":"application/json"},body:JSON.stringify({
      instructions:"질문에 답한다",resultInstructions:"장면을 설명한다",feedback:"조금 더 직접 답해주세요",dream:"친구와 걷는 꿈",result:"친구와 걷는 장면이에요.",memory:goalMemory
    })}));
    expect(response.status).toBe(503);
    const responseText=await response.text();
    expect(responseText).not.toContain("private provider detail");
    expect(responseText).toContain("LOCAL_CODEX_INVALID_OUTPUT");
    expect(responseText).toContain("2회 시도");
    expect(promptLabArchive.record).toHaveBeenCalledWith("proposal_failed",expect.objectContaining({errorCode:"LOCAL_CODEX_INVALID_OUTPUT",proposalFailure:diagnostic}));
    expect(getPromptProposalFailureDiagnostics).toHaveBeenCalledWith(error);
  });
  it("returns a generic paid reading failure while archiving the error code",async()=>{
    const diagnostic={attempt:2,outcome:"provider_error",errorCode:"LOCAL_CODEX_INVALID_OUTPUT",outputIssue:{kind:"schema_mismatch",fields:["symbols.0.meaning"]}};
    const error=Object.assign(new AppError("PAID_GENERATION_FAILED","상세 풀이를 완성하지 못했어요. (확인 코드: safe-confirmation)",503),{diagnostic});
    vi.mocked(generateDetailedAssistant).mockRejectedValueOnce(error);
    const response=await POST(new Request("http://localhost:3000/api/prompt-lab",{method:"POST",headers:{origin:"http://localhost:3000","Content-Type":"application/json"},body:JSON.stringify({
      dream:"친구와 걷는 꿈",instructions:"장면의 의미를 설명한다",workspaceId:"f1234567-1234-1234-1234-123456789abc",experimentId:4
    })}));
    expect(response.status).toBe(503);
    const body=await response.json();
    expect(body.error.message).toContain("상세 풀이 생성 또는 검수를 완료하지 못했어요");
    expect(body.error.message).not.toContain("safe-confirmation");
    expect(promptLabArchive.record).toHaveBeenCalledWith("reading_failed",expect.objectContaining({errorCode:"PAID_GENERATION_FAILED",generationMode:"paid"}));
  });
  it("never exposes prompts or starts generation in production",async()=>{
    vi.stubEnv("NODE_ENV","production");
    expect((await GET(new Request("http://localhost:3000/api/prompt-lab"))).status).toBe(404);
    expect((await POST(request())).status).toBe(404);
    expect(generateDetailedAssistant).not.toHaveBeenCalled();
  });
  it("requires the app access gate on both endpoints",async()=>{
    vi.mocked(accessGatePassed).mockResolvedValue(false);
    expect((await GET(new Request("http://localhost:3000/api/prompt-lab"))).status).toBe(403);
    expect((await POST(request())).status).toBe(403);
    expect(generateDetailedAssistant).not.toHaveBeenCalled();
  });
  it("rejects cross-origin generation and empty instructions",async()=>{
    expect((await POST(request(body,"https://untrusted.test"))).status).toBe(403);
    expect((await POST(request({...body,instructions:" "}))).status).toBe(400);
    expect(generateDetailedAssistant).not.toHaveBeenCalled();
  });
  it("keeps immediate safety routing ahead of experimental instructions",async()=>{
    expect((await POST(request({...body,dream:"지금 나는 죽고 싶어요"}))).status).toBe(422);
    expect(prepareConsultation).not.toHaveBeenCalled();
    expect(generateDetailedAssistant).not.toHaveBeenCalled();
  });
  it("does not start AI when the durable request record cannot be written",async()=>{
    vi.mocked(promptLabArchive.record).mockRejectedValueOnce(new Error("disk full"));
    expect((await POST(request())).status).toBe(500);
    expect(generateDetailedAssistant).not.toHaveBeenCalled();
  });
  it("preserves the result and reports a warning if the completed archive write fails",async()=>{
    vi.mocked(promptLabArchive.record).mockResolvedValueOnce({id:"start",savedAt:"now",kind:"reading_started",data:{}}).mockRejectedValueOnce(new Error("disk full"));
    const response=await POST(request());
    expect(await response.json()).toMatchObject({payload:{directAnswer:"함께 걷는 꿈"},archiveWarning:expect.any(String)});
  });
  it("archives only the sanitized generation failure diagnostics for later Prompt Lab diagnosis",async()=>{
    const diagnostic={attempt:2,outcome:"rejected",errorCode:"AI_SYMBOL_UNFINISHED"};
    const error=Object.assign(new Error("private provider detail"),{diagnostic});
    vi.mocked(generateDetailedAssistant).mockRejectedValueOnce(error);
    const response=await POST(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private provider detail");
    expect(promptLabArchive.record).toHaveBeenCalledWith("reading_failed",expect.objectContaining({errorCode:"GENERATION_FAILED",generationMode:"paid"}));
  });
  it("passes the request-local prompt through the normal planner and leaves defaults intact",async()=>{
    const response=await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({promptApplied:true,payload:{generationSource:"codex"}});
    expect(promptLabArchive.record).toHaveBeenCalledWith("reading_started",expect.objectContaining({input:expect.objectContaining(body)}));
    expect(promptLabArchive.record).toHaveBeenCalledWith("reading_completed",expect.objectContaining({input:expect.objectContaining(body),result:expect.objectContaining({payload:expect.objectContaining({directAnswer:"함께 걷는 꿈"})})}));
    expect(prepareConsultation).toHaveBeenCalledOnce();
    expect(vi.mocked(generateDetailedAssistant).mock.calls[0][10]).toContain(body.instructions);
    const defaults=await GET(new Request("http://localhost:3000/api/prompt-lab"));
    expect((await defaults.json()).instructions).toBe(PAID_READING_PROMPT);
  });
});
