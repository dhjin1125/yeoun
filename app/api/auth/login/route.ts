import { z } from "zod";
import { reviewPurchaseLoginRequired } from "@/lib/app-profile";
import { AppError, assertSameOrigin, errorResponse, noStoreJson } from "@/lib/http";
import {
  authenticateReviewUser,
  createReviewSession,
  reviewAuthConfigured,
  safeReviewReturnPath
} from "@/lib/auth/reviewer";
import { parseJson } from "@/lib/validation";

export const runtime = "nodejs";

const loginSchema = z.object({
  identifier: z.string().trim().min(1, "아이디를 입력해 주세요.").max(160),
  password: z.string().min(1, "비밀번호를 입력해 주세요.").max(128),
  next: z.string().max(240).optional()
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!reviewPurchaseLoginRequired()) {
      throw new AppError("AUTH_DISABLED", "이 환경에서는 로그인을 사용하지 않아요.", 404);
    }
    if (!reviewAuthConfigured()) {
      throw new AppError("REVIEW_AUTH_NOT_CONFIGURED", "로그인 계정을 준비하고 있어요.", 503);
    }
    const input = loginSchema.parse(await parseJson(request));
    const [authenticated] = await Promise.all([
      Promise.resolve(authenticateReviewUser(input.identifier, input.password)),
      new Promise((resolve) => setTimeout(resolve, 260))
    ]);
    if (!authenticated) {
      throw new AppError("INVALID_CREDENTIALS", "아이디·이메일 또는 비밀번호를 확인해 주세요.", 401);
    }
    await createReviewSession();
    return noStoreJson({ ok: true, redirectTo: safeReviewReturnPath(input.next) });
  } catch (error) {
    return errorResponse(error);
  }
}
