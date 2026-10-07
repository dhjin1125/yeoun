import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { GET,POST } from "@/app/api/prompt-lab/archive/route";
import { accessGatePassed } from "@/lib/access-gate";
import { promptLabArchive } from "@/lib/prompt-lab-archive";
vi.mock("@/lib/access-gate",()=>({accessGatePassed:vi.fn(async()=>true)}));
vi.mock("@/lib/prompt-lab-archive",()=>({promptLabArchive:{record:vi.fn(async()=>({id:"saved",savedAt:"now"})),list:vi.fn(async()=>[]),read:vi.fn(async()=>({}))},historyDigest:()=>"digest"}));
const body={workspaceId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",history:{version:3,draft:{dream:"기록",emotion:null,instructions:"지침"},runs:[]}};
const request=(input:unknown=body,origin="http://localhost:3000")=>new Request("http://localhost:3000/api/prompt-lab/archive",{method:"POST",headers:{origin},body:JSON.stringify(input)});
beforeEach(()=>{vi.stubEnv("NODE_ENV","development");vi.stubEnv("VERCEL","");vi.mocked(accessGatePassed).mockResolvedValue(true);});
afterEach(()=>{vi.clearAllMocks();vi.unstubAllEnvs();});
describe("archive access and snapshot validation",()=>{
  it("gates reads and writes before touching private records",async()=>{
    vi.stubEnv("NODE_ENV","production");expect((await GET(request())).status).toBe(404);expect((await POST(request())).status).toBe(404);
    vi.stubEnv("NODE_ENV","development");vi.mocked(accessGatePassed).mockResolvedValue(false);
    expect((await GET(request())).status).toBe(403);expect((await POST(request())).status).toBe(403);
    vi.mocked(accessGatePassed).mockResolvedValue(true);expect((await POST(request(body,"https://other.test"))).status).toBe(403);
    expect(promptLabArchive.record).not.toHaveBeenCalled();expect(promptLabArchive.list).not.toHaveBeenCalled();
  });
  it("validates saved history and never accepts client-selected file paths",async()=>{
    expect((await POST(request({...body,history:{}}))).status).toBe(400);
    expect(promptLabArchive.record).not.toHaveBeenCalled();
    expect((await POST(request({...body,path:"../../.env.local"}))).status).toBe(200);
    expect(promptLabArchive.record).toHaveBeenCalledWith("snapshot",expect.objectContaining({workspaceId:body.workspaceId,history:expect.objectContaining({draft:body.history.draft})}));
    expect(vi.mocked(promptLabArchive.record).mock.calls[0][1]).not.toHaveProperty("path");
  });
});
