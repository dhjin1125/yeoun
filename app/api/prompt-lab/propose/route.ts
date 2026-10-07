import { promptLabArchive, labModelSettings } from "@/lib/prompt-lab-archive";
import { z } from "zod";
import { getPromptProposalFailureDiagnostics, proposePromptEdit } from "@/lib/ai";
import { assertPromptLabAccess } from "@/lib/prompt-lab";
import { AppError, assertSameOrigin, errorResponse, noStoreJson } from "@/lib/http";
import { parseJson } from "@/lib/validation";
import { getOrCreateDreamSession } from "@/lib/session";
import { acceptsProgressStream, progressStreamResponse } from "@/lib/progress-server";
import type { ProgressReporter } from "@/lib/progress";
import { goalMemorySchema } from "@/lib/prompt-lab-goal";

export const runtime="nodejs";
const inputSchema=z.object({
  workspaceId:z.string().uuid().optional(),
  sourceRunId:z.number().int().positive().optional(),
  instructions:z.string().min(1).max(40_000).refine(value=>Boolean(value.trim())),
  resultInstructions:z.string().min(1).max(40_000),
  feedback:z.string().trim().min(2,"바라는 변화를 적어 주세요.").max(2000),
  dream:z.string().trim().min(2).max(2000),
  result:z.string().trim().min(1).max(12_000),
  memory:goalMemorySchema
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertPromptLabAccess();
    const input=inputSchema.parse(await parseJson(request));
    const session=await getOrCreateDreamSession();
    const run=async(report:ProgressReporter=()=>undefined)=>{
      const settings=labModelSettings(true);
      const started=await promptLabArchive.record("proposal_started",{input,settings,experimentId:input.sourceRunId??null,workspaceId:input.workspaceId??null});
      try {
      report({stage:"proposal",percent:5,label:"결과와 피드백을 살펴보고 있어요"});
      const proposal=await proposePromptEdit(input,session.hash,
        stage=>report(stage === "proposal_repair_started"
          ? {stage,percent:55,label:"응답 형식이나 수정 구간을 바로잡아 한 번 더 시도하고 있어요"}
          : {stage,percent:40,label:"필요한 지침 수정안을 만들고 있어요"}));
      report({stage:"proposal_ready",percent:100,label:"수정안을 확인한 뒤 승인해 주세요"});
      const result={...proposal,settings,createdAt:new Date().toISOString()};
      try {
        const saved=await promptLabArchive.record("proposal_completed",{requestId:started.id,input,result,settings,experimentId:input.sourceRunId??null,workspaceId:input.workspaceId??null});
        return {...result,archiveId:saved.id};
      } catch {return {...result,archiveWarning:"수정안의 프로젝트 파일 저장에 실패했어요. 실험 기록을 내려받아 보관해 주세요."};}
      } catch(error) {
        const proposalFailure=getPromptProposalFailureDiagnostics(error);
        await promptLabArchive.record("proposal_failed",{requestId:started.id,input,settings,experimentId:input.sourceRunId??null,
          errorCode:proposalFailure?.errorCode??(error instanceof AppError?error.code:"PROPOSAL_FAILED"),proposalFailure});
        throw error;
      }
    };
    return acceptsProgressStream(request) ? progressStreamResponse(run) : noStoreJson(await run());
  } catch(error) {return errorResponse(error);}
}
