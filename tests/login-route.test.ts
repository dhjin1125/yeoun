import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { setCookie } = vi.hoisted(() => ({ setCookie: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: setCookie })
}));

import { POST } from "@/app/api/auth/login/route";

const TEST_PASSWORD_HASH =
  "scrypt$eWVvdW4tcmV2aWV3LXRlc3QtMjAyNg$ZfTPl2DXSTkcJbHlqig0b-37fpqna4DegCIcZWWc4m8";
const SECONDARY_PASSWORD = "SecondaryReviewPassword!2026";
const SECONDARY_PASSWORD_HASH =
  "scrypt$eWVvdW4tc2Vjb25kYXJ5LXRlc3QtMjAyNg$3aYNoi98emVRfpjSvpQSHI5KBzUfVAFykGlIQpXQG10";
const originalEnvironment = {
  APP_PROFILE: process.env.APP_PROFILE,
  REVIEW_AUTH_IDENTIFIER: process.env.REVIEW_AUTH_IDENTIFIER,
  REVIEW_AUTH_EMAIL: process.env.REVIEW_AUTH_EMAIL,
  REVIEW_AUTH_PASSWORD_HASH: process.env.REVIEW_AUTH_PASSWORD_HASH,
  REVIEW_AUTH_SECONDARY_IDENTIFIER: process.env.REVIEW_AUTH_SECONDARY_IDENTIFIER,
  REVIEW_AUTH_SECONDARY_EMAIL: process.env.REVIEW_AUTH_SECONDARY_EMAIL,
  REVIEW_AUTH_SECONDARY_PASSWORD_HASH: process.env.REVIEW_AUTH_SECONDARY_PASSWORD_HASH,
  REVIEW_AUTH_SECRET: process.env.REVIEW_AUTH_SECRET
};

function loginRequest(identifier: string, password: string) {
  return new Request("https://yeoun-dream-cosmic.vercel.app/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://yeoun-dream-cosmic.vercel.app"
    },
    body: JSON.stringify({ identifier, password, next: "/products" })
  });
}

describe("review login route", () => {
  beforeEach(() => {
    setCookie.mockClear();
    process.env.APP_PROFILE = "review";
    process.env.REVIEW_AUTH_IDENTIFIER = "test";
    delete process.env.REVIEW_AUTH_EMAIL;
    process.env.REVIEW_AUTH_PASSWORD_HASH = TEST_PASSWORD_HASH;
    delete process.env.REVIEW_AUTH_SECONDARY_IDENTIFIER;
    delete process.env.REVIEW_AUTH_SECONDARY_EMAIL;
    delete process.env.REVIEW_AUTH_SECONDARY_PASSWORD_HASH;
    process.env.REVIEW_AUTH_SECRET = "review-login-route-secret-with-at-least-32-characters";
  });

  afterAll(() => {
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("accepts the non-email test identifier and creates a session", async () => {
    const response = await POST(loginRequest("test", "test"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, redirectTo: "/products" });
    expect(setCookie).toHaveBeenCalledWith(
      "kkumgyeol_review_session",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, path: "/", sameSite: "lax" })
    );
  });

  it("accepts a separately hashed secondary email account", async () => {
    process.env.REVIEW_AUTH_SECONDARY_IDENTIFIER = "payple-review@yeoun.kr";
    process.env.REVIEW_AUTH_SECONDARY_PASSWORD_HASH = SECONDARY_PASSWORD_HASH;

    const response = await POST(loginRequest("PAYPLE-REVIEW@YEOUN.KR", SECONDARY_PASSWORD));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, redirectTo: "/products" });
    expect(setCookie).toHaveBeenCalledWith(
      "kkumgyeol_review_session",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, path: "/", sameSite: "lax" })
    );
  });

  it("does not accept a password belonging to the other configured account", async () => {
    process.env.REVIEW_AUTH_SECONDARY_IDENTIFIER = "payple-review@yeoun.kr";
    process.env.REVIEW_AUTH_SECONDARY_PASSWORD_HASH = SECONDARY_PASSWORD_HASH;

    const [primaryResponse, secondaryResponse] = await Promise.all([
      POST(loginRequest("test", SECONDARY_PASSWORD)),
      POST(loginRequest("payple-review@yeoun.kr", "test"))
    ]);

    expect(primaryResponse.status).toBe(401);
    expect(secondaryResponse.status).toBe(401);
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("rejects a wrong password without creating a session", async () => {
    const response = await POST(loginRequest("test", "wrong"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_CREDENTIALS" } });
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("does not expose the review account in the production profile", async () => {
    process.env.APP_PROFILE = "production";

    const response = await POST(loginRequest("test", "test"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "AUTH_DISABLED" } });
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("disables the login endpoint in the local-ai profile", async () => {
    process.env.APP_PROFILE = "local-ai";

    const response = await POST(loginRequest("test", "test"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "AUTH_DISABLED" } });
    expect(setCookie).not.toHaveBeenCalled();
  });
});
