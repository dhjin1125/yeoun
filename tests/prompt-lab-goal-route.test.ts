import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { POST } from "@/app/api/prompt-lab/goal/route";
import { POST as propose } from "@/app/api/prompt-lab/propose/route";
import { accessGatePassed } from "@/lib/access-gate";
import { discussPromptGoal,proposePromptEdit } from "@/lib/ai";
import { promptLabArchive } from "@/lib/prompt-lab-archive";
import { goalAgreement } from "./helpers/prompt-goal";

vi.mock("@/lib/access-gate",()=>({accessGatePassed:vi.fn(async()=>true)}));
vi.mock("@/lib/session",()=>({getOrCreateDreamSession:vi.fn(async()=>({hash:"goal-test"}))}));
vi.mock("@/lib/ai",()=>({discussPromptGoal:vi.fn(),proposePromptEdit:vi.fn()}));
vi.mock("@/lib/prompt-lab-archive",()=>({promptLabArchive:{record:vi.fn(async()=>({id:"record",savedAt:"now"}))},labModelSettings:()=>({provider:"codex",model:"configured-editor",reasoningEffort:"medium"})}));
const input={workspaceId:goalAgreement.id,draft:goalAgreement.draft,answers:[],reference:goalAgreement.reference,previousAgreement:null,decisions:[]};
const request=(body:unknown=input,origin="http://localhost:3000")=>new Request("http://localhost:3000/api/prompt-lab/goal",{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
beforeEach(()=>{
  vi.stubEnv("NODE_ENV","development");vi.stubEnv("VERCEL","");
  vi.mocked(accessGatePassed).mockResolvedValue(true);vi.mocked(discussPromptGoal).mockResolvedValue(goalAgreement.brief);
});
afterEach(()=>{vi.clearAllMocks();vi.unstubAllEnvs();});
describe("목표 확인과 저장",()=>{
  it("protects goal conversations with environment, access and origin checks",async()=>{
    vi.stubEnv("NODE_ENV","production");expect((await POST(request())).status).toBe(404);
    vi.stubEnv("NODE_ENV","development");vi.mocked(accessGatePassed).mockResolvedValue(false);expect((await POST(request())).status).toBe(403);
    vi.mocked(accessGatePassed).mockResolvedValue(true);expect((await POST(request(input,"https://other.test"))).status).toBe(403);
    expect(discussPromptGoal).not.toHaveBeenCalled();expect(promptLabArchive.record).not.toHaveBeenCalled();
  });
  it("requires answers before discussing a goal and an agreement before proposing",async()=>{
    expect((await POST(request({...input,draft:{wish:"",keep:"",avoid:""}}))).status).toBe(400);
    const proposal=await propose(request({instructions:"기존 지침",resultInstructions:"기존 지침",feedback:"고쳐요",dream:"친구와 산책",result:"친구와 산책하는 장면"}));
    expect(proposal.status).toBe(400);
    expect(discussPromptGoal).not.toHaveBeenCalled();expect(proposePromptEdit).not.toHaveBeenCalled();
  });
  it("archives the questions, answers, full result and settings without approving or editing",async()=>{
    const response=await POST(request());expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({brief:goalAgreement.brief,archiveId:"record"});
    expect(promptLabArchive.record).toHaveBeenCalledWith("goal_started",expect.objectContaining({input,settings:expect.objectContaining({model:"configured-editor"})}));
    expect(promptLabArchive.record).toHaveBeenCalledWith("goal_completed",expect.objectContaining({input,result:expect.objectContaining({brief:goalAgreement.brief})}));
    expect(proposePromptEdit).not.toHaveBeenCalled();
  });
  it("does not call AI if the initial durable record fails",async()=>{
    vi.mocked(promptLabArchive.record).mockRejectedValueOnce(new Error("disk full"));
    expect((await POST(request())).status).toBe(500);expect(discussPromptGoal).not.toHaveBeenCalled();
  });
  it("preserves the discussion response and warns if the completion cannot be saved",async()=>{
    vi.mocked(promptLabArchive.record).mockResolvedValueOnce({id:"start",savedAt:"now",kind:"goal_started",data:{}}).mockRejectedValueOnce(new Error("disk full"));
    const response=await POST(request());expect(await response.json()).toMatchObject({brief:goalAgreement.brief,archiveWarning:expect.any(String)});
  });
});
