import { canAccessReading } from "@/lib/access";
import { aiGenerationDisabled } from "@/lib/app-profile";
import { AppError, assertSameOrigin, errorResponse, noStoreJson } from "@/lib/http";
import { preparePaidPreview } from "@/lib/readings";
import { getRepository } from "@/lib/repository";
import { parseJson } from "@/lib/validation";
import { z } from "zod";

export const runtime = "nodejs";

const inputSchema = z.object({ restoreToken: z.string().optional() }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    if (aiGenerationDisabled()) throw new AppError("AI_GENERATION_DISABLED", "상세 해몽 생성을 잠시 중단했어요.", 503);
    const { id } = await context.params;
    const input = inputSchema.parse(await parseJson(request));
    const repository = getRepository();
    const reading = await repository.getReading(id);
    if (!reading) throw new AppError("READING_NOT_FOUND", "해몽 결과가 없거나 보관 기간이 지났어요.", 404);
    if (!(await canAccessReading(reading, input.restoreToken))) throw new AppError("READING_ACCESS_DENIED", "이 기록을 볼 권한이 없어요.", 403);
    return noStoreJson({ preview: await preparePaidPreview(reading, repository) });
  } catch (error) {
    return errorResponse(error);
  }
}
