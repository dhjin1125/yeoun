import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPaidTestRecorder } from "@/lib/ai/paid-test-archive";
import { decryptJson } from "@/lib/crypto";

const owned: string[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), "paid-archive-synthetic-")); owned.push(root);
  vi.stubEnv("APP_PROFILE", "local-ai");
  vi.stubEnv("PAYMENTS_MODE", "mock");
  vi.stubEnv("DREAM_DATABASE_PATH", join(root, "test.sqlite3"));
  return root;
}
afterEach(() => { vi.unstubAllEnvs(); for (const root of owned.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("private paid test archive", () => {
  it("keeps immutable encrypted attempts with private file permissions", async () => {
    const root = setup(); const record = createPaidTestRecorder();
    await record("writer_response", { text: "synthetic-private-dream-marker" });
    await record("independent_review", { feedback: "synthetic-private-feedback-marker" });
    const directory = join(root, "prompt-lab", "paid-runtime");
    const names = readdirSync(directory);
    expect(names).toHaveLength(2);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    const decoded = names.map(name => {
      const file = join(directory, name); const text = readFileSync(file, "utf8");
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(text).not.toContain("synthetic-private-");
      const { data } = JSON.parse(text);
      return decryptJson<{ stage: string; payload: Record<string, unknown> }>(data.encryptedDetails, "context", data.traceId);
    });
    expect(decoded.find(item => item.stage === "writer_response")?.payload.text).toBe("synthetic-private-dream-marker");
    expect(decoded.find(item => item.stage === "independent_review")?.payload.feedback).toBe("synthetic-private-feedback-marker");
  });
  it.each(["live", "non-codex"])("does not record outside mock Codex testing: %s", async mode => {
    const root = setup();
    if (mode === "live") vi.stubEnv("PAYMENTS_MODE", "portone");
    else { vi.stubEnv("APP_PROFILE", ""); vi.stubEnv("AI_MODE", "local"); }
    await createPaidTestRecorder()("writer_response", { text: "synthetic-private-marker" });
    expect(readdirSync(root)).toEqual([]);
  });
});
