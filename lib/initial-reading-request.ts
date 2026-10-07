import "server-only";
import { hashToken, opaqueToken } from "./crypto";
import { AppError } from "./http";
import type { DreamRepository } from "./repository";
import type { ReadingRecord } from "./types";

// This short-lived replay cache stores IDs only. It complements the repository
// lease and platform IP limiter; it is not a cross-instance cache on review memory.
const MAX_ENTRIES = 512;
const REPLAY_MS = 60_000;
const leases = new WeakMap<DreamRepository, Map<string, { id: string; until: number }>>();

export async function createInitialReadingOnce(
  sessionHash: string,
  input: { dream: string; emotion: string | null; focus?: string | null },
  repository: DreamRepository,
  generate: () => Promise<ReadingRecord>
): Promise<ReadingRecord> {
  const key = `initial:${sessionHash}`;
  const replayKey = hashToken(JSON.stringify([sessionHash, input.dream, input.emotion, input.focus ?? null]));
  let cache = leases.get(repository);
  if (!cache) { cache = new Map(); leases.set(repository, cache); }
  for (const [id, entry] of cache) if (entry.until <= Date.now()) cache.delete(id);
  const replay = cache.get(replayKey);
  if (replay) {
    const reading = await repository.getReading(replay.id);
    if (reading && reading.sessionHash === sessionHash && Date.parse(reading.expiresAt) > Date.now()) return reading;
    cache.delete(replayKey);
  }
  const lease = opaqueToken();
  const mutate = async (kind: "admit" | "heartbeat" | "release") => {
    try {
      return await repository.mutateConversationGuard(key,
        kind === "admit" ? { kind, scope: "reading", lease } : { kind, lease },
        Date.now() + 3_600_000);
    } catch {
      throw new AppError("DREAM_REQUEST_CHECK_UNAVAILABLE", "요청을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.", 503);
    }
  };
  const admitted = await mutate("admit");
  if (admitted.status === "busy") throw new AppError("DREAM_REQUEST_IN_PROGRESS", "이 브라우저에서 해석이 진행 중이에요. 결과가 나올 때까지 기다려 주세요.", 409);
  if (admitted.status !== "allowed") throw new AppError("DREAM_REQUEST_RATE_LIMITED", "요청이 많아요. 잠시 후 다시 보내주세요.", 429, admitted.retryAfterSeconds || 1);
  let active = true;
  const heartbeat = setInterval(() => {
    void mutate("heartbeat").then(result => { if (result.status !== "allowed") active = false; }).catch(() => { active = false; });
  }, 60_000);
  heartbeat.unref?.();
  try {
    const reading = await generate();
    if (active) {
      // Keep memory bounded without dropping pending leases or raw user content.
      if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
      cache.set(replayKey, { id: reading.id, until: Date.now() + REPLAY_MS });
    }
    return reading;
  } finally {
    clearInterval(heartbeat);
    // A delivered result must not become an apparent failure due to cleanup.
    try { await mutate("release"); }
    catch { console.error(JSON.stringify({ event: "initial_request_lease_release_failed" })); }
  }
}
