/** Explicit opt-in check of the approved local free result and one paid preview. */
import { it, expect } from "vitest";
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decryptJson } from "@/lib/crypto";
import { createReading, getPublicReading, preparePaidPreview } from "@/lib/readings";
import { getRepository } from "@/lib/repository";
import type { AssistantTurnPayload } from "@/lib/types";

it.skipIf(process.env.RUN_APPROVED_73_PREVIEW !== "true")("keeps the approved free result and prepares one reviewed paid preview", async () => {
  loadEnvConfig(process.cwd());
  const path = join(process.cwd(), ".data/prompt-lab/releases/experiment-73-1790297427150-3dcaf70f-6571-4ffc-907a-44af8c98e193.json");
  const release = JSON.parse(await readFile(path, "utf8")) as { instructions: string };
  const reference = JSON.parse(release.instructions.match(/<approvedReference>\s*([\s\S]*?)\s*<\/approvedReference>/)?.[1] ?? "null") as {
    matchingInput: { dream: string; emotion: null };
    composition: { symbols: Array<{ title: string; meaning: string }>; integratedReading: { title: string; paragraphs: string[] }; nextQuestion: string | null };
  };
  const repository = getRepository();
  const evidencePath = join(process.cwd(), ".data/prompt-lab/requested-runs", `approved-73-final-${randomUUID()}.json`);
  let record: { readingId?: string; restoreUrl?: string; freeMatches?: boolean; paidPrepared?: boolean; lockedCount?: number; error?: string } = {};
  try {
    const existingId = process.env.APPROVED_73_EXISTING_READING_ID;
    const reading = existingId
      ? await repository.getReading(existingId)
      : await createReading(reference.matchingInput, `approved-73-final-${randomUUID()}`, repository);
    if (!reading) throw new Error("EXISTING_READING_MISSING");
    record.readingId = reading.id;
    const publicReading = await getPublicReading(reading, "http://localhost:3000", repository);
    record.restoreUrl = publicReading.restoreUrl;
    const freeTurn = (await repository.getConversationTurns(reading.id)).find(turn => turn.kind === "free" && turn.status === "complete");
    if (!freeTurn) throw new Error("FREE_TURN_MISSING");
    const free = decryptJson<AssistantTurnPayload>(freeTurn.encryptedContent, "turn", freeTurn.id);
    record.freeMatches = free.directAnswerTitle === reference.composition.symbols[0]?.title &&
      free.directAnswer === reference.composition.symbols[0]?.meaning &&
      free.sections.at(-1)?.title === reference.composition.integratedReading.title &&
      JSON.stringify(free.sections.at(-1)?.paragraphs) === JSON.stringify(reference.composition.integratedReading.paragraphs) &&
      (free.readingQuestion ?? null) === reference.composition.nextQuestion;
    expect(record.freeMatches).toBe(true);
    expect(publicReading.canPurchaseFullReading).toBe(true);
    const preview = await preparePaidPreview(reading, repository);
    record.paidPrepared = Boolean(preview.lead && preview.opening.paragraphs.length && preview.lockedSections.length);
    record.lockedCount = preview.lockedSections.length;
    expect(record.paidPrepared).toBe(true);
  } catch (error) {
    record.error = error instanceof Error ? ("code" in error ? String(error.code) : error.name) : "UNKNOWN";
    throw new Error(`APPROVED_73_PREVIEW_FAILED:${record.error}`);
  } finally {
    await mkdir(join(process.cwd(), ".data/prompt-lab/requested-runs"), { recursive: true, mode: 0o700 });
    await writeFile(evidencePath, JSON.stringify(record), { flag: "wx", mode: 0o600 });
    console.info(JSON.stringify({ event: "approved_73_preview", evidencePath, freeMatches: record.freeMatches, paidPrepared: record.paidPrepared, lockedCount: record.lockedCount, error: record.error }));
  }
}, 10 * 60_000);
