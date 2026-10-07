import { expect, it } from "vitest";
import { readFile, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { detailedQualityError } from "../lib/ai";
import { detailedAssistantSchema, reportReviewSchema } from "../lib/ai/schemas";
import { generateWithLocalCodex } from "../lib/ai/codex-local";
import { resolveReadingSources } from "../lib/cultural-references";
import { PAID_READING_PROMPT } from "../lib/ai/prompts";
const root=join(process.cwd(),".data/prompt-lab/paid-improvement");
const sourcePath=join(root,"paid-v521-independent-673b0844-5206-4fea-a6ae-6657782fdebc.completed.json");
async function writePrivate(path:string,record:unknown){const h=await open(path,"wx",0o600);try{await h.writeFile(JSON.stringify(record));}finally{await h.close();}}
it("runs one v5.22 counterfactual paid repair and one fixed review",async()=>{
  loadEnvConfig(process.cwd());
  const source=JSON.parse(await readFile(sourcePath,"utf8"));
  const sourceProviderCalls=[] as any[];
  for(const id of source.providerCallIds) sourceProviderCalls.push(JSON.parse(await readFile(join(root,`paid-v521-provider-${id}.completed.json`),"utf8")));
  const writerCall=sourceProviderCalls.find((x:any)=>x.schemaName==="dream_detailed_answer");
  const firstReviewCall=sourceProviderCalls.find((x:any)=>x.schemaName==="dream_report_review");
  if(!writerCall||!firstReviewCall||firstReviewCall.result.approved!==false)throw new Error("FROZEN_SOURCE_REVIEW_NOT_FOUND");
  const writerInput=JSON.parse(writerCall.inputJson);
  const firstReviewInput=JSON.parse(firstReviewCall.inputJson);
  writerInput.previousReport=firstReviewInput.report;
  writerInput.revisionRequest=`AI_DETAILED_REVIEW:${JSON.stringify(firstReviewCall.result)}`;
  const trialId=randomUUID();const writerCallId=randomUUID();const settings={model:"gpt-6-luna",reasoningEffort:"high",appProfile:"local-ai",aiMode:"codex"};
  const common={immutable:true,type:"paid_counterfactual_repair_negation_review",version:"v5.22",trialId,parentTrialId:source.trialId,sourceWriterProviderCallId:writerCall.providerCallId,sourceReviewProviderCallId:firstReviewCall.providerCallId,counterfactualOnly:true,transformation:"One writer repair from frozen first draft and exact reviewer feedback; fixed reviewer once; no automatic further repair.",input:source.input,instructions:{writer:PAID_READING_PROMPT,reviewer:firstReviewCall.instructions},settings,startedAt:new Date().toISOString()};
  await mkdir(root,{recursive:true,mode:0o700});await writePrivate(join(root,`paid-v522-repair-${trialId}.started.json`),{...common,status:"started",providerCallIds:[writerCallId]});
  const paidInputJson=JSON.stringify(writerInput);
  const writerCommon={immutable:true,type:"paid_v522_provider_call",trialId,providerCallId:writerCallId,operation:"detailed",schemaName:"dream_detailed_answer",instructions:PAID_READING_PROMPT,inputJson:paidInputJson,model:settings.model,reasoningEffort:settings.reasoningEffort,startedAt:new Date().toISOString()};
  await writePrivate(join(root,`paid-v522-provider-${writerCallId}.started.json`),{...writerCommon,status:"started"});
  let writerResult:any;let localError:string|null=null;let review:any=null;let reviewerCallId:string|null=null;let terminal="";
  try{
    writerResult=await generateWithLocalCodex({operation:"detailed",instructions:PAID_READING_PROMPT,inputJson:paidInputJson,schema:detailedAssistantSchema,schemaName:"dream_detailed_answer",model:settings.model,reasoningEffort:settings.reasoningEffort});
    await writePrivate(join(root,`paid-v522-provider-${writerCallId}.completed.json`),{...writerCommon,status:"completed",endedAt:new Date().toISOString(),result:writerResult});
  }catch(error){
    const errorCode=error&&typeof error==="object"&&"code" in error?String((error as {code:unknown}).code):error instanceof Error?error.name:"UNKNOWN";
    await writePrivate(join(root,`paid-v522-provider-${writerCallId}.completed.json`),{...writerCommon,status:"provider_error",endedAt:new Date().toISOString(),errorCode});terminal=errorCode;
  }
  if(writerResult){
    const dreamInput=source.input;const context=writerInput.dreamContext;const offer=writerInput.paidOffer;
    const sources=resolveReadingSources(writerResult.referenceIds,writerInput.culturalReferences);
    if(!sources)localError="AI_DETAILED_UNGROUNDED_SOURCE";
    else{
      const sections=writerResult.sections.length===offer.cards.length&&writerResult.sections.every((s:{title:string},i:number)=>s.title===offer.cards[i]?.title)
        ?writerResult.sections.map((s:object,i:number)=>({...s,title:offer.cards[i]!.promisedSectionTitle})):writerResult.sections;
      const hasNew=dreamInput.clarificationAnswers.some((a:{skipped:boolean;answer?:string|null})=>!a.skipped&&!/^(?:잘\s*)?(?:기억(?:이|나지|은)?\s*(?:안\s*나|않|없)|모르겠|잘\s*모르)/.test(a.answer??""));
      const payload={...writerResult,sections,interpretationChanges:hasNew?writerResult.interpretationChanges:null,sources,qualityVersion:2 as const,uncertainty:[],generationSource:"codex" as const};
      const additional=[dreamInput.selectedEmotion??"",...(dreamInput.clarificationAnswers??[]).filter((a:{skipped:boolean;answer?:string|null})=>!a.skipped&&a.answer).map((a:{answer:string})=>a.answer)].filter(Boolean).join(" ");
      localError=detailedQualityError(payload,offer,dreamInput.dream,context,additional);
      if(!localError){
        reviewerCallId=randomUUID();
        const reviewJson=JSON.stringify({readingContext:writerInput.readingContext,consultationPlan:writerInput.consultationPlan,culturalReferences:writerInput.culturalReferences,priorFree:writerInput.priorFree,paidOffer:offer,report:payload});
        const reviewerCommon={immutable:true,type:"paid_v522_provider_call",trialId,providerCallId:reviewerCallId,operation:"analysis",schemaName:"dream_report_review",instructions:firstReviewCall.instructions,inputJson:reviewJson,model:settings.model,reasoningEffort:settings.reasoningEffort,startedAt:new Date().toISOString()};
        await writePrivate(join(root,`paid-v522-provider-${reviewerCallId}.started.json`),{...reviewerCommon,status:"started"});
        try{review=await generateWithLocalCodex({operation:"analysis",instructions:firstReviewCall.instructions,inputJson:reviewJson,schema:reportReviewSchema,schemaName:"dream_report_review",model:settings.model,reasoningEffort:settings.reasoningEffort});await writePrivate(join(root,`paid-v522-provider-${reviewerCallId}.completed.json`),{...reviewerCommon,status:"completed",endedAt:new Date().toISOString(),result:review});}
        catch(error){const errorCode=error&&typeof error==="object"&&"code" in error?String((error as {code:unknown}).code):error instanceof Error?error.name:"UNKNOWN";await writePrivate(join(root,`paid-v522-provider-${reviewerCallId}.completed.json`),{...reviewerCommon,status:"provider_error",endedAt:new Date().toISOString(),errorCode});terminal=errorCode;}
      }
    }
  }
  const outcome=terminal?{status:"provider_error",errorCode:terminal}:localError?{status:"blocked_on_local_gate",errorCode:localError}:review?{status:review.approved?"review_approved":"review_rejected",errorCode:null}:{status:"no_review",errorCode:null};
  const providerCallIds=reviewerCallId?[writerCallId,reviewerCallId]:[writerCallId];
  await writePrivate(join(root,`paid-v522-repair-${trialId}.completed.json`),{...common,...outcome,endedAt:new Date().toISOString(),providerCallIds,localQualityError:localError,writerResult:writerResult??null,reviewResult:review});
  console.info(JSON.stringify({event:"paid_v522_counterfactual_repair",trialId,status:outcome.status,errorCode:outcome.errorCode,review:review?{approved:review.approved,invented:review.inventedFacts.length,missing:review.missingElements.length,unsupportedSequenceOrRole:review.unsupportedSequenceOrRole,headlineAnswered:review.headlineAnswered,coverage:`${review.offerCoverage.filter((x:{fulfilled:boolean})=>x.fulfilled).length}/${review.offerCoverage.length}`} :null}));
  expect(["provider_error","blocked_on_local_gate","review_approved","review_rejected","no_review"]).toContain(outcome.status);
},360_000);
