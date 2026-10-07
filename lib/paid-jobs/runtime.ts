import "server-only";
import { resolve } from "node:path";
import { getRepository, type DreamRepository } from "../repository";
import { SQLiteRepository } from "../repository/sqlite";
import { PaidJobStore } from "./store";

export function paidJobsEnabled() { return process.env.PAID_GENERATION_JOBS === "true"; }
declare global { var __dreamPaidJobStores: Map<string, PaidJobStore> | undefined; }
export function paidJobStore(repository: DreamRepository = getRepository()) {
  if (!paidJobsEnabled()) return null;
  if (!(repository instanceof SQLiteRepository)) throw new Error("PAID_JOBS_REQUIRE_SQLITE_ORIGIN");
  const key = resolve(repository.databasePath);
  const stores = globalThis.__dreamPaidJobStores ??= new Map();
  let store = stores.get(key);
  if (!store) { store = new PaidJobStore(key); stores.set(key, store); }
  return store;
}
export function resetPaidJobStoresForTests() {
  for (const store of globalThis.__dreamPaidJobStores?.values() ?? []) store.close();
  globalThis.__dreamPaidJobStores = undefined;
}

export async function paidOrderCapacityAvailable(repository: DreamRepository = getRepository()) {
  if (process.env.NODE_ENV !== "production") return true;
  const store = paidJobStore(repository);
  if (!store) return true;
  if (!store.workerHealthy()) return false;
  const localCapacity = store.deliverySummary();
  if (localCapacity.attentionCount > 0 || localCapacity.backlogCount >= 8 || localCapacity.staleRunningCount > 0 ||
    (localCapacity.oldestWaitingAt && Date.now() - localCapacity.oldestWaitingAt > 5 * 60_000)) return false;

  const baseUrl = process.env.CODEX_BRIDGE_URL?.trim().replace(/\/+$/, "");
  const token = process.env.CODEX_BRIDGE_TOKEN?.trim();
  if (!baseUrl || !token) return true;
  try {
    const response = await fetch(`${baseUrl}/healthz`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(2_500)
    });
    if (!response.ok) return false;
    const health = await response.json() as { running?: unknown; queued?: unknown };
    const running = Number(health.running ?? 0), queued = Number(health.queued ?? 0);
    return Number.isFinite(running) && Number.isFinite(queued) && running >= 0 && queued >= 0 && queued < 7;
  } catch {
    return false;
  }
}
