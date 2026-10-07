import { createInitialReadingOnce } from "@/lib/initial-reading-request";
import { accessGatePassed } from "@/lib/access-gate";
import { aiGenerationDisabled } from "@/lib/app-profile";
import { createReading, getPublicReading } from "@/lib/readings";
import { getRepository } from "@/lib/repository";
import { getOrCreateDreamSession } from "@/lib/session";
import { createReadingSchema } from "@/lib/validation";
import { readConversationJson } from "@/lib/conversation-ingress";
import { AppError, assertSameOrigin, errorResponse, noStoreJson, requestOrigin } from "@/lib/http";
import type { ProgressReporter } from "@/lib/progress";
import { acceptsProgressStream, progressStreamResponse } from "@/lib/progress-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (aiGenerationDisabled()) throw new AppError("AI_GENERATION_DISABLED", "운영 해몽 생성을 잠시 중단했어요. 기존 결과는 계속 볼 수 있어요.", 503);
    if (!(await accessGatePassed())) {
      throw new AppError("ACCESS_GATE_REQUIRED", "해몽을 시작하기 전에 입장 비밀번호를 입력해 주세요.", 403);
    }
    const input = createReadingSchema.parse(await readConversationJson(request));
    const session = await getOrCreateDreamSession();
    const repository = getRepository();
    const origin = requestOrigin(request);
    const run = async (report: ProgressReporter = () => undefined) => {
      report({ stage: "request_validated", percent: 8, label: "꿈 내용과 브라우저 연결을 확인했어요" });
      const readingInput = { dream: input.dream, emotion: input.emotion ?? null, focus: input.focus ?? null };
      const reading = await createInitialReadingOnce(
        session.hash, readingInput, repository,
        () => createReading(readingInput, session.hash, repository, report)
      );
      await repository.recordEvent({
        event: "analysis_submitted",
        readingId: reading.id,
        context: { source: input.source ?? "intake", ...(input.topic ? { topic: input.topic } : {}), ...(input.focus ? { focus: input.focus } : {}) },
        occurredAt: new Date().toISOString()
      });
      const publicReading = await getPublicReading(reading, origin, repository);
      report({ stage: "result_ready", percent: 100, label: "보여드릴 결과를 모두 준비했어요" });
      return { reading: publicReading };
    };
    if (acceptsProgressStream(request)) return progressStreamResponse(run, { status: 201 });
    return noStoreJson(await run(), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
