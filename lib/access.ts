import "server-only";

import { verifyRestoreToken } from "./crypto";
import { currentUserId } from "./auth/server";
import { readDreamSession } from "./session";
import type { ReadingRecord } from "./types";

export async function canAccessReading(reading: ReadingRecord, restoreToken?: string | null) {
  const session = await readDreamSession();
  if (session?.hash === reading.sessionHash) return true;
  if (restoreToken && verifyRestoreToken(restoreToken, reading.id)) return true;
  const userId = await currentUserId();
  return Boolean(userId && reading.ownerUserId === userId);
}
