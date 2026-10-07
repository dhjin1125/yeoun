import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePaidLabReading } from "@/lib/prompt-lab-paid";

const { generateDetailedAssistant, record } = vi.hoisted(() => {
  const generateDetailedAssistant = vi.fn(async (...args: unknown[]) => {
  const hooks = args[8] as { save: (state: unknown) => Promise<void>; record: (payload: Record<string, unknown>) => Promise<void> };
  await hooks.save({ stage: "writer", draft: "private snapshot" });
  await hooks.record({ stage: "review", accepted: true });
  return { generationSource: "codex", directAnswer: "paid result", sections: [] };
  });
  const record = vi.fn(async () => ({ id: "snapshot-1", savedAt: "now" }));
  return { generateDetailedAssistant, record };
});

vi.mock("@/lib/ai", () => ({ generateDetailedAssistant }));
vi.mock("@/lib/prompt-lab-archive", () => ({ promptLabArchive: { record } }));

afterEach(() => vi.clearAllMocks());

describe("paid Prompt Lab generator", () => {
  it("passes no prior free result, forwards exact instructions, and persists private snapshots", async () => {
    const instructions = "EXACT LAB INSTRUCTIONS";
    const result = await generatePaidLabReading({
      context: {} as never,
      sessionHash: "session-hash",
      dream: "synthetic dream",
      safetyRoute: "none",
      evidence: { selectedEmotion: null, clarificationAnswers: [] },
      instructions,
      requestId: "request-1",
      experimentId: 7,
      workspaceId: "workspace-1",
      report: vi.fn()
    });

    expect(result).toMatchObject({ generationSource: "codex", directAnswer: "paid result" });
    const args = generateDetailedAssistant.mock.calls[0];
    expect(args[6]).toBeUndefined();
    expect(args[7]).toBeUndefined();
    expect(args[10]).toContain(instructions);
    expect(args[10]).toContain("안전");
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledWith("snapshot", expect.objectContaining({ type: "paid_lab_pipeline", requestId: "request-1", state: expect.any(Object) }));
    expect(record).toHaveBeenCalledWith("snapshot", expect.objectContaining({ type: "paid_lab_pipeline", requestId: "request-1", stage: "review" }));
  });
});
