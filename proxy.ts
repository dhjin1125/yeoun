import { NextRequest, NextResponse } from "next/server";
import { ACCESS_GATE_COOKIE, accessGateEnabled, verifyAccessGateSession } from "@/lib/access-gate";

export async function proxy(request: NextRequest) {
  if (process.env.ORIGIN_REQUEST_GUARD === "true") {
    const { guardOriginRequest } = await import("@/lib/origin-request-guard");
    const blocked = await guardOriginRequest(request);
    if (blocked) return blocked;
  }
  if (!accessGateEnabled()) return NextResponse.next();
  const path = request.nextUrl.pathname;
  // Health probes contain no readings; payment notifications verify their own signature.
  if (["/access", "/api/access", "/api/healthz", "/api/readyz"].includes(path) ||
      (path === "/api/payments/portone/webhook" && request.method === "POST")) {
    return NextResponse.next();
  }
  if (verifyAccessGateSession(request.cookies.get(ACCESS_GATE_COOKIE)?.value)) return NextResponse.next();

  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" };
  if (path === "/api" || path.startsWith("/api/")) {
    return NextResponse.json({ error: { code: "ACCESS_GATE_REQUIRED", message: "입장 비밀번호를 입력해 주세요." } }, { status: 403, headers });
  }
  // Keep the original URL so unlocking and refreshing returns to the requested page.
  const gateUrl = request.nextUrl.clone();
  gateUrl.pathname = "/access";
  gateUrl.search = "";
  return NextResponse.rewrite(gateUrl, { headers });
}

export const config = {
  matcher: ["/((?!_next/static/|_next/image|favicon.ico$).*)"]
};
