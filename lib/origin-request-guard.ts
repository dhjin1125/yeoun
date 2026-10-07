import "server-only";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { hashToken, opaqueToken } from "./crypto";
import { getRepository, type DreamRepository } from "./repository";

// Caddy overwrites this header from the TCP peer; the app has no public port.
// Vercel edge peers share a conservative origin budget. Never trust client XFF.
export async function guardOriginRequest(request: Request, repository?: DreamRepository) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/") || ["GET", "HEAD", "OPTIONS"].includes(request.method) ||
      (path === "/api/payments/portone/webhook" && request.method === "POST")) return null;
  const raw = request.headers.get("x-yeoun-peer-ip") ?? "";
  const peer = isIP(raw) ? raw : "unknown-peer";
  const reject = (status: number, code: string, retry: number) => NextResponse.json(
    { error: { code, message: "요청이 많거나 확인할 수 없어요. 잠시 후 다시 시도해 주세요." } },
    { status, headers: { "Retry-After": String(retry), "Cache-Control": "private, no-store" } }
  );
  try {
    const result = await (repository ?? getRepository()).mutateConversationGuard(
      `origin:${hashToken(peer)}`, { kind: "admit", scope: "principal", lease: opaqueToken(9) },
      Date.now() + 3_600_000
    );
    if (result.status !== "allowed") return reject(429, "ORIGIN_REQUEST_RATE_LIMITED", result.retryAfterSeconds || 1);
    return null;
  } catch {
    return reject(503, "ORIGIN_REQUEST_CHECK_UNAVAILABLE", 5);
  }
}
