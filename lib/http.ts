import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorDetails(error: unknown): {
  status: number;
  body: { error: { code: string; message: string; retryAfterSeconds?: number } };
} {
  if (error instanceof AppError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message, ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) } } };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: { code: "INVALID_INPUT", message: error.issues[0]?.message ?? "입력값을 확인해 주세요." }
      }
    };
  }
  if (error instanceof Error && error.message === "INVALID_JSON") {
    return {
      status: 400,
      body: { error: { code: "INVALID_JSON", message: "요청 형식이 올바르지 않아요." } }
    };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "잠시 후 다시 시도해 주세요." } }
  };
}

export function errorResponse(error: unknown) {
  const details = errorDetails(error);
  return NextResponse.json(details.body, {
    status: details.status,
    headers: { "Cache-Control": "no-store, private", ...(details.body.error.retryAfterSeconds ? { "Retry-After": String(details.body.error.retryAfterSeconds) } : {}) }
  });
}

export function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}

export function requestOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const allowed = new Set<string>();
  if (configured) allowed.add(new URL(configured).origin);

  const requestUrl = new URL(request.url);
  allowed.add(requestUrl.origin);

  // Next's development server can normalize request.url to localhost even when
  // the browser reached 127.0.0.1. The Host header retains the browser-facing
  // authority. In production, the reverse proxy must sanitize forwarded hosts.
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol || requestUrl.protocol.replace(":", "");
  if (host && /^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.test(host)) {
    allowed.add(`${protocol}://${host}`);
  }

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    throw new AppError("ORIGIN_MISMATCH", "허용되지 않은 요청입니다.", 403);
  }
  if (!allowed.has(normalizedOrigin)) {
    throw new AppError("ORIGIN_MISMATCH", "허용되지 않은 요청입니다.", 403);
  }
}
