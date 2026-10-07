import { canAccessReading } from "@/lib/access";
import { AppError, assertSameOrigin, errorResponse, noStoreJson, requestOrigin } from "@/lib/http";
import { getPublicReading } from "@/lib/readings";
import { getRepository } from "@/lib/repository";
import type { ProgressReporter } from "@/lib/progress";
import { acceptsProgressStream, progressStreamResponse } from "@/lib/progress-server";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const repository = getRepository();
    const token = new URL(request.url).searchParams.get("token");
    const origin = requestOrigin(request);
    const run = async (report: ProgressReporter = () => undefined) => {
      report({ stage: "recovery_request_ready", percent: 10, label: "복구 링크 형식을 확인했어요" });
      const reading = await repository.getReading(id);
      if (!reading) throw new AppError("READING_NOT_FOUND", "해몽 결과가 없거나 보관 기간이 지났어요.", 404);
      report({ stage: "reading_found", percent: 48, label: "보관 중인 꿈 기록을 찾았어요" });
      if (!(await canAccessReading(reading, token))) {
        throw new AppError("READING_ACCESS_DENIED", "이 해몽을 볼 권한이 없어요.", 403);
      }
      report({ stage: "reading_access_verified", percent: 70, label: "이 기록을 볼 수 있는 링크인지 확인했어요" });
      const publicReading = await getPublicReading(reading, origin, repository);
      report({ stage: "result_ready", percent: 100, label: "보관된 해몽을 화면에 준비했어요" });
      return { reading: publicReading };
    };
    if (acceptsProgressStream(request)) return progressStreamResponse(run);
    return noStoreJson(await run());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const repository = getRepository();
    const reading = await repository.getReading(id);
    if (!reading) throw new AppError("READING_NOT_FOUND", "해몽 결과가 없거나 이미 삭제되었어요.", 404);
    const token = new URL(request.url).searchParams.get("token");
    if (!(await canAccessReading(reading, token))) {
      throw new AppError("READING_ACCESS_DENIED", "이 해몽을 삭제할 권한이 없어요.", 403);
    }
    await repository.deleteReading(id);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store, private" }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
