/** Opt-in production-model benchmark. Inputs and full results stay in the private archive. */
import { expect, it } from "vitest";
import { loadEnvConfig } from "@next/env";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SQLiteRepository } from "@/lib/repository/sqlite";
import { paidJobStore, resetPaidJobStoresForTests } from "@/lib/paid-jobs/runtime";
import { runPaidJobOnce } from "@/lib/paid-jobs/worker";
import { createReading, getPublicReading } from "@/lib/readings";
import { confirmPayment, createOrder } from "@/lib/payments";
import { decryptJson } from "@/lib/crypto";
import type { ClarificationAnswer, AssistantTurnPayload } from "@/lib/types";

const enabled = process.env.RUN_PAID_RECOVERY_EVAL === "true";
it.skipIf(!enabled)("measures real free-to-paid outcomes with the deployed models", async () => {
  loadEnvConfig(process.cwd());
  const settings = {
    APP_PROFILE: "local-ai", PAYMENTS_MODE: "mock", DREAM_REPOSITORY: "sqlite", PAID_GENERATION_JOBS: "true",
    CODEX_LOCAL_MODEL: "gpt-5.6-luna", CODEX_LOCAL_REASONING_EFFORT: "max",
    CODEX_LOCAL_DETAILED_MODEL: "gpt-5.6-luna", CODEX_LOCAL_DETAILED_REASONING_EFFORT: "max",
    CODEX_LOCAL_FREE_MODEL: "gpt-6-luna", CODEX_LOCAL_FREE_REASONING_EFFORT: "high",
    CODEX_LOCAL_ANALYSIS_MODEL: "gpt-6-luna", CODEX_LOCAL_ANALYSIS_REASONING_EFFORT: "low"
    , CODEX_LOCAL_TIMEOUT_MS: "300000"
  };
  Object.assign(process.env, settings);
  // Keep credentials in the environment; never print them or alter the service's .env.local.
  const runId = randomUUID(), root = resolve(`.data/prompt-lab/paid-recovery-eval/${runId}`);
  await mkdir(root, { recursive: true, mode: 0o700 });
  process.env.DREAM_DATABASE_PATH = join(root, "evaluation.sqlite3");
  const releasePath = process.env.PAID_EVAL_FREE_RELEASE;
  if (!releasePath) throw new Error("PAID_EVAL_FREE_RELEASE_REQUIRED");
  const release = JSON.parse(await readFile(releasePath, "utf8"));
  if (release.experimentId !== 73) throw new Error("EXPECTED_APPROVED_RELEASE_73");
  process.env.FREE_READING_PROMPT_FILE = resolve(releasePath);
  process.env.FREE_READING_PROMPT_SHA256 = createHash("sha256").update(release.instructions).digest("hex");
  const cases: Array<{ name: string; dream: string; answers: ClarificationAnswer[] }> = [];
  if (process.env.PAID_EVAL_FAILURE_FIXTURE) {
    const archive = JSON.parse(await readFile(process.env.PAID_EVAL_FAILURE_FIXTURE, "utf8"));
    const start = archive.traces.flatMap((t: {records: Array<{stage: string; payload: unknown}>}) => t.records).find((r: {stage: string}) => r.stage === "started");
    if (!start?.payload?.originalDream) throw new Error("PRIVATE_FAILURE_INPUT_MISSING");
    cases.push({ name: "prior_failure", dream: start.payload.originalDream, answers: start.payload.userEvidence.clarificationAnswers });
  } else throw new Error("PRIVATE_FAILURE_FIXTURE_REQUIRED");
  cases.push(
    { name: "assessment", dream: "시험장에 갔는데 책상 위 시험지에는 제가 처음 보는 문제가 적혀 있었어요. 옆 사람은 빠르게 쓰고 있었고 저는 한 문제를 천천히 읽다가 잠에서 깼어요. 꿈속에서는 초조했어요. 현실에서는 다음 주에 새 직장 면접이 있어요.", answers: [] },
    { name: "lost_object", dream: "지하철에서 내린 뒤 가방을 두고 온 걸 알았어요. 역 직원에게 도움을 청했고 가방을 찾았다는 연락을 기다리는 중에 깼어요. 찾았는지는 꿈에 나오지 않았어요. 꿈에서는 당황했지만 직원에게 말한 뒤에는 조금 진정됐어요.", answers: [] }
  );
  await writeFile(join(root, "manifest.json"), JSON.stringify({ runId, settings, cases, releaseHash: process.env.FREE_READING_PROMPT_SHA256 }), { flag: "wx", mode: 0o600 });
  const repository = new SQLiteRepository(process.env.DREAM_DATABASE_PATH), store = paidJobStore(repository)!;
  const summaries: Array<Record<string, unknown>> = []; let consecutiveFailures = 0;
  const repetitions = Number(process.env.PAID_EVAL_REPETITIONS ?? 2);
  const selected = process.env.PAID_EVAL_CASE ? cases.filter(c => c.name === process.env.PAID_EVAL_CASE) : cases;
  try {
    for (const item of selected) for (let iteration = 1; iteration <= repetitions; iteration++) {
      const started = Date.now(), session = `eval-${runId}-${item.name}-${iteration}`;
      let readingId: string | undefined;
      const summary: Record<string, unknown> = { case: item.name, iteration, success: false };
      try {
        const reading = await createReading({ dream: item.dream, emotion: null }, session, repository, undefined, item.answers);
        readingId = reading.id;
        const free = await getPublicReading(reading, "http://127.0.0.1:3097", repository);
        if (!free.canPurchaseFullReading) throw new Error("EVAL_FACT_CONFIRMATION_REQUIRED");
        const order = await createOrder(reading, "full_reading", session, repository);
        await confirmPayment({ orderId: order.id, paymentKey: `mock_${runId}_${item.name}_${iteration}`, amount: 990 }, session, repository);
        while (Date.now() - started < 20 * 60_000) {
          await runPaidJobOnce(store, repository);
          const job = store.get(reading.id)!;
          if (process.env.PAID_EVAL_STOP_ON_PROVIDER_FORMAT === "true" && job.error_code === "LOCAL_CODEX_INVALID_OUTPUT") break;
          if (["completed", "attention", "cancelled"].includes(job.status)) break;
          await new Promise(resolve => setTimeout(resolve, Math.max(100, Math.min(1000, job.not_before - Date.now()))));
        }
        const job = store.get(reading.id)!;
        const result = await getPublicReading((await repository.getReading(reading.id))!, "http://127.0.0.1:3097", repository);
        const checkpoint = store.resume(job);
        Object.assign(summary, { success: result.detailGenerationStatus === "ready", executions: job.executions, repairs: checkpoint?.repairs ?? null, errorCode: job.error_code, remainingQuestions: result.entitlement.remainingQuestions, jobId: job.id });
        const turns = await repository.getConversationTurns(reading.id);
        const final = turns.find(t => t.kind === "detailed");
        const body = final ? decryptJson<AssistantTurnPayload>(final.encryptedContent, "turn", final.id) : null;
        await writeFile(join(root, `${item.name}-${iteration}-result.json`), JSON.stringify({ input: item, result, body, checkpoint }), { flag: "wx", mode: 0o600 });
        if (result.entitlement.remainingQuestions !== 2) throw new Error("EVAL_QUESTION_BALANCE_CHANGED");
      } catch (error) {
        const safe = error instanceof Error ? error.message : "EVAL_FAILED";
        summary.errorCode = /^[A-Z_]{4,80}$/.test(safe) ? safe : "EVAL_REQUEST_FAILED";
      }
      Object.assign(summary, { durationMs: Date.now() - started, readingId });
      summaries.push(summary);
      await writeFile(join(root, `${item.name}-${iteration}-summary.json`), JSON.stringify(summary), { flag: "wx", mode: 0o600 });
      console.info(JSON.stringify({ event: "paid_recovery_eval", ...summary, archive: root }));
      consecutiveFailures = summary.success ? 0 : consecutiveFailures + 1;
      if (consecutiveFailures >= 2) throw new Error("EVAL_TWO_CONSECUTIVE_FAILURES_ANALYZE_BEFORE_CONTINUING");
    }
    const successful = summaries.filter(s => s.success), initial = successful.filter(s => s.executions === 1 && s.repairs === 0);
    const metrics = { sampleCount: summaries.length, successes: successful.length, initialSuccesses: initial.length, recoveredSuccesses: successful.length - initial.length, failures: summaries.length - successful.length, durationsMs: summaries.map(s => s.durationMs) };
    await writeFile(join(root, "metrics.json"), JSON.stringify(metrics), { flag: "wx", mode: 0o600 });
    console.info(JSON.stringify({ event: "paid_recovery_eval_metrics", ...metrics, archive: root }));
    expect(successful.length).toBe(summaries.length);
  } finally { resetPaidJobStoresForTests(); repository.close(); }
}, 120 * 60_000);
