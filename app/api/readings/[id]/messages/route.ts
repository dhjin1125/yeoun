import { canAccessReading } from "@/lib/access";
import { classifyUserMessage } from "@/lib/consultation";
import { AppError, assertSameOrigin, errorResponse, noStoreJson, requestOrigin } from "@/lib/http";
import { addConversationMessage, getPublicReading } from "@/lib/readings";
import { getRepository } from "@/lib/repository";
import { conversationMessageSchema } from "@/lib/validation";
import { readConversationJson } from "@/lib/conversation-ingress";
import type { ProgressReporter } from "@/lib/progress";
import { acceptsProgressStream, progressStreamResponse } from "@/lib/progress-server";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const repository = getRepository();
  let readingId: string | null = null;
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    readingId = id;
    const input = conversationMessageSchema.parse(await readConversationJson(request));
    const reading = await repository.getReading(id);
    if (!reading) throw new AppError("READING_NOT_FOUND", "해몽 결과가 없거나 보관 기간이 지났어요.", 404);
    if (!(await canAccessReading(reading, input.restoreToken))) {
      throw new AppError("READING_ACCESS_DENIED", "이 해몽에 질문할 권한이 없어요.", 403);
    }

    const origin = requestOrigin(request);
    const run = async (report: ProgressReporter = () => undefined) => {
      report({ stage: "request_validated", percent: 8, label: "질문과 상담 기록을 확인했어요" });
      try {
        const previousSafetyRoute = reading.safetyRoute;
        const updated = await addConversationMessage(
          reading,
          { clientMessageId: input.clientMessageId, message: input.message },
          repository,
          report
        );
        await repository.recordEvent({
          event: "conversation_message_sent",
          readingId: id,
          context: { source: "timeline_composer", intent: classifyUserMessage(input.message) },
          occurredAt: new Date().toISOString()
        });
        if (updated.safetyRoute !== previousSafetyRoute && updated.safetyRoute !== "none") {
          await repository.recordEvent({
            event: "safety_route_shown",
            readingId: id,
            context: { source: "followup" },
            occurredAt: new Date().toISOString()
          });
        }
        const publicReading = await getPublicReading(updated, origin, repository);
        report({ stage: "result_ready", percent: 100, label: "이어진 답변을 화면에 준비했어요" });
        return { reading: publicReading };
      } catch (error) {
        if (error instanceof AppError && error.code === "QUESTION_CREDITS_EXHAUSTED") {
          try {
            await repository.recordEvent({
              event: "credits_exhausted",
              readingId,
              context: { source: "timeline_composer" },
              occurredAt: new Date().toISOString()
            });
          } catch {
            // Analytics must never replace the original credit error returned to the client.
          }
        }
        throw error;
      }
    };
    if (acceptsProgressStream(request)) return progressStreamResponse(run);
    return noStoreJson(await run());
  } catch (error) {
    return errorResponse(error);
  }
}
