import { promptLabArchive, labModelSettings } from "@/lib/prompt-lab-archive";
import { generatePaidLabReading } from "@/lib/prompt-lab-paid";
import { PaidPipelineError } from "@/lib/ai/paid-pipeline";
import { z } from "zod";
import { analyzeDreamInput, prepareConsultation } from "@/lib/ai";
import { ANALYSIS_PROMPT, CONSULTATION_PLAN_PROMPT, GROUNDED_PAID_REVIEW_PROMPT, PAID_READING_PROMPT, PAID_SAFETY_PROMPT } from "@/lib/ai/prompts";
import { localCodexConfigured, localCodexModelLabel } from "@/lib/ai/codex-local";
import { effectiveAiMode } from "@/lib/app-profile";
import { assertPromptLabAccess } from "@/lib/prompt-lab";
import { AppError, assertSameOrigin, errorResponse, noStoreJson } from "@/lib/http";
import { createReadingSchema, parseJson } from "@/lib/validation";
import { classifyDreamClarificationSafety, safetyNoticeForRoute } from "@/lib/safety";
import { getOrCreateDreamSession } from "@/lib/session";
import { acceptsProgressStream, progressStreamResponse } from "@/lib/progress-server";
import type { ProgressReporter } from "@/lib/progress";

export const runtime = "nodejs";
const inputSchema = createReadingSchema.extend({ instructions: z.string().trim().min(1).max(40_000), workspaceId:z.string().uuid().optional(), experimentId:z.number().int().positive().optional() });

export async function GET(request: Request) {
  try {
    assertSameOrigin(request);
    await assertPromptLabAccess();
    return noStoreJson({ instructions: PAID_READING_PROMPT,
      model: localCodexConfigured() ? localCodexModelLabel("detailed") : effectiveAiMode() === "openai" ? process.env.OPENAI_PAID_MODEL ?? "gpt-5.4-mini" : "AI 연결 없음" });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertPromptLabAccess();
    const input = inputSchema.parse(await parseJson(request));
    const notice = safetyNoticeForRoute(classifyDreamClarificationSafety(input.dream));
    if (notice?.blocksInterpretation) throw new AppError("SAFETY_GUIDANCE", notice.message, 422);
    if (!localCodexConfigured() && !(effectiveAiMode() === "openai" && process.env.OPENAI_API_KEY)) {
      throw new AppError("LAB_AI_UNAVAILABLE", "현재 서버에 실제 AI 생성 연결이 필요해요.", 503);
    }
    const session = await getOrCreateDreamSession();
    const run = async (report: ProgressReporter = () => undefined) => {
      const started = Date.now();
      const settings=labModelSettings(false, "detailed");
      const startedRecord=await promptLabArchive.record("reading_started",{input,settings,generationMode:"paid",
        instructions:{analysis:ANALYSIS_PROMPT,consultation:CONSULTATION_PLAN_PROMPT,
          writer:`${input.instructions}\n\n${PAID_SAFETY_PROMPT}`,reviewer:GROUNDED_PAID_REVIEW_PROMPT},
        experimentId:input.experimentId??null,workspaceId:input.workspaceId??null});
      try {
      report({stage:"analysis",percent:5,label:"꿈의 근거를 확인하고 있어요"});
      const analysis = await analyzeDreamInput(input.dream,input.emotion ?? null,session.hash,input.focus ?? null);
      const evidence = { selectedEmotion:input.emotion ?? null,clarificationAnswers:[] };
      analysis.context.consultation = await prepareConsultation(analysis.context,input.dream,evidence,session.hash,
        stage => report({stage,percent:20,label:stage === "fact_check_repair" ? "원문 인용을 다시 확인하고 있어요" : "꿈의 사실을 대조하고 있어요"}));
      report({stage:"detailed",percent:45,label:"상세 해몽을 바로 생성하고 있어요"});
      const payload = await generatePaidLabReading({
        context: analysis.context, sessionHash: session.hash, dream: input.dream,
        safetyRoute: classifyDreamClarificationSafety(input.dream), evidence,
        instructions: input.instructions, requestId: startedRecord.id,
        experimentId: input.experimentId, workspaceId: input.workspaceId,
        report: stage => report({stage,percent:65,label:stage === "quality_checked" ? "상세 풀이 검수를 마쳤어요" : "상세 풀이 생성과 검수를 진행하고 있어요"})
      });
      report({stage:"complete",percent:100,label:"비교할 결과가 준비됐어요"});
      const result={generationMode:"paid" as const,payload,durationMs:Date.now()-started,safetyNotice:notice,
        promptApplied:payload.generationSource === "codex" || payload.generationSource === "openai",
        settings,createdAt:new Date().toISOString()};
      try {
        const saved=await promptLabArchive.record("reading_completed",{requestId:startedRecord.id,input,result,settings,analysis,evidence,experimentId:input.experimentId??null,workspaceId:input.workspaceId??null});
        return {...result,archiveId:saved.id};
      } catch {
        return {...result,archiveWarning:"풀이가 나왔지만 프로젝트 파일 저장에 실패했어요. 실험 기록을 내려받아 보관해 주세요."};
      }
      } catch(error) {
        const errorCode = error instanceof PaidPipelineError ? error.code : error instanceof AppError ? error.code : "GENERATION_FAILED";
        await promptLabArchive.record("reading_failed",{requestId:startedRecord.id,input,settings,experimentId:input.experimentId??null,
          errorCode, generationMode:"paid", workspaceId:input.workspaceId??null});
        if (error instanceof PaidPipelineError || (error instanceof AppError && error.code === "PAID_GENERATION_FAILED")) {
          throw new AppError("PAID_GENERATION_FAILED", `상세 풀이 생성 또는 검수를 완료하지 못했어요. 꿈과 지침을 확인한 뒤 다시 시도해 주세요. (${errorCode})`, 503);
        }
        throw error;
      }
    };
    return acceptsProgressStream(request) ? progressStreamResponse(run) : noStoreJson(await run());
  } catch (error) { return errorResponse(error); }
}
