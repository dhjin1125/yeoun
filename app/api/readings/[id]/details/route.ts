import { canAccessReading } from "@/lib/access";
import { AppError, assertSameOrigin, errorResponse, noStoreJson, requestOrigin } from "@/lib/http";
import { getPublicReading, supplementFreeReading } from "@/lib/readings";
import { getRepository } from "@/lib/repository";
import { freeSupplementSchema, parseJson } from "@/lib/validation";
import type { ProgressReporter } from "@/lib/progress";
import { acceptsProgressStream, progressStreamResponse } from "@/lib/progress-server";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const input = freeSupplementSchema.parse(await parseJson(request));
    const repository = getRepository();
    const reading = await repository.getReading(id);
    if (!reading) throw new AppError("READING_NOT_FOUND", "해몽 결과가 없거나 보관 기간이 지났어요.", 404);
    if (!(await canAccessReading(reading, input.restoreToken))) throw new AppError("READING_ACCESS_DENIED", "이 해몽에 내용을 더할 권한이 없어요.", 403);
    const run = async (report: ProgressReporter = () => undefined) => {
      report({ stage: "request_validated", percent: 8, label: "추가한 내용도 함께 읽고 있어요" });
      const updated = await supplementFreeReading(reading, input.detail, repository, report, input.questionId);
      const result = await getPublicReading(updated, requestOrigin(request), repository);
      report({ stage: "result_ready", percent: 100, label: "무료 해석을 다시 읽어보세요" });
      return { reading: result };
    };
    return acceptsProgressStream(request) ? progressStreamResponse(run) : noStoreJson(await run());
  } catch (error) {
    return errorResponse(error);
  }
}
