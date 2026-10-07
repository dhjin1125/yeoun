import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { setCookie } = vi.hoisted(() => ({ setCookie: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: setCookie })
}));

import { POST } from "@/app/api/auth/logout/route";

const originalProfile = process.env.APP_PROFILE;

describe("logout route behind the public reverse proxy", () => {
  beforeEach(() => {
    setCookie.mockClear();
    process.env.APP_PROFILE = "review";
  });

  afterAll(() => {
    if (originalProfile === undefined) delete process.env.APP_PROFILE;
    else process.env.APP_PROFILE = originalProfile;
  });

  it("clears the session and redirects on the current public origin", async () => {
    const response = await POST(new Request("https://0.0.0.0:3010/api/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://yeoun-dream-cosmic.vercel.app",
        host: "0.0.0.0:3010",
        "x-forwarded-host": "yeoun-dream-cosmic.vercel.app",
        "x-forwarded-proto": "https"
      }
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(setCookie).toHaveBeenCalledWith(
      "kkumgyeol_review_session",
      "",
      expect.objectContaining({ path: "/", maxAge: 0 })
    );
  });

  it("does not expose a logout endpoint in the local-ai profile", async () => {
    process.env.APP_PROFILE = "local-ai";
    const response = await POST(new Request("http://127.0.0.1:3021/api/auth/logout", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3021" }
    }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "AUTH_DISABLED" } });
    expect(setCookie).not.toHaveBeenCalled();
  });
});
