/** Opt-in, bounded analysis reproduction. Full inputs/outputs stay in the private archive. */
import { expect, it, vi } from "vitest";
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { prepareConsultation, generateFreeAssistant } from "@/lib/ai";
import { analyzeDreamContextLocally } from "@/lib/local-engine";
import { buildConsultationPlan } from "@/lib/consultation";
const capture = vi.hoisted(() => ({root:"",sequence:0}));
vi.mock("@/lib/ai/codex-local",async importOriginal => {
  const real = await importOriginal<typeof import("@/lib/ai/codex-local")>();
  return {...real,generateWithLocalCodex:async (request:Parameters<typeof real.generateWithLocalCodex>[0]) => {
    const id=++capture.sequence;
    const save=(stage:string,data:unknown)=>writeFileSync(`${capture.root}/${id}-${stage}.json`,JSON.stringify(data),{flag:"wx",mode:0o600});
    save("request",{instructions:request.instructions,input:JSON.parse(request.inputJson),operation:request.operation,schemaName:request.schemaName});
    try {const result=await real.generateWithLocalCodex(request);save("response",result);return result;}
    catch(error){save("error",{code:error instanceof real.LocalCodexError?error.code:"PROVIDER_ERROR"});throw error;}
  }};
});
it.skipIf(process.env.RUN_FACT_ANALYSIS_EVAL!=="true")("checks the previously failing analysis using production model settings",async()=>{
  loadEnvConfig(process.cwd());
  Object.assign(process.env,{APP_PROFILE:"local-ai",AI_MODE:"codex",PAYMENTS_MODE:"mock",CODEX_LOCAL_MODEL:"gpt-5.6-luna",CODEX_LOCAL_REASONING_EFFORT:"max",CODEX_LOCAL_ANALYSIS_MODEL:"gpt-6-luna",CODEX_LOCAL_ANALYSIS_REASONING_EFFORT:"low",CODEX_LOCAL_FREE_MODEL:"gpt-6-luna",CODEX_LOCAL_FREE_REASONING_EFFORT:"high",CODEX_LOCAL_TIMEOUT_MS:"300000"});
  if(process.env.FACT_ANALYSIS_INCLUDE_FREE==="true") {
    const path=process.env.PAID_EVAL_FREE_RELEASE;
    if(!path) throw new Error("APPROVED_RELEASE_PATH_REQUIRED");
    const release=JSON.parse(readFileSync(path,"utf8"));
    if(release.experimentId!==73) throw new Error("APPROVED_RELEASE_73_REQUIRED");
    process.env.FREE_READING_PROMPT_FILE=path;
    process.env.FREE_READING_PROMPT_SHA256=createHash("sha256").update(release.instructions).digest("hex");
  }
  capture.root=`.data/prompt-lab/fact-analysis-eval/${randomUUID()}`;capture.sequence=0;mkdirSync(capture.root,{recursive:true,mode:0o700});
  const manifest=JSON.parse(readFileSync(".data/prompt-lab/paid-recovery-eval/2c67e189-9f22-474b-abba-4070578136fb/manifest.json","utf8"));
  const input=manifest.cases.find((c:{name:string})=>c.name==="assessment");
  const evidence={selectedEmotion:null,clarificationAnswers:input.answers};
  const context=analyzeDreamContextLocally(input.dream,null).context;
  writeFileSync(`${capture.root}/input.json`,JSON.stringify({input,evidence,context,localPlan:buildConsultationPlan(context,input.answers),settings:Object.fromEntries(["CODEX_LOCAL_ANALYSIS_MODEL","CODEX_LOCAL_ANALYSIS_REASONING_EFFORT","CODEX_LOCAL_FREE_MODEL","CODEX_LOCAL_FREE_REASONING_EFFORT","CODEX_LOCAL_TIMEOUT_MS","FREE_READING_PROMPT_SHA256"].map(key=>[key,process.env[key]??null]))}),{flag:"wx",mode:0o600});
  let success=false;let freeSuccess:boolean|null=null;
  try {
    const plan=await prepareConsultation(context,input.dream,evidence,"fact-analysis-repro");
    writeFileSync(`${capture.root}/plan.json`,JSON.stringify(plan),{flag:"wx",mode:0o600});
    expect(plan.ready).toBe(true);expect(plan.question).toBeNull();success=true;
    if(process.env.FACT_ANALYSIS_INCLUDE_FREE==="true") {
      const result=await generateFreeAssistant({...context,consultation:plan},"fact-analysis-free",input.dream,evidence);
      writeFileSync(`${capture.root}/free.json`,JSON.stringify(result),{flag:"wx",mode:0o600});
      expect(result.generationSource).toBe("codex");expect(result.directAnswer.length).toBeGreaterThan(0);freeSuccess=true;
    }
  }finally{console.info(JSON.stringify({event:"fact_analysis_eval",success,freeSuccess,calls:capture.sequence,archive:capture.root}));}
},360000);
