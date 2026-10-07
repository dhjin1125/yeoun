import { describe, expect, it } from "vitest";
import {
  createReviewSessionToken,
  hashReviewPassword,
  REVIEW_SESSION_MAX_AGE,
  verifyReviewPassword,
  verifyReviewSessionToken
} from "@/lib/auth/review-crypto";

const SECRET = "review-session-secret-with-more-than-32-characters";

describe("review account credentials and stateless session", () => {
  it("uses scrypt for the fixed review password and rejects altered credentials", () => {
    const hash = hashReviewPassword("ExampleReviewPassword!2026", Buffer.from("fixed-review-salt"));

    expect(hash).toMatch(/^scrypt\$/);
    expect(hash).not.toContain("ExampleReviewPassword!2026");
    expect(verifyReviewPassword("ExampleReviewPassword!2026", hash)).toBe(true);
    expect(verifyReviewPassword("WrongReviewPassword!2026", hash)).toBe(false);
    expect(verifyReviewPassword("ExampleReviewPassword!2026", `${hash}x`)).toBe(false);
  });

  it("signs a minimal expiring session without putting an identifier or password in the cookie", () => {
    const now = Date.UTC(2026, 7, 20, 5, 0, 0);
    const token = createReviewSessionToken("payple-reviewer", SECRET, now);
    const session = verifyReviewSessionToken(token, SECRET, now + 1_000);

    expect(token).not.toContain("@");
    expect(token).not.toContain("ExampleReviewPassword");
    expect(session?.subject).toBe("payple-reviewer");
    expect(session?.expiresAt.getTime()).toBe(now + REVIEW_SESSION_MAX_AGE * 1_000);
    expect(verifyReviewSessionToken(`${token.slice(0, -1)}x`, SECRET, now)).toBeNull();
    expect(verifyReviewSessionToken(token, `${SECRET}x`, now)).toBeNull();
    expect(verifyReviewSessionToken(token, SECRET, now + REVIEW_SESSION_MAX_AGE * 1_000 + 1)).toBeNull();
  });
});
