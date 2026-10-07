import { afterEach, describe, expect, it, vi } from "vitest";
import { guardOriginRequest } from "@/lib/origin-request-guard";
import { mutateMemoryConversationGuard, type StoredConversationGuard } from "@/lib/conversation-guard";
import type { DreamRepository } from "@/lib/repository";
const req = (ip = "203.0.113.5", path = "/api/readings", method = "POST", extra = {}) => new Request(`https://dream.test${path}`, { method, headers: { "x-yeoun-peer-ip": ip, ...extra } });
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const states = new Map<string, StoredConversationGuard>();
  const mutate = vi.fn(async (key, command, expires) => mutateMemoryConversationGuard(states, key, command, expires));
  return { states, mutate, repo: { mutateConversationGuard: mutate } as unknown as DreamRepository };
}
describe("origin request budget", () => {
  it("keeps bounded analytics traffic separate from generation and authentication", async () => {
    const { repo } = fixture();
    for (let i = 0; i < 10; i++) expect(await guardOriginRequest(req(undefined, "/api/events"), repo)).toBeNull();
    expect((await guardOriginRequest(req(undefined, "/api/events"), repo))?.status).toBe(429);
    expect(await guardOriginRequest(req(), repo)).toBeNull();
    expect(await guardOriginRequest(req(undefined, "/api/auth/login"), repo)).toBeNull();
    for (let i = 0; i < 8; i++) expect(await guardOriginRequest(req(), repo)).toBeNull();
    expect((await guardOriginRequest(req(), repo))?.status).toBe(429);
  });
  it("does not treat other paths under events as analytics exemptions", async () => {
    const { repo } = fixture();
    for (let i = 0; i < 10; i++) expect(await guardOriginRequest(req(undefined, "/api/events/other"), repo)).toBeNull();
    expect((await guardOriginRequest(req(), repo))?.status).toBe(429);
    expect(await guardOriginRequest(req(undefined, "/api/events"), repo)).toBeNull();
  });
  it("limits cookie churn and spoofed forwarding headers before work; permits another peer", async () => {
    const { repo, states } = fixture();
    for (let i = 0; i < 10; i++) expect(await guardOriginRequest(req(undefined, undefined, undefined, { cookie: `session=${i}`, "x-forwarded-for": `192.0.2.${i}` }), repo)).toBeNull();
    const blocked = await guardOriginRequest(req(), repo);
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await guardOriginRequest(req("203.0.113.6"), repo)).toBeNull();
    expect([...states.keys()].join()).not.toContain("203.0.113");
  });
  it("shares a fail-closed fallback for absent or invalid peer headers", async () => {
    const { repo, states } = fixture();
    await guardOriginRequest(req(""), repo); await guardOriginRequest(req("forged"), repo);
    expect(states.size).toBe(1);
  });
  it("allows reads and signed provider webhook to reach their own handlers", async () => {
    const { repo, mutate } = fixture();
    expect(await guardOriginRequest(req(undefined, "/api/healthz", "GET"), repo)).toBeNull();
    expect(await guardOriginRequest(req(undefined, "/api/payments/portone/webhook"), repo)).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });
  it("fails closed on storage errors", async () => {
    const { repo, mutate } = fixture(); mutate.mockRejectedValue(new Error("private details"));
    const response = await guardOriginRequest(req(), repo);
    expect(response?.status).toBe(503); expect(await response?.text()).not.toContain("private details");
  });
});
