import "server-only";
import { generatePaidJobPayload } from "../readings";
import { getRepository, type DreamRepository } from "../repository";
import { PaidPipelineError } from "../ai/paid-pipeline";
import { LocalCodexError } from "../ai/codex-local";
import { paidJobStore } from "./runtime";
import { PaidJobLeaseLost, type PaidJobStore } from "./store";

export function paidFailure(error: unknown) {
  if (error instanceof PaidPipelineError) return { code: error.code, retryable: error.retryable };
  const candidate = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const code = /^[A-Z][A-Z0-9_]{2,80}$/.test(candidate) ? candidate : "PAID_PROVIDER_FAILURE";
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
  const retryable = [408, 429, 500, 502, 503, 504].includes(status) ||
    ["LOCAL_CODEX_TIMEOUT", "LOCAL_CODEX_EXEC_FAILED", "LOCAL_CODEX_INVALID_OUTPUT", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED"].includes(code) ||
    (error instanceof Error && ["APIConnectionError", "APIConnectionTimeoutError", "ZodError"].includes(error.name)) ||
    (error instanceof TypeError && error.message === "fetch failed");
  return { code, retryable };
}

export async function runPaidJobOnce(store: PaidJobStore, repository: DreamRepository = getRepository(), generate = generatePaidJobPayload) {
  const job = store.claim();
  if (!job) return false;
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    try { if (!store.heartbeat(job)) leaseLost = true; } catch { leaseLost = true; }
  }, 20_000);
  heartbeat.unref();
  try {
    const reading = await repository.getReading(job.reading_id);
    if (!reading) throw new PaidJobLeaseLost();
    const payload = await generate(reading, repository, {
      state: store.resume(job),
      async save(state) { if (leaseLost) throw new PaidJobLeaseLost(); store.checkpoint(job, state); },
      async record(payload) { if (leaseLost) throw new PaidJobLeaseLost(); store.record(job, payload); }
    }, job.order_id ?? undefined);
    if (leaseLost) throw new PaidJobLeaseLost();
    if ("paidCompositionVersion" in payload && payload.paidCompositionVersion === 3) store.completeCompositionV3(job, payload);
    else store.complete(job, payload as import("../types").AssistantTurnPayload);
    console.info(JSON.stringify({ event: "paid_job_completed", jobId: job.id, executions: job.executions, durationMs: Date.now() - job.created_at }));
  } catch (error) {
    if (!(error instanceof PaidJobLeaseLost)) {
      const failure = paidFailure(error);
      try {
        store.fail(job, failure.code, failure.retryable, error instanceof Error ? { name: error.name, message: error.message.slice(0, 8000), stack: error.stack?.slice(0, 8000), ...(error instanceof LocalCodexError ? { outputIssue: error.outputIssue, rawModelResponse: error.privateOutput } : {}) } : undefined);
      } catch { console.error(JSON.stringify({ event:"paid_job_state_write_failed",jobId:job.id,code:"PAID_JOB_STATE_WRITE_FAILED" })); }
      console.info(JSON.stringify({ event: "paid_job_failure", jobId: job.id, ...failure, executions: job.executions }));
    }
  } finally { clearInterval(heartbeat); }
  return true;
}

declare global { var __dreamPaidWorker: ReturnType<typeof setInterval> | undefined; }
export function startPaidWorker() {
  if (globalThis.__dreamPaidWorker) return;
  const repository = getRepository(), store = paidJobStore(repository);
  if (!store) return;
  let busy = false;
  const tick = async () => {
    try { store.pulseWorker(); } catch { console.error(JSON.stringify({ event: "paid_worker_error", code: "PAID_WORKER_STORAGE_ERROR" })); return; }
    if (busy) return;
    busy = true;
    try { await repository.recoverStaleQuestionReservations(); }
    catch { console.error(JSON.stringify({ event:"paid_question_recovery_error",code:"QUESTION_RESERVATION_RECOVERY_FAILED" })); }
    try { store.recoverUnqueued(); }
    catch { console.error(JSON.stringify({ event: "paid_delivery_recovery_error", code: "PAID_DELIVERY_STORAGE_ERROR" })); }
    try { await runPaidJobOnce(store, repository); }
    catch { console.error(JSON.stringify({ event: "paid_worker_error", code: "PAID_WORKER_STORAGE_ERROR" })); }
    finally { busy = false; }
  };
  globalThis.__dreamPaidWorker = setInterval(() => { void tick(); }, 2000);
  globalThis.__dreamPaidWorker.unref();
  void tick();
}
