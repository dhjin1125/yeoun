import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { generateFreeAssistant } from "@/lib/ai";
import * as provider from "@/lib/ai/codex-local";
import { analyzeDreamContextLocally } from "@/lib/local-engine";
import { FREE_INTERPRETATION_POLICY_VERSION } from "@/lib/ai/free-interpretation-policy";

// Opt-in single synthetic generation; never changes service model settings.
// Raw input, effective instructions and outputs stay in the private archive.
describe.runIf(process.env.RUN_FREE_POLICY_LIVE === "true")("free policy live contract", () => {
  it("generates one reading using IDs and the approved interpretation policy", async () => {
    process.loadEnvFile(".env.local");
    vi.stubEnv("APP_PROFILE", "local-ai");
    const startedAt = new Date().toISOString();
    const archiveId = `policy-${Date.now()}-${randomUUID()}`;
    const directory = ".data/prompt-lab/policy-checks";
    const dream = "꿈에서 오랜 친구와 낡은 역에 있었어요. 친구는 먼저 기차에 탔고 나는 표를 찾다가 기차를 놓쳤어요. 혼자 남은 역을 보며 아쉬웠어요.";
    const calls: unknown[] = [];
    let result: unknown = null;
    let failureCode: string | null = null;
    const generate = provider.generateWithLocalCodex;
    const spy = vi.spyOn(provider, "generateWithLocalCodex").mockImplementation(async request => {
      const record = { schema: request.schemaName, instructions: request.instructions, input: JSON.parse(request.inputJson),
        model: request.model ?? provider.localCodexModelLabel(request.operation),
        effort: request.reasoningEffort ?? process.env[`CODEX_LOCAL_${request.operation.toUpperCase()}_REASONING_EFFORT`] ?? process.env.CODEX_LOCAL_REASONING_EFFORT ?? "low",
        result: null as unknown };
      calls.push(record);
      record.result = await generate(request);
      return record.result as never;
    });
    try {
      expect(provider.localCodexConfigured()).toBe(true);
      result = await generateFreeAssistant(analyzeDreamContextLocally(dream, null).context, archiveId, dream);
      expect(result).toMatchObject({ freeCompositionVersion: 2, freeReadingMode: "symbolic", generationSource: "codex" });
      expect(calls.some(call => (call as { schema: string }).schema === "dream_symbol_meanings_by_id")).toBe(true);
      expect(calls.some(call => (call as { schema: string }).schema === "free_semantic_review")).toBe(true);
    } catch (error) {
      failureCode = typeof error === "object" && error && "code" in error ? String(error.code) : error instanceof Error ? error.name : "UNKNOWN";
      throw error;
    } finally {
      spy.mockRestore();
      vi.unstubAllEnvs();
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(`${directory}/${archiveId}.json`, JSON.stringify({ archiveId, policyVersion: FREE_INTERPRETATION_POLICY_VERSION, startedAt, endedAt: new Date().toISOString(), dream, calls, result, failureCode }, null, 2), { flag: "wx", mode: 0o600 });
      console.info(JSON.stringify({ event: "free_policy_live_archive", archiveId, callCount: calls.length, success: result !== null && failureCode === null, failureCode }));
    }
  }, 360_000);
});
