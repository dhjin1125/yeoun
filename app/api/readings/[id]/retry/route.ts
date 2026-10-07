import { canAccessReading } from "@/lib/access";
import { AppError, assertSameOrigin, errorResponse, noStoreJson, requestOrigin } from "@/lib/http";
import { getPublicReading, retryDetailedReading } from "@/lib/readings";
import { getRepository } from "@/lib/repository";
import { parseJson, retryReadingSchema } from "@/lib/validation";
import type { ProgressReporter } from "@/lib/progress";
import { acceptsProgressStream, progressStreamResponse } from "@/lib/progress-server";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const input = retryReadingSchema.parse(await parseJson(request));
    const repository = getRepository();
    const reading = await repository.getReading(id);
    if (!reading) throw new AppError("READING_NOT_FOUND", "해몽 결과가 없거나 보관 기간이 지났어요.", 404);
    if (!(await canAccessReading(reading, input.restoreToken))) {
      throw new AppError("READING_ACCESS_DENIED", "이 해몽을 다시 만들 권한이 없어요.", 403);
    }
    const origin = requestOrigin(request);
    const run = async (report: ProgressReporter = () => undefined) => {
      const updated = await retryDetailedReading(reading, repository, report);
      const publicReading = await getPublicReading(updated, origin, repository);
      report({ stage: "result_ready", percent: 100, label: "다시 만든 상세 해몽을 준비했어요" });
      return { reading: publicReading };
    };
    if (acceptsProgressStream(request)) return progressStreamResponse(run);
    return noStoreJson(await run());
  } catch (error) {
    return errorResponse(error);
  }
}
