import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ACCESS_GATE_COOKIE, accessGateEnabled, verifyAccessGateSession } from "@/lib/access-gate";
import { createReviewSessionToken, REVIEW_SESSION_MAX_AGE } from "@/lib/auth/review-crypto";
import { POST } from "@/app/api/access/route";
import { proxy } from "@/proxy";

const { jar } = vi.hoisted(() => ({ jar: { get: vi.fn(), set: vi.fn() } }));
vi.mock("next/headers", () => ({ cookies: async () => jar }));
const SECRET = "synthetic-access-gate-signing-secret-2026";
const PASSWORD = "test2468";
const salt = Buffer.from("synthetic-gate-salt");
const hash = `scrypt$${salt.toString("base64url")}$${scryptSync(PASSWORD, salt, 32, { N: 16384, r: 8, p: 1 }).toString("base64url")}`;

beforeEach(async () => {
  vi.stubEnv("ACCESS_GATE_PASSWORD_HASH", hash);
  vi.stubEnv("ACCESS_GATE_SECRET", SECRET);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

function request(path: string, token?: string, method = "GET") {
  return new NextRequest(`https://dream.test${path}`, { method, headers: token ? { cookie: `${ACCESS_GATE_COOKIE}=${token}` } : {} });
}

describe("site entry password", () => {
  it.each(["/", "/reading/synthetic-reading?token=synthetic", "/products", "/login", "/prompt-lab"])("gates direct navigation to %s", async path => {
    const response = await proxy(request(path));
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://dream.test/access");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each(["/api/readings", "/api/readings/synthetic", "/api/orders", "/api/auth/session"])("blocks unauthenticated API access to %s", async path => {
    const response = await proxy(request(path));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("ACCESS_GATE_REQUIRED");
  });

  it("accepts only an unexpired session signed for this gate", async () => {
    const valid = createReviewSessionToken("gate-passed", SECRET);
    expect((await proxy(request("/reading/synthetic", valid))).headers.get("x-middleware-next")).toBe("1");
    for (const token of [valid + "x", createReviewSessionToken("review-user", SECRET), createReviewSessionToken("gate-passed", "different-secret-at-least-32-characters"), createReviewSessionToken("gate-passed", SECRET, Date.now() - (REVIEW_SESSION_MAX_AGE + 1) * 1000)]) {
      expect(verifyAccessGateSession(token)).toBe(false);
      expect((await proxy(request("/api/readings/synthetic", token))).status).toBe(403);
    }
  });

  it("stays closed on partial configuration and is optional when completely unset", async () => {
    vi.stubEnv("ACCESS_GATE_SECRET", "");
    expect(accessGateEnabled()).toBe(true);
    expect((await proxy(request("/api/readings"))).status).toBe(403);
    vi.stubEnv("ACCESS_GATE_PASSWORD_HASH", "");
    vi.stubEnv("ACCESS_GATE_SECRET", SECRET);
    expect(accessGateEnabled()).toBe(true);
    expect(verifyAccessGateSession(createReviewSessionToken("gate-passed", SECRET))).toBe(false);
    vi.stubEnv("ACCESS_GATE_SECRET", "");
    expect((await proxy(request("/"))).headers.get("x-middleware-next")).toBe("1");
  });

  it("keeps the entry endpoint and operational probes available", async () => {
    for (const path of ["/access", "/api/access", "/api/healthz", "/api/readyz"]) {
      expect((await proxy(request(path))).headers.get("x-middleware-next")).toBe("1");
    }
    expect((await proxy(request("/api/payments/portone/webhook", undefined, "POST"))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(request("/api/payments/portone/webhook"))).status).toBe(403);
  });

  it("rejects a wrong password and issues a secure, HttpOnly session for the chosen password", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const unlock = (password: string, origin = "https://dream.test") => POST(new Request("https://dream.test/api/access", {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ password })
    }));
    expect((await unlock("wrong-password")).status).toBe(401);
    expect(jar.set).not.toHaveBeenCalled();
    expect((await unlock(PASSWORD, "https://untrusted.test")).status).toBe(403);
    expect(jar.set).not.toHaveBeenCalled();
    expect((await unlock(PASSWORD)).status).toBe(200);
    const [name, token, options] = jar.set.mock.calls[0];
    expect(name).toBe(ACCESS_GATE_COOKIE);
    expect(verifyAccessGateSession(token)).toBe(true);
    expect(token).not.toContain(PASSWORD);
    expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: REVIEW_SESSION_MAX_AGE });
  });
});

describe("temporary public entry", () => {
  it("stays publicly accessible during review and relocks when the review flag is removed", async () => {
    vi.stubEnv("ACCESS_GATE_OPEN_UNTIL", "");
    vi.stubEnv("ACCESS_GATE_PUBLIC_REVIEW", "true");
    expect(accessGateEnabled()).toBe(false);
    expect((await proxy(request("/"))).headers.get("x-middleware-next")).toBe("1");
    expect(jar.set).not.toHaveBeenCalled();
    vi.stubEnv("ACCESS_GATE_PUBLIC_REVIEW", "false");
    expect(accessGateEnabled()).toBe(true);
  });
  it("opens until the deadline without issuing a permanent bypass cookie", async () => {
    vi.stubEnv("ACCESS_GATE_OPEN_UNTIL", new Date(Date.now() + 3_600_000).toISOString());
    expect(accessGateEnabled()).toBe(false);
    expect((await proxy(request("/"))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(request("/api/readings"))).headers.get("x-middleware-next")).toBe("1");
    expect(jar.set).not.toHaveBeenCalled();
  });
  it.each(["", "not-a-date", "2099-01-01", "2020-01-01T00:00:00.000Z"])("stays locked for expired or malformed deadline %s", async deadline => {
    vi.stubEnv("ACCESS_GATE_OPEN_UNTIL", deadline);
    expect(accessGateEnabled()).toBe(true);
    expect((await proxy(request("/api/readings"))).status).toBe(403);
  });
  it("relocks at the exact deadline", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.stubEnv("ACCESS_GATE_OPEN_UNTIL", new Date(now + 1000).toISOString());
    expect(accessGateEnabled()).toBe(false);
    vi.mocked(Date.now).mockReturnValue(now + 1000);
    expect(accessGateEnabled()).toBe(true);
    vi.mocked(Date.now).mockRestore();
  });
});
