import "server-only";

import { cookies } from "next/headers";
import {
  createReviewSessionToken,
  REVIEW_SESSION_MAX_AGE,
  verifyReviewPassword,
  verifyReviewSessionToken
} from "./auth/review-crypto";

export const ACCESS_GATE_COOKIE = "kkumgyeol_access_gate";
const ACCESS_GATE_SUBJECT = "gate-passed";

/** Opens only the entry gate until a server-controlled deadline; never issues a gate cookie. */
export function temporaryPublicAccessActive(now = Date.now()) {
  const until = process.env.ACCESS_GATE_OPEN_UNTIL?.trim();
  if (!until || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(until)) return false;
  const deadline = Date.parse(until);
  return Number.isFinite(deadline) && deadline > now;
}

export function accessGateEnabled() {
  if (process.env.ACCESS_GATE_PUBLIC_REVIEW === "true" || temporaryPublicAccessActive()) return false;
  return Boolean(
    process.env.ACCESS_GATE_PASSWORD_HASH?.trim() ||
    process.env.ACCESS_GATE_SECRET?.trim()
  );
}

export function verifyAccessGatePassword(password: string) {
  const passwordHash = process.env.ACCESS_GATE_PASSWORD_HASH?.trim();
  return Boolean(passwordHash && verifyReviewPassword(password, passwordHash));
}

export async function createAccessGateSession() {
  const secret = process.env.ACCESS_GATE_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("ACCESS_GATE_NOT_CONFIGURED");
  const token = createReviewSessionToken(ACCESS_GATE_SUBJECT, secret);
  const jar = await cookies();
  jar.set(ACCESS_GATE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REVIEW_SESSION_MAX_AGE,
    priority: "high"
  });
}

export async function accessGatePassed() {
  if (!accessGateEnabled()) return true;
  const jar = await cookies();
  return verifyAccessGateSession(jar.get(ACCESS_GATE_COOKIE)?.value);
}

export function verifyAccessGateSession(token: string | undefined) {
  const secret = process.env.ACCESS_GATE_SECRET?.trim() ?? "";
  if (!process.env.ACCESS_GATE_PASSWORD_HASH?.trim()) return false;
  const verified = verifyReviewSessionToken(token, secret);
  return Boolean(verified && verified.subject === ACCESS_GATE_SUBJECT);
}
