import "server-only";

import { cookies } from "next/headers";
import { appProfile } from "@/lib/app-profile";
import {
  createReviewSessionToken,
  REVIEW_SESSION_MAX_AGE,
  verifyReviewPassword,
  verifyReviewSessionToken
} from "./review-crypto";

const REVIEW_COOKIE_NAME = "kkumgyeol_review_session";
const REVIEW_SUBJECT = "payple-reviewer";

type ReviewAuthAccount = {
  identifier: string;
  passwordHash: string;
};

type ReviewAuthConfig = {
  accounts: ReviewAuthAccount[];
  secret: string;
};

function configuredReviewAccount(
  identifierValue: string | undefined,
  passwordHashValue: string | undefined
): ReviewAuthAccount | null {
  const identifier = identifierValue?.trim().toLowerCase();
  const passwordHash = passwordHashValue?.trim();
  if (!identifier || !passwordHash) return null;
  return { identifier, passwordHash };
}

function reviewAuthConfig(): ReviewAuthConfig | null {
  const profile = appProfile();
  if (profile !== "review" && (profile || process.env.NODE_ENV === "production")) return null;

  const accounts = [
    configuredReviewAccount(
      process.env.REVIEW_AUTH_IDENTIFIER ?? process.env.REVIEW_AUTH_EMAIL,
      process.env.REVIEW_AUTH_PASSWORD_HASH
    ),
    configuredReviewAccount(
      process.env.REVIEW_AUTH_SECONDARY_IDENTIFIER ?? process.env.REVIEW_AUTH_SECONDARY_EMAIL,
      process.env.REVIEW_AUTH_SECONDARY_PASSWORD_HASH
    )
  ].filter((account): account is ReviewAuthAccount => account !== null);
  const secret = process.env.REVIEW_AUTH_SECRET?.trim();
  if (accounts.length === 0 || !secret || secret.length < 32) return null;
  return { accounts, secret };
}

export function reviewAuthConfigured() {
  return Boolean(reviewAuthConfig());
}

export function safeReviewReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/products";
  return value.slice(0, 240);
}

export function authenticateReviewUser(identifier: string, password: string) {
  const config = reviewAuthConfig();
  if (!config) return false;
  const normalized = identifier.trim().toLowerCase();
  let authenticated = false;
  for (const account of config.accounts) {
    const identifierMatch =
      normalized.length === account.identifier.length && normalized === account.identifier;
    const passwordMatch = verifyReviewPassword(password, account.passwordHash);
    authenticated = (identifierMatch && passwordMatch) || authenticated;
  }
  return authenticated;
}

export async function createReviewSession() {
  const config = reviewAuthConfig();
  if (!config) throw new Error("REVIEW_AUTH_NOT_CONFIGURED");
  const token = createReviewSessionToken(REVIEW_SUBJECT, config.secret);
  const jar = await cookies();
  jar.set(REVIEW_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REVIEW_SESSION_MAX_AGE,
    priority: "high"
  });
}

export async function readReviewSession() {
  const config = reviewAuthConfig();
  if (!config) return null;
  const jar = await cookies();
  const verified = verifyReviewSessionToken(jar.get(REVIEW_COOKIE_NAME)?.value, config.secret);
  if (!verified || verified.subject !== REVIEW_SUBJECT) return null;
  return { id: REVIEW_SUBJECT, label: "회원 계정", expiresAt: verified.expiresAt };
}

export async function clearReviewSession() {
  const jar = await cookies();
  jar.set(REVIEW_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    expires: new Date(0)
  });
}
