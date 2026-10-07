import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateWithLocalCodex } from "@/lib/ai/codex-local";

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});

function setup() {
  vi.stubEnv("APP_PROFILE","local-ai");
  vi.stubEnv("VERCEL","");
  vi.stubEnv("CODEX_BRIDGE_URL","https://bridge.invalid");
  vi.stubEnv("CODEX_BRIDGE_TOKEN","test-only-placeholder");
  vi.stubEnv("CODEX_LOCAL_TIMEOUT_MS","300000");
  return {operation:"analysis" as const,instructions:"입력 분류",inputJson:"{}",schema:z.object({ready:z.boolean()}),schemaName:"repair_timeout"};
}

describe("bounded fact-check repair timeout",()=> {
  it("caps the repair bridge job without changing the normal configured timeout",async()=> {
    const input=setup();
    const fetchMock=vi.fn(async(_url: string,_init: RequestInit)=>new Response(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:'{"ready":true}'}})+"\n"));
    vi.stubGlobal("fetch",fetchMock);
    await expect(generateWithLocalCodex({...input,timeoutCapMs:30_000})).resolves.toEqual({ready:true});
    await expect(generateWithLocalCodex(input)).resolves.toEqual({ready:true});
    const calls=fetchMock.mock.calls;
    expect(JSON.parse(String(calls[0][1].body)).timeoutMs).toBe(30_000);
    expect(JSON.parse(String(calls[1][1].body)).timeoutMs).toBe(300_000);
    expect(process.env.CODEX_LOCAL_TIMEOUT_MS).toBe("300000");
  });
  it("aborts a stalled repair at the cap and does not start another bridge request",async()=> {
    vi.useFakeTimers();
    const input=setup();
    const fetchMock=vi.fn((_url: string,init: RequestInit)=>new Promise<Response>((_resolve,reject)=> {
      init.signal?.addEventListener("abort",()=>reject(new DOMException("aborted","AbortError")),{once:true});
    }));
    vi.stubGlobal("fetch",fetchMock);
    const request=generateWithLocalCodex({...input,timeoutCapMs:30_000});
    const rejected=expect(request).rejects.toMatchObject({code:"LOCAL_CODEX_TIMEOUT"});
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});


describe("request-local model routing",()=>{
  it("uses Astra medium for an override and Luna high for the next reading without leaking overrides",async()=>{
    const input=setup();
    vi.stubEnv("CODEX_LOCAL_MODEL","gpt-6-luna");
    vi.stubEnv("CODEX_LOCAL_REASONING_EFFORT","high");
    vi.stubEnv("CODEX_LOCAL_FREE_REASONING_EFFORT","");
    vi.stubEnv("CODEX_LOCAL_ANALYSIS_REASONING_EFFORT","low");
    const fetchMock=vi.fn(async(_url:string,_init:RequestInit)=>new Response(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:'{"ready":true}'}})+"\n"));
    vi.stubGlobal("fetch",fetchMock);
    await generateWithLocalCodex({...input,model:"gpt-6-astra",reasoningEffort:"medium"});
    await generateWithLocalCodex({...input,operation:"free"});
    await generateWithLocalCodex(input);
    const sent=fetchMock.mock.calls.map(call=>JSON.parse(String(call[1].body)));
    expect(sent[0]).toMatchObject({model:"gpt-6-astra",reasoningEffort:"medium"});
    expect(sent[1]).toMatchObject({model:"gpt-6-luna",reasoningEffort:"high"});
    expect(sent[2]).toMatchObject({model:"gpt-6-luna",reasoningEffort:"low"});
  });
});
