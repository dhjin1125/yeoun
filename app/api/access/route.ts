import { z } from "zod";
import { AppError, assertSameOrigin, errorResponse, noStoreJson } from "@/lib/http";
import {
  accessGateEnabled,
  accessGatePassed,
  createAccessGateSession,
  verifyAccessGatePassword
} from "@/lib/access-gate";
import { parseJson } from "@/lib/validation";

export const runtime = "nodejs";

const unlockSchema = z.object({
  password: z.string().min(1, "비밀번호를 입력해 주세요.").max(128)
});

export async function GET() {
  return noStoreJson({ required: accessGateEnabled(), passed: await accessGatePassed() });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!accessGateEnabled()) {
      throw new AppError("ACCESS_GATE_DISABLED", "이 환경에서는 입장 비밀번호를 사용하지 않아요.", 404);
    }
    const input = unlockSchema.parse(await parseJson(request));
    const [verified] = await Promise.all([
      Promise.resolve(verifyAccessGatePassword(input.password)),
      new Promise((resolve) => setTimeout(resolve, 260))
    ]);
    if (!verified) {
      throw new AppError("INVALID_CREDENTIALS", "비밀번호가 맞지 않아요.", 401);
    }
    await createAccessGateSession();
    return noStoreJson({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
