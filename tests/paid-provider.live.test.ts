import {it,expect} from 'vitest';
import {generateWithLocalCodex,LocalCodexError} from '@/lib/ai/codex-local';
import {z} from 'zod';
import {detailedAssistantSchema} from '@/lib/ai/schemas';
import {PAID_READING_PROMPT} from '@/lib/ai/prompts';
import {loadEnvConfig} from '@next/env';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
it.skipIf(process.env.RUN_PAID_PROVIDER_PROBE !== 'true')('checks the production paid model transport with a synthetic response',async()=>{
 loadEnvConfig(process.cwd(),true);
 process.env.APP_PROFILE='local-ai';
 process.env.CODEX_LOCAL_TIMEOUT_MS='300000';
 const path=`.data/prompt-lab/paid-provider-probe/${randomUUID()}.json`;
 await mkdir('.data/prompt-lab/paid-provider-probe',{recursive:true,mode:0o700});
 try{
 const paidInput=process.env.PAID_PROVIDER_INPUT?await readFile(process.env.PAID_PROVIDER_INPUT,'utf8'):null;
 const result=await generateWithLocalCodex({operation:'detailed',model:'gpt-5.6-luna',reasoningEffort:'max',instructions:paidInput?PAID_READING_PROMPT:'Return the requested JSON object with ok equal to true.',inputJson:paidInput??'{}',schema:paidInput?detailedAssistantSchema:z.object({ok:z.boolean()}),schemaName:'paid_transport_probe'});
 await writeFile(path,JSON.stringify({success:true,result}),{flag:'wx',mode:0o600});
 expect(result).toBeTruthy();console.info(JSON.stringify({probe:'passed',path}));
 }catch(error){
 await writeFile(path,JSON.stringify({success:false,code:error instanceof LocalCodexError?error.code:'PROBE_FAILURE',outputIssue:error instanceof LocalCodexError?error.outputIssue:null,privateDiagnostic:error instanceof LocalCodexError?error.privateOutput:null}),{flag:'wx',mode:0o600});
 console.info(JSON.stringify({probe:'failed',code:error instanceof LocalCodexError?error.code:'PROBE_FAILURE',path}));throw new Error('PAID_PROVIDER_PROBE_FAILED');
 }
},360000);
