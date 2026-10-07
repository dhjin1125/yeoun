import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const REVIEW_SESSION_MAX_AGE = 60 * 60 * 12;

const PASSWORD_KEY_LENGTH = 32;
const SUBJECT_PATTERN = /^[a-z0-9_-]{3,40}$/;

function safeEqual(left: Buffer, right: Buffer) {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hashReviewPassword(password: string, salt = randomBytes(16)) {
  if (password.length < 12 || password.length > 128) {
    throw new Error("Review password must be between 12 and 128 characters.");
  }
  const derived = scryptSync(password, salt, PASSWORD_KEY_LENGTH, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyReviewPassword(password: string, encoded: string) {
  if (password.length > 128 || encoded.length > 256) return false;
  const [algorithm, saltValue, keyValue, extra] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltValue || !keyValue || extra) return false;
  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(keyValue, "base64url");
    if (salt.length < 12 || expected.length !== PASSWORD_KEY_LENGTH) return false;
    const actual = scryptSync(password, salt, expected.length, {
      N: 16_384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024
    });
    return safeEqual(actual, expected);
  } catch {
    return false;
  }
}

function sessionSignature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest();
}

export function createReviewSessionToken(subject: string, secret: string, now = Date.now()) {
  if (!SUBJECT_PATTERN.test(subject)) throw new Error("Invalid review session subject.");
  if (secret.length < 32) throw new Error("REVIEW_AUTH_SECRET must contain at least 32 characters.");
  const payload = Buffer.from(
    JSON.stringify({ v: 1, sub: subject, exp: Math.floor(now / 1000) + REVIEW_SESSION_MAX_AGE }),
    "utf8"
  ).toString("base64url");
  return `${payload}.${sessionSignature(payload, secret).toString("base64url")}`;
}

export function verifyReviewSessionToken(token: string | undefined, secret: string, now = Date.now()) {
  if (!token || token.length > 600 || secret.length < 32) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  try {
    const actual = Buffer.from(signature, "base64url");
    const expected = sessionSignature(payload, secret);
    if (!safeEqual(actual, expected)) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      v?: unknown;
      sub?: unknown;
      exp?: unknown;
    };
    if (
      decoded.v !== 1 ||
      typeof decoded.sub !== "string" ||
      !SUBJECT_PATTERN.test(decoded.sub) ||
      typeof decoded.exp !== "number" ||
      !Number.isInteger(decoded.exp) ||
      decoded.exp <= Math.floor(now / 1000)
    ) {
      return null;
    }
    return { subject: decoded.sub, expiresAt: new Date(decoded.exp * 1000) };
  } catch {
    return null;
  }
}
