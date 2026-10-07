import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import type { EncryptedPayload } from "./types";

const DEV_ENCRYPTION_SEED = "kkumgyeol-local-encryption-key-never-use-in-production";
const DEV_HMAC_SEED = "kkumgyeol-local-hmac-key-never-use-in-production";

function configuredKey(name: "DREAM_ENCRYPTION_KEY" | "DREAM_HMAC_KEY", purpose: "encryption" | "hmac") {
  const raw = process.env[name];
  if (!raw) {
    if (process.env.NODE_ENV === "production") throw new Error(`${name} is required in production.`);
    return createHash("sha256").update(purpose === "encryption" ? DEV_ENCRYPTION_SEED : DEV_HMAC_SEED).digest();
  }

  const encoded = raw.startsWith("base64:") ? raw.slice(7) : raw;
  const key = raw.startsWith("hex:") ? Buffer.from(raw.slice(4), "hex") : Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error(`${name} must decode to exactly 32 bytes.`);
  return key;
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function encryptDream(dream: string, readingId: string): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", configuredKey("DREAM_ENCRYPTION_KEY", "encryption"), iv);
  cipher.setAAD(Buffer.from(`kkumgyeol:dream:v1:${readingId}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(dream, "utf8"), cipher.final()]);
  return {
    v: 1,
    alg: "A256GCM",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url")
  };
}

export function decryptDream(payload: EncryptedPayload, readingId: string) {
  if (payload.v !== 1 || payload.alg !== "A256GCM") throw new Error("Unsupported dream payload.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    configuredKey("DREAM_ENCRYPTION_KEY", "encryption"),
    Buffer.from(payload.iv, "base64url")
  );
  decipher.setAAD(Buffer.from(`kkumgyeol:dream:v1:${readingId}`, "utf8"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function encryptedAad(scope: "context" | "clarifications" | "turn", entityId: string) {
  return Buffer.from(`kkumgyeol:${scope}:v1:${entityId}`, "utf8");
}

export function encryptJson<T>(
  value: T,
  scope: "context" | "clarifications" | "turn",
  entityId: string
): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", configuredKey("DREAM_ENCRYPTION_KEY", "encryption"), iv);
  cipher.setAAD(encryptedAad(scope, entityId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    v: 1,
    alg: "A256GCM",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url")
  };
}

export function decryptJson<T>(
  payload: EncryptedPayload,
  scope: "context" | "clarifications" | "turn",
  entityId: string
): T {
  if (payload.v !== 1 || payload.alg !== "A256GCM") throw new Error("Unsupported encrypted payload.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    configuredKey("DREAM_ENCRYPTION_KEY", "encryption"),
    Buffer.from(payload.iv, "base64url")
  );
  decipher.setAAD(encryptedAad(scope, entityId));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
  const json = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64url")),
    decipher.final()
  ]).toString("utf8");
  return JSON.parse(json) as T;
}

export function opaqueToken(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function safetyIdentifier(sessionHash: string) {
  return `dream_${createHmac("sha256", configuredKey("DREAM_HMAC_KEY", "hmac"))
    .update(`safety:${sessionHash}`, "utf8")
    .digest("base64url")
    .slice(0, 48)}`;
}

type RestoreClaims = { readingId: string; exp: number; v: 1 };

export function createRestoreToken(readingId: string, expiresAt: string) {
  const claims: RestoreClaims = { readingId, exp: Math.floor(new Date(expiresAt).getTime() / 1_000), v: 1 };
  const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = createHmac("sha256", configuredKey("DREAM_HMAC_KEY", "hmac"))
    .update(`restore:${body}`, "utf8")
    .digest("base64url");
  return `${body}.${signature}`;
}

export function verifyRestoreToken(token: string, readingId: string, now = Date.now()) {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return false;
  const expected = createHmac("sha256", configuredKey("DREAM_HMAC_KEY", "hmac"))
    .update(`restore:${body}`, "utf8")
    .digest("base64url");
  if (!safeEqual(signature, expected)) return false;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as RestoreClaims;
    return claims.v === 1 && claims.readingId === readingId && claims.exp * 1_000 > now;
  } catch {
    return false;
  }
}
