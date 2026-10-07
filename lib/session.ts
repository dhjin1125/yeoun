import "server-only";

import { cookies } from "next/headers";
import { hashToken, opaqueToken } from "./crypto";

const COOKIE_NAME = "kkumgyeol_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export type DreamSession = { token: string; hash: string };

export async function readDreamSession(): Promise<DreamSession | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  return { token, hash: hashToken(token) };
}

export async function getOrCreateDreamSession(): Promise<DreamSession> {
  const existing = await readDreamSession();
  if (existing) return existing;
  const token = opaqueToken(32);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE
  });
  return { token, hash: hashToken(token) };
}
