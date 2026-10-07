import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { approvedFreeComposition, freeReadingInstructions, freeReadingReleaseStatus } from "@/lib/ai/free-reading-release";
import { SYMBOLIC_FREE_READING_PROMPT } from "@/lib/ai/prompts";
import { buildReadingContext } from "@/lib/reading-context";
import { analyzeDreamContextLocally } from "@/lib/local-engine";
import type { Emotion } from "@/lib/types";

const directories: string[] = [];
const dream = "꿈에서 파란 우산을 접고 집으로 돌아왔어요.";
const generalInstructions = "입력한 꿈의 행동과 최근 계기를 가능한 설명으로 연결하세요.";
const instructions = `승인된 입력의 구성 보존\n<approvedReference>\n${JSON.stringify({
  matchingInput: { dream, emotion: null },
  composition: { privateExample: "비공개 승인 예시" }
})}\n</approvedReference>\n<NEW_INPUT_ONLY>\n${generalInstructions}\n</NEW_INPUT_ONLY>`;

async function configureRelease(selectedInstructions = instructions) {
  const directory = await mkdtemp(join(tmpdir(), "dream-release-test-"));
  directories.push(directory);
  const file = join(directory, "release.json");
  await writeFile(file, JSON.stringify({ schemaVersion: 1, experimentId: 73, instructions: selectedInstructions }), { mode: 0o600 });
  vi.stubEnv("FREE_READING_PROMPT_FILE", file);
  vi.stubEnv("FREE_READING_PROMPT_SHA256", createHash("sha256").update(selectedInstructions).digest("hex"));
  return file;
}

function evidence(text = dream, emotion: Emotion | null = null) {
  return buildReadingContext(analyzeDreamContextLocally(text, emotion).context, text, {
    selectedEmotion: emotion, clarificationAnswers: []
  }).evidence;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("approved free-reading release", () => {
  it("replays the approved composition only for the exact input", async () => {
    const composition = {
      symbols: [{ title: "접힌 우산", meaning: "익숙한 장면을 새로 바라볼 수 있어요." }],
      integratedReading: { title: "함께 읽기", paragraphs: ["우산을 접고 돌아온 장면을 연결해 볼 수 있어요."], evidenceQuotes: ["파란 우산"] },
      nextQuestion: "돌아올 때 어떤 기분이었나요?"
    };
    const selectedInstructions = `승인된 입력\n<approvedReference>${JSON.stringify({ matchingInput: { dream, emotion: null }, composition })}</approvedReference>\n<NEW_INPUT_ONLY>${generalInstructions}</NEW_INPUT_ONLY>`;
    await configureRelease(selectedInstructions);
    expect(await approvedFreeComposition(evidence())).toEqual(composition);
    expect(await approvedFreeComposition(evidence(dream.slice(0, -1)))).toEqual(composition);
    expect(await approvedFreeComposition(evidence("꿈에서 다른 곳으로 갔어요."))).toBeNull();
  });
  it("keeps unconfigured installations on their existing prompt", async () => {
    vi.stubEnv("FREE_READING_PROMPT_FILE", "");
    vi.stubEnv("FREE_READING_PROMPT_SHA256", "");
    expect(await freeReadingInstructions(evidence())).toBe(SYMBOLIC_FREE_READING_PROMPT);
  });

  it("passes the exact approved instructions for the same input after edge whitespace normalization", async () => {
    await configureRelease();
    expect(await freeReadingInstructions(evidence(`  ${dream}\n`))).toBe(instructions);
    expect(await freeReadingReleaseStatus()).toEqual({
      source: "approved_experiment", experimentId: 73,
      sha256: createHash("sha256").update(instructions).digest("hex")
    });
  });

  it.each(["dream", "emotion", "clarification", "focus"])("removes the private reference when %s changes", async field => {
    await configureRelease();
    const input = evidence(field === "dream" ? "꿈에서 바다를 바라봤어요." : dream);
    if (field === "emotion") input.selectedEmotion = "불안" as Emotion;
    if (field === "clarification") input.clarifications = [{ kind: "recent_context", text: "최근 산책했어요." }];
    if (field === "focus") input.selectedFocusQuestion = "왜 이런 꿈을 꿨을까요?";
    const selected = await freeReadingInstructions(input);
    expect(selected).toBe(generalInstructions);
    expect(selected).not.toContain(dream);
    expect(selected).not.toContain("비공개 승인 예시");
  });

  it("keeps lab overrides isolated from the published release", async () => {
    await configureRelease();
    expect(await freeReadingInstructions(evidence(), "이번 요청만의 실험 지침")).toBe("이번 요청만의 실험 지침");
    expect(await freeReadingInstructions(evidence())).toBe(instructions);
  });

  it.each(["missing_file", "changed_instructions", "missing_hash"])("fails closed for %s instead of falling back or exposing private content", async failure => {
    const file = await configureRelease();
    if (failure === "missing_file") await rm(file);
    if (failure === "changed_instructions") await writeFile(file, JSON.stringify({ schemaVersion: 1, experimentId: 73, instructions: `${instructions}\n수정` }));
    if (failure === "missing_hash") vi.stubEnv("FREE_READING_PROMPT_SHA256", "");
    await expect(freeReadingInstructions(evidence())).rejects.toMatchObject({ code: "FREE_READING_PROMPT_UNAVAILABLE", status: 503 });
    await expect(freeReadingReleaseStatus()).rejects.not.toHaveProperty("message", expect.stringContaining(dream));
  });
});
