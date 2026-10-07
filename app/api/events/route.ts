import { NextResponse } from "next/server";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";
import { analyticsSchema, parseJson } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = analyticsSchema.parse(await parseJson(request));
    await getRepository().recordEvent({
      event: input.event,
      readingId: input.readingId ?? null,
      context: input.context ?? {},
      occurredAt: new Date().toISOString()
    });
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
