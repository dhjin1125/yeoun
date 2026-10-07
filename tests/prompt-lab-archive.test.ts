import { afterEach,beforeEach,describe,it,expect,vi } from "vitest";
import { mkdtemp,rm,readdir,stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PromptLabArchive,labModelSettings } from "@/lib/prompt-lab-archive";
let directory:string;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),"lab-archive-test-"));});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});vi.unstubAllEnvs();});
describe("durable local experiment archive",()=>{
  it("retains concurrent snapshots and reloads complete history after recreating the store",async()=>{
    const store=new PromptLabArchive(directory);
    const history={draft:{instructions:"지침 원문"},runs:[{id:6,payload:{directAnswer:"풀이 6"}},{id:7,payload:{directAnswer:"풀이 7"}}],approvals:[{feedback:"질문에 먼저 답하기"}],workingId:6};
    const records=await Promise.all([store.record("snapshot",{history}),store.record("snapshot",{history:{...history,workingId:7}})]);
    expect(new Set(records.map(item=>item.id)).size).toBe(2);
    const reopened=new PromptLabArchive(directory);
    expect((await reopened.read(records[0].id)).data.history).toEqual(history);
    expect((await reopened.list()).map(item=>item.runIds)).toEqual([[6,7],[6,7]]);
    expect(await readdir(directory)).toHaveLength(2);
    expect((await stat(join(directory,`${records[0].id}.json`))).mode & 0o777).toBe(0o600);
  });
  it("rejects traversal and fails visibly on an unwritable archive",async()=>{
    const store=new PromptLabArchive(directory);
    await expect(store.read("../../.env.local")).rejects.toMatchObject({code:"LAB_ARCHIVE_NOT_FOUND"});
    const record=await store.record("reading_started",{input:{dream:"합성 꿈",instructions:"합성 지침"}});
    const invalid=new PromptLabArchive(join(directory,`${record.id}.json`));
    await expect(invalid.record("reading_completed",{})).rejects.toMatchObject({code:"LAB_ARCHIVE_FAILED"});
    expect((await store.read(record.id)).kind).toBe("reading_started");
  });
  it("records separate generation and proposal settings without secrets",()=>{
    vi.stubEnv("APP_PROFILE","local-ai");vi.stubEnv("CODEX_LOCAL_MODEL","gpt-6-luna");vi.stubEnv("CODEX_LOCAL_REASONING_EFFORT","high");
    vi.stubEnv("CODEX_LOCAL_FREE_REASONING_EFFORT","");vi.stubEnv("CODEX_LOCAL_ANALYSIS_REASONING_EFFORT","low");
    vi.stubEnv("CODEX_LOCAL_PROMPT_EDIT_MODEL","gpt-6-astra");vi.stubEnv("CODEX_LOCAL_PROMPT_EDIT_REASONING_EFFORT","medium");
    expect(labModelSettings()).toMatchObject({model:"gpt-6-luna",reasoningEffort:"high"});
    expect(labModelSettings(true)).toMatchObject({model:"gpt-6-astra",reasoningEffort:"medium"});
    expect(Object.keys(labModelSettings())).toEqual(["provider","model","reasoningEffort","analysisReasoningEffort"]);
  });
});
