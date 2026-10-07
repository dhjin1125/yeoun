import { expect, it, vi } from "vitest";
import { readFile, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import * as codex from "../lib/ai/codex-local";
import { PAID_READING_PROMPT, REPORT_REVIEW_PROMPT } from "../lib/ai/prompts";
const root=join(process.cwd(),".data/prompt-lab/paid-improvement");
async function writePrivate(path:string,record:unknown){const h=await open(path,"wx",0o600);try{await h.writeFile(JSON.stringify(record));}finally{await h.close();}}
it("runs one v5.21 independent three-card reality holdout",async()=>{
  loadEnvConfig(process.cwd());
  const source=JSON.parse(await readFile(join(root,"paid-v519-independent-70fd3fa7-b8af-4c76-9e36-99ba0af4e279.completed.json"),"utf8"));
  const base=JSON.parse(source.providerCalls[0].inputJson);const trialId=randomUUID();const ids:string[]=[];const results:Array<{schemaName:string;result:any}>=[];
  const settings={model:"gpt-6-luna",reasoningEffort:"high",appProfile:"local-ai",aiMode:"codex"};
  const common={immutable:true,type:"paid_independent_reality_holdout_generation",version:"v5.21",trialId,parentTrialId:source.trialId,fixtureKind:"historical_three_card_narrative_role_place_reality_holdout",promptVariant:"direct_answer_concise_no_sequence_but_preserve_transition",reviewerVariant:"fixed_report_review_prompt",input:source.input,instructions:{writer:PAID_READING_PROMPT,reviewer:REPORT_REVIEW_PROMPT},settings,startedAt:new Date().toISOString()};
  await mkdir(root,{recursive:true,mode:0o700});await writePrivate(join(root,`paid-v521-independent-${trialId}.started.json`),{...common,status:"started",providerCallIds:ids});
  const original=codex.generateWithLocalCodex.bind(codex);
  const spy=vi.spyOn(codex,"generateWithLocalCodex").mockImplementation(async(request:Parameters<typeof codex.generateWithLocalCodex>[0])=>{
    const id=randomUUID();ids.push(id);const call={immutable:true,type:"paid_v521_provider_call",trialId,providerCallId:id,operation:request.operation,schemaName:request.schemaName,instructions:request.instructions,inputJson:request.inputJson,model:request.model??settings.model,reasoningEffort:request.reasoningEffort??settings.reasoningEffort,startedAt:new Date().toISOString()};
    await writePrivate(join(root,`paid-v521-provider-${id}.started.json`),{...call,status:"started"});
    try{const result=await original(request);results.push({schemaName:request.schemaName,result});await writePrivate(join(root,`paid-v521-provider-${id}.completed.json`),{...call,status:"completed",endedAt:new Date().toISOString(),result});return result;}
    catch(error){const errorCode=error&&typeof error==="object"&&"code" in error?String((error as {code:unknown}).code):error instanceof Error?error.name:"UNKNOWN";await writePrivate(join(root,`paid-v521-provider-${id}.completed.json`),{...call,status:"provider_error",endedAt:new Date().toISOString(),errorCode});throw error;}
  });
  let outcome:Record<string,unknown>;
  try{const {generateDetailedAssistant}=await import("../lib/ai");const result=await generateDetailedAssistant({...base.dreamContext,consultation:base.consultationPlan},`paid-v521-${trialId}`,"none",source.input.dream,{selectedEmotion:source.input.selectedEmotion??null,clarificationAnswers:source.input.clarificationAnswers??[]},undefined,base.priorFree??undefined);outcome={status:"approved",result};}
  catch(error){const errorCode=error&&typeof error==="object"&&"code" in error?String((error as {code:unknown}).code):error instanceof Error?error.name:"UNKNOWN";outcome={status:"failed",errorCode};}
  finally{spy.mockRestore();}
  await writePrivate(join(root,`paid-v521-independent-${trialId}.completed.json`),{...common,...outcome,endedAt:new Date().toISOString(),providerCallIds:ids});
  const review=[...results].reverse().find(x=>x.schemaName==="dream_report_review")?.result;
  console.info(JSON.stringify({event:"paid_v521_independent_reality_holdout",trialId,status:outcome.status,errorCode:outcome.errorCode??null,providerCallCount:ids.length,review:review?{approved:review.approved,invented:review.inventedFacts.length,missing:review.missingElements.length,redundant:review.redundantInterpretation,unsupportedSequenceOrRole:review.unsupportedSequenceOrRole,usesOmissionAsFact:review.usesOmissionAsFact,addsValueBeyondFree:review.addsValueBeyondFree,correctionApplied:review.correctionApplied,headlineAnswered:review.headlineAnswered,offerCoverage:`${review.offerCoverage.filter((x:{fulfilled:boolean})=>x.fulfilled).length}/${review.offerCoverage.length}`} :null}));
  expect(ids.length).toBeGreaterThan(0);
},360_000);
