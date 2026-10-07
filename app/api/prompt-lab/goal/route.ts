import { z } from "zod";
import { discussPromptGoal } from "@/lib/ai";
import { goalDiscussionInputSchema } from "@/lib/prompt-lab-goal";
import { promptLabArchive,labModelSettings } from "@/lib/prompt-lab-archive";
import { assertPromptLabAccess } from "@/lib/prompt-lab";
import { assertSameOrigin,errorResponse,noStoreJson } from "@/lib/http";
import { parseJson } from "@/lib/validation";
import { getOrCreateDreamSession } from "@/lib/session";
import { acceptsProgressStream,progressStreamResponse } from "@/lib/progress-server";
import type { ProgressReporter } from "@/lib/progress";

export const runtime="nodejs";
const schema=goalDiscussionInputSchema.extend({workspaceId:z.string().uuid()});
export async function POST(request:Request) {
  try {
    assertSameOrigin(request);await assertPromptLabAccess();
    const input=schema.parse(await parseJson(request));
    const session=await getOrCreateDreamSession();
    const run=async(report:ProgressReporter=()=>undefined)=>{
      const settings=labModelSettings(true);
      const started=await promptLabArchive.record("goal_started",{input,settings,workspaceId:input.workspaceId,experimentId:input.reference.runId});
      try {
        report({stage:"proposal",percent:5,label:"말씀하신 목표를 함께 정리하고 있어요"});
        const brief=await discussPromptGoal(input,session.hash,stage=>report({stage,percent:40,label:"원하는 변화와 유지할 점을 확인하고 있어요"}));
        const result={brief,settings,createdAt:new Date().toISOString()};
        try {
          const saved=await promptLabArchive.record("goal_completed",{requestId:started.id,input,result,settings,workspaceId:input.workspaceId,experimentId:input.reference.runId});
          return {...result,archiveId:saved.id};
        }catch{return {...result,archiveWarning:"목표 정리의 프로젝트 저장에 실패했어요. 기록을 내려받아 보관해 주세요."};}
      }catch(error){
        await promptLabArchive.record("goal_failed",{requestId:started.id,input,settings,workspaceId:input.workspaceId,errorCode:"GOAL_FAILED"});
        throw error;
      }
    };
    return acceptsProgressStream(request)?progressStreamResponse(run):noStoreJson(await run());
  }catch(error){return errorResponse(error);}
}
