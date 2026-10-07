/** Server-owned counters only: never store message text, tokens or client IPs. */
export type ConversationGuardState = {
  minuteAt: number;
  minuteCount: number;
  hourAt: number;
  hourCount: number;
  graceUsed: boolean;
  rejectionAt: number;
  rejectionCount: number;
  cooldownUntil: number;
  lastRejectedKey: string | null;
  lastRejectedGrace: boolean;
  lease: string | null;
  leaseUntil: number;
};

export type ConversationGuardCommand =
  | { kind: "admit"; scope: "reading" | "principal"; lease: string }
  | { kind: "reject"; lease: string; requestKey: string; offTopic: boolean }
  | { kind: "release" | "heartbeat"; lease: string };

export type ConversationGuardResult = {
  status: "allowed" | "busy" | "limited" | "rejected" | "stale";
  retryAfterSeconds: number;
  grace: boolean;
};

export const CONVERSATION_LIMITS = {
  reading: { minute: 6, hour: 20 },
  principal: { minute: 10, hour: 40 },
  rejectionWindowMs: 10 * 60_000,
  rejectionLimit: 3,
  cooldownMs: 60_000,
  leaseMs: 30 * 60_000
} as const;

export function transitionConversationGuard(
  previous: ConversationGuardState | null,
  command: ConversationGuardCommand,
  now: number
): { state: ConversationGuardState; result: ConversationGuardResult } {
  const state: ConversationGuardState = previous ? { ...previous } : {
    minuteAt: now, minuteCount: 0, hourAt: now, hourCount: 0,
    graceUsed: false, rejectionAt: now, rejectionCount: 0, cooldownUntil: 0,
    lastRejectedKey: null, lastRejectedGrace: false, lease: null, leaseUntil: 0
  };
  const result: ConversationGuardResult = { status: "allowed", retryAfterSeconds: 0, grace: false };
  const limited = (until: number) => {
    result.status = "limited";
    result.retryAfterSeconds = Math.max(1, Math.ceil((until - now) / 1000));
  };
  if (command.kind === "admit") {
    if (now - state.minuteAt >= 60_000) { state.minuteAt = now; state.minuteCount = 0; }
    if (now - state.hourAt >= 3_600_000) { state.hourAt = now; state.hourCount = 0; }
    const limits = CONVERSATION_LIMITS[command.scope];
    if (state.cooldownUntil > now) limited(state.cooldownUntil);
    else if (state.hourCount >= limits.hour) limited(state.hourAt + 3_600_000);
    else if (state.minuteCount >= limits.minute) limited(state.minuteAt + 60_000);
    else {
      // Busy and duplicate attempts still use the request budget, never question credits.
      state.minuteCount += 1;
      state.hourCount += 1;
      if (command.scope === "reading") {
        if (state.lease && state.leaseUntil > now) result.status = "busy";
        else { state.lease = command.lease; state.leaseUntil = now + CONVERSATION_LIMITS.leaseMs; }
      }
    }
  } else if (state.lease !== command.lease || state.leaseUntil <= now) {
    result.status = "stale";
  } else if (command.kind === "release") {
    state.lease = null;
    state.leaseUntil = 0;
  } else if (command.kind === "heartbeat") {
    state.leaseUntil = now + CONVERSATION_LIMITS.leaseMs;
  } else if (command.kind === "reject") {
    result.status = "rejected";
    // A transport retry repeats the same notice; it does not use another grace.
    if (state.lastRejectedKey === command.requestKey) result.grace = state.lastRejectedGrace;
    else {
      if (now - state.rejectionAt >= CONVERSATION_LIMITS.rejectionWindowMs) {
        state.rejectionAt = now;
        state.rejectionCount = 0;
      }
      result.grace = command.offTopic && !state.graceUsed;
      if (command.offTopic) {
        state.graceUsed = true;
        state.rejectionCount += 1;
        if (state.rejectionCount >= CONVERSATION_LIMITS.rejectionLimit) {
          state.cooldownUntil = now + CONVERSATION_LIMITS.cooldownMs;
          state.rejectionCount = 0;
          result.retryAfterSeconds = Math.ceil(CONVERSATION_LIMITS.cooldownMs / 1000);
        }
      }
      state.lastRejectedKey = command.requestKey;
      state.lastRejectedGrace = result.grace;
    }
  }
  return { state, result };
}

export type StoredConversationGuard = { state: ConversationGuardState; expiresAt: number };

/** Used only by the local/review memory repository and isolated test repositories. */
export function mutateMemoryConversationGuard(
  guards: Map<string, StoredConversationGuard>, key: string,
  command: ConversationGuardCommand, expiresAt: number
) {
  const now = Date.now();
  for (const [entryKey, entry] of guards) if (entry.expiresAt <= now) guards.delete(entryKey);
  const updated = transitionConversationGuard(guards.get(key)?.state ?? null, command, now);
  guards.set(key, { state: updated.state, expiresAt });
  return updated.result;
}
