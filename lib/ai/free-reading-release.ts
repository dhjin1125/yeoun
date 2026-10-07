import "server-only";

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { AppError } from "../http";
import type { buildReadingContext } from "../reading-context";
import { SYMBOLIC_FREE_READING_PROMPT } from "./prompts";

const LOCAL_APPROVED_RELEASE = join(process.cwd(), ".data/prompt-lab/releases/experiment-73-1790297427150-3dcaf70f-6571-4ffc-907a-44af8c98e193.json");
const LOCAL_APPROVED_SHA256 = "c9bf6f789e364d4396dc024860b057f3fef6e7233271005ac40b182012250d54";

const releaseSchema = z.object({
  schemaVersion: z.literal(1),
  experimentId: z.number().int().positive(),
  instructions: z.string().min(1).max(40_000)
});

const referenceSchema = z.object({
  matchingInput: z.object({
    dream: z.string().min(1),
    emotion: z.string().nullable()
  }),
  composition: z.unknown().optional()
});

const approvedCompositionSchema = z.object({
  symbols: z.array(z.object({ title: z.string().min(2), meaning: z.string().min(1) })).min(1),
  integratedReading: z.object({ title: z.string().min(2), paragraphs: z.array(z.string()).min(1), evidenceQuotes: z.array(z.string()) }).nullable(),
  nextQuestion: z.string().nullable()
});

type ReadingEvidence = ReturnType<typeof buildReadingContext>["evidence"];

function matchesApprovedInput(evidence: ReadingEvidence, matchingInput: z.infer<typeof referenceSchema>["matchingInput"]) {
  const normalizeEnding = (value: string) => value.trim().replace(/[.!?。？！]+$/u, "");
  return normalizeEnding(evidence.originalDream) === normalizeEnding(matchingInput.dream)
    && evidence.selectedEmotion === matchingInput.emotion
    && !evidence.selectedFocusQuestion
    && evidence.clarifications.length === 0;
}

async function approvedRelease() {
  const configuredFile = process.env.FREE_READING_PROMPT_FILE?.trim();
  const configuredHash = process.env.FREE_READING_PROMPT_SHA256?.trim();
  const configured = process.env.FREE_READING_PROMPT_FILE !== undefined || process.env.FREE_READING_PROMPT_SHA256 !== undefined;
  const localReleaseAvailable = !configured && existsSync(LOCAL_APPROVED_RELEASE);
  const file = configured ? configuredFile : localReleaseAvailable ? LOCAL_APPROVED_RELEASE : undefined;
  const expectedHash = configured ? configuredHash : localReleaseAvailable ? LOCAL_APPROVED_SHA256 : undefined;
  if (!file && !expectedHash) return null;
  try {
    if (!file || !expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error("configuration");
    const bytes = await readFile(file);
    if (bytes.byteLength > 200_000) throw new Error("size");
    const release = releaseSchema.parse(JSON.parse(bytes.toString("utf8")));
    const sha256 = createHash("sha256").update(release.instructions, "utf8").digest("hex");
    if (sha256 !== expectedHash) throw new Error("integrity");
    const referenceText = release.instructions.match(/<approvedReference>\s*([\s\S]*?)\s*<\/approvedReference>/)?.[1];
    const generalInstructions = release.instructions.match(/<NEW_INPUT_ONLY>\s*([\s\S]*?)\s*<\/NEW_INPUT_ONLY>/)?.[1]?.trim();
    if (!referenceText || !generalInstructions) throw new Error("sections");
    const reference = referenceSchema.parse(JSON.parse(referenceText));
    return { ...release, sha256, reference, matchingInput: reference.matchingInput, generalInstructions };
  } catch {
    // Neither the private prompt nor the deployment path belongs in a public error.
    // A broken release must not silently switch back to an older interpretation.
    throw new AppError("FREE_READING_PROMPT_UNAVAILABLE", "승인한 풀이 지침을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.", 503);
  }
}

export async function freeReadingReleaseStatus() {
  const release = await approvedRelease();
  return release
    ? { source: "approved_experiment" as const, experimentId: release.experimentId, sha256: release.sha256 }
    : { source: "builtin" as const };
}

export async function freeReadingInstructions(evidence: ReadingEvidence, experimentInstructions?: string) {
  // Prompt Lab overrides stay request-local and do not change the deployed release.
  if (experimentInstructions !== undefined) return experimentInstructions;
  const release = await approvedRelease();
  if (!release) return SYMBOLIC_FREE_READING_PROMPT;
  const sameInput = matchesApprovedInput(evidence, release.matchingInput);
  // Only the approved input receives its private reference. Other customers'
  // requests receive the release's general instructions without that example.
  return sameInput ? release.instructions : release.generalInstructions;
}

/** A selected, hash-verified reference can be replayed for its exact original input. */
export async function approvedFreeComposition(evidence: ReadingEvidence) {
  const release = await approvedRelease();
  if (!release?.reference.composition) return null;
  const sameInput = matchesApprovedInput(evidence, release.matchingInput);
  if (!sameInput) return null;
  return approvedCompositionSchema.safeParse(release.reference.composition).data ?? null;
}
