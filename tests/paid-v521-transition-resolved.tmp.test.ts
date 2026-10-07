import { expect, it, vi } from "vitest";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import * as codex from "../lib/ai/codex-local";
import { PAID_READING_PROMPT, REPORT_REVIEW_PROMPT } from "../lib/ai/prompts";
import { analyzeDreamContextLocally } from "../lib/local-engine";
import { buildConsultationOffer, buildConsultationPlan } from "../lib/consultation";
const archiveDir=join(process.cwd(),".data/prompt-lab/paid-improvement");
async function writePrivate(path:string,record:unknown){const h=await open(path,"wx",0o600);try{await h.writeFile(JSON.stringify(record));}finally{await h.close();}}
it("runs one identity-resolved explicit transition question",async()=>{
  loadEnvConfig(process.cwd());
  const dream="꿈에서 복도를 달려 남성인 친구 민수에게서 도망쳤어요. 잠시 멈춘 뒤 뒤돌아 민수에게 다시 다가갔고, 처음엔 두려웠지만 다가간 뒤에는 안도했어요.";
  const question="왜 도망치다가 다시 다가갔을까요?";
  const context=analyzeDreamContextLocally(dream,null).context;
  context.userQuestions=[question];context.consultation=buildConsultationPlan(context);
  const offer=buildConsultationOffer(context,context.consultation);
  if(!context.consultation.ready||!offer.headline.includes(question.slice(0,-1)))throw new Error("TRANSITION_FIXTURE_NOT_READY");
  const trialId=randomUUID();const callIds:string[]=[];const callResults:Array<{schemaName:string;result:any}>=[];
  const settings={model:"gpt-6-luna",reasoningEffort:"high",appProfile:"local-ai",aiMode:"codex"};
  const common={immutable:true,type:"paid_v521_identity_resolved_transition_trial",version:"v5.21",trialId,parentTrialId:"6ac0f402-37b5-4963-b2bc-3e502b20f560",fixtureKind:"synthetic_explicit_transition_named_friend",promptVariant:"direct_answer_concise_no_sequence_but_preserve_transition",reviewerVariant:"fixed_report_review_prompt",input:{dream,selectedEmotion:null,clarificationAnswers:[],priorFree:null,completionRequest:question},instructions:{writer:PAID_READING_PROMPT,reviewer:REPORT_REVIEW_PROMPT},settings,startedAt:new Date().toISOString()};
  await mkdir(archiveDir,{recursive:true,mode:0o700});await writePrivate(join(archiveDir,`paid-v521-${trialId}.started.json`),{...common,status:"started",providerCallIds:callIds});
  const original=codex.generateWithLocalCodex.bind(codex);
  const spy=vi.spyOn(codex,"generateWithLocalCodex").mockImplementation(async(request:Parameters<typeof codex.generateWithLocalCodex>[0])=>{
    const providerCallId=randomUUID();callIds.push(providerCallId);
    const callCommon={immutable:true,type:"paid_v521_provider_call",trialId,providerCallId,operation:request.operation,schemaName:request.schemaName,instructions:request.instructions,inputJson:request.inputJson,model:request.model??settings.model,reasoningEffort:request.reasoningEffort??settings.reasoningEffort,startedAt:new Date().toISOString()};
    await writePrivate(join(archiveDir,`paid-v521-provider-${providerCallId}.started.json`),{...callCommon,status:"started"});
    try{const result=await original(request);callResults.push({schemaName:request.schemaName,result});await writePrivate(join(archiveDir,`paid-v521-provider-${providerCallId}.completed.json`),{...callCommon,status:"completed",endedAt:new Date().toISOString(),result});return result;}
    catch(error){const errorCode=error&&typeof error==="object"&&"code" in error?String((error as {code:unknown}).code):error instanceof Error?error.name:"UNKNOWN";await writePrivate(join(archiveDir,`paid-v521-provider-${providerCallId}.completed.json`),{...callCommon,status:"provider_error",endedAt:new Date().toISOString(),errorCode});throw error;}
  });
  let outcome:Record<string,unknown>;
  try{const {generateDetailedAssistant}=await import("../lib/ai");const result=await generateDetailedAssistant(context,`paid-v521-${trialId}`,"none",dream,{selectedEmotion:null,clarificationAnswers:[]},undefined,undefined,question);outcome={status:"approved",result};}
  catch(error){const errorCode=error&&typeof error==="object"&&"code" in error?String((error as {code:unknown}).code):error instanceof Error?error.name:"UNKNOWN";outcome={status:"failed",errorCode};}
  finally{spy.mockRestore();}
  await writePrivate(join(archiveDir,`paid-v521-${trialId}.completed.json`),{...common,...outcome,endedAt:new Date().toISOString(),providerCallIds:callIds});
  const review=[...callResults].reverse().find(x=>x.schemaName==="dream_report_review")?.result;
  console.info(JSON.stringify({event:"paid_v521_identity_resolved_transition",trialId,status:outcome.status,errorCode:outcome.errorCode??null,providerCallCount:callIds.length,review:review?{approved:review.approved,invented:review.inventedFacts.length,missing:review.missingElements.length,redundant:review.redundantInterpretation,headlineAnswered:review.headlineAnswered,coverage:`${review.offerCoverage.filter((x:{fulfilled:boolean})=>x.fulfilled).length}/${review.offerCoverage.length}`} :null}));
  expect(callIds.length).toBeGreaterThan(0);
},360_000);
