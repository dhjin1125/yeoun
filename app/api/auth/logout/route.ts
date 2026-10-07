import { NextResponse } from "next/server";
import { reviewPurchaseLoginRequired } from "@/lib/app-profile";
import { clearReviewSession } from "@/lib/auth/reviewer";
import { AppError, assertSameOrigin, errorResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!reviewPurchaseLoginRequired()) {
      throw new AppError("AUTH_DISABLED", "이 환경에서는 로그인을 사용하지 않아요.", 404);
    }
    await clearReviewSession();
    return new NextResponse(null, {
      status: 303,
      headers: {
        "Cache-Control": "no-store, private",
        Location: "/"
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
