import { NextResponse } from "next/server";
import { createDreamServerAuthClient } from "@/lib/auth/server";
import { verifyRestoreToken } from "@/lib/crypto";
import { claimReading } from "@/lib/readings";
import { getRepository } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const readingId = url.searchParams.get("readingId");
  const token = url.searchParams.get("token");
  const fallback = new URL("/", url.origin);
  if (!code || !readingId || !token || !verifyRestoreToken(token, readingId)) {
    fallback.searchParams.set("auth", "invalid");
    return NextResponse.redirect(fallback);
  }

  const auth = await createDreamServerAuthClient();
  if (!auth) {
    fallback.searchParams.set("auth", "unconfigured");
    return NextResponse.redirect(fallback);
  }
  const { error } = await auth.auth.exchangeCodeForSession(code);
  const { data } = await auth.auth.getUser();
  if (error || !data.user) {
    fallback.searchParams.set("auth", "failed");
    return NextResponse.redirect(fallback);
  }

  const repository = getRepository();
  const reading = await repository.getReading(readingId);
  if (!reading) {
    fallback.searchParams.set("auth", "expired");
    return NextResponse.redirect(fallback);
  }
  await claimReading(reading, data.user.id, repository);
  const destination = new URL(`/reading/${encodeURIComponent(readingId)}`, url.origin);
  destination.searchParams.set("token", token);
  destination.searchParams.set("saved", "1");
  return NextResponse.redirect(destination);
}
