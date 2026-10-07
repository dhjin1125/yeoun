import { canAccessReading } from "@/lib/access";
import { AppError, assertSameOrigin, errorResponse, noStoreJson, requestOrigin } from "@/lib/http";
import { addConversationMessage, getPublicReading } from "@/lib/readings";
import { getRepository } from "@/lib/repository";
import { followUpSchema } from "@/lib/validation";
import { readConversationJson } from "@/lib/conversation-ingress";
import type { ProgressReporter } from "@/lib/progress";
import { acceptsProgressStream, progressStreamResponse } from "@/lib/progress-server";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const input = followUpSchema.parse(await readConversationJson(request));
    const repository = getRepository();
    const reading = await repository.getReading(id);
    if (!reading) throw new AppError("READING_NOT_FOUND", "해몽 결과가 없거나 보관 기간이 지났어요.", 404);
    if (!(await canAccessReading(reading, input.restoreToken))) {
      throw new AppError("READING_ACCESS_DENIED", "이 해몽에 질문할 권한이 없어요.", 403);
    }
    const clientMessageId = input.clientMessageId ?? `legacy_${crypto.randomUUID().replaceAll("-", "")}`;
    const origin = requestOrigin(request);
    const run = async (report: ProgressReporter = () => undefined) => {
      report({ stage: "request_validated", percent: 8, label: "질문과 상담 기록을 확인했어요" });
      const updated = await addConversationMessage(
        reading,
        { clientMessageId, message: input.question },
        repository,
        report
      );
      await repository.recordEvent({
        event: "conversation_message_sent",
        readingId: reading.id,
        context: { source: "paid_report" },
        occurredAt: new Date().toISOString()
      });
      const publicReading = await getPublicReading(updated, origin, repository);
      report({ stage: "result_ready", percent: 100, label: "이어진 답변을 화면에 준비했어요" });
      return { reading: publicReading };
    };
    if (acceptsProgressStream(request)) return progressStreamResponse(run);
    return noStoreJson(await run());
  } catch (error) {
    return errorResponse(error);
  }
}
