import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { SQLiteRepository } from "@/lib/repository/sqlite";
import { PaidJobStore, PAID_JOB_LEASE_MS } from "@/lib/paid-jobs/store";
import { paidOrderCapacityAvailable, resetPaidJobStoresForTests } from "@/lib/paid-jobs/runtime";
import { runPaidJobOnce } from "@/lib/paid-jobs/worker";
import { createReading, getPublicReading, storeStagedFreeReadingV3 } from "@/lib/readings";
import { createOrder, confirmPayment } from "@/lib/payments";
import { createPurchasePromiseSnapshotV2, sourceFreePayloadSha256 } from "@/lib/purchase-promise";
import { buildContentContractOffer, createStagedPaidOfferV2 } from "@/lib/paid-reading-v3";
import { encryptDream, encryptJson } from "@/lib/crypto";
import { DETAILED_DREAM } from "./helpers/repository";
import { acceptedCheckpoint, pipelineReport } from "./helpers/paid-pipeline";
import type { PaidPipelinePersistence } from "@/lib/ai/paid-pipeline";
import type { OrderRecord, PaidCompositionV3Payload, ReadingRecord, StagedFreeReadingV3Payload } from "@/lib/types";

let directory: string, repository: SQLiteRepository, store: PaidJobStore, now: number, reading: ReadingRecord;
beforeEach(async () => {
  vi.stubEnv("APP_PROFILE", "review"); vi.stubEnv("PAYMENTS_MODE", "mock"); vi.stubEnv("PAID_GENERATION_JOBS", "true");
  vi.stubEnv("DREAM_ENCRYPTION_KEY", `hex:${"11".repeat(32)}`);
  directory = mkdtempSync(join(tmpdir(), "paid-jobs-test-")); now = Date.now();
  repository = new SQLiteRepository(join(directory, "test.sqlite3"));
  reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "paid-job-session", repository);
  await repository.saveEntitlement({ readingId: reading.id, fullReadingPurchased: true, baseQuestionAllowance: 2, extraQuestionAllowance: 0, usedQuestions: 0, extraPackPurchased: false, updatedAt: new Date(now).toISOString() });
  store = new PaidJobStore(repository.databasePath, () => now);
});
afterEach(() => { store.close(); resetPaidJobStoresForTests(); repository.close(); rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe("durable paid jobs", () => {
  const resumeByOperator = (id: string) => spawnSync(process.execPath, ["deploy/iwinv/paid-jobs-status.mjs", "--resume", id], {
    env:{...process.env,DREAM_DATABASE_PATH:repository.databasePath},encoding:"utf8"
  });
  function attentionJob() {
    store.enqueue(reading.id); const job=store.claim()!;
    store.checkpoint(job,{...acceptedCheckpoint(),stage:"repair",repairs:3});
    store.fail(job,"PAID_REPAIR_EXHAUSTED",false); return job;
  }
  it("operator resume preserves the draft, requires a fresh review, and cannot duplicate the resume", async () => {
    const job=attentionJob(); expect(resumeByOperator(job.id).status).toBe(0);
    const queued=store.get(reading.id)!;
    expect(queued.status).toBe("queued"); expect(queued.executions).toBe(0);
    expect(store.resume(queued)).toMatchObject({stage:"review",report:pipelineReport,review:null,repairs:0,findings:[]});
    expect(store.db.prepare("SELECT count(*) n FROM dream_paid_job_events WHERE stage='operator_resume'").get()?.n).toBe(1);
    expect((await repository.getEntitlement(reading.id))?.usedQuestions).toBe(0);
    expect(resumeByOperator(job.id).status).not.toBe(0);
    now=Date.now();
    const claimed=store.claim()!; expect(()=>store.complete(claimed,pipelineReport)).toThrow("PAID_JOB_UNAPPROVED_OUTPUT");
    store.checkpoint(claimed,acceptedCheckpoint());store.complete(claimed,pipelineReport);
    expect((await repository.getReading(reading.id))?.detailGenerationStatus).toBe("ready");
  });
  it("blocks new orders while a paid delivery needs attention, but not after its customer retry is queued", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODEX_BRIDGE_URL", ""); vi.stubEnv("CODEX_BRIDGE_TOKEN", "");
    attentionJob(); store.pulseWorker();
    expect(store.workerHealthy()).toBe(true);
    expect(await paidOrderCapacityAvailable(repository)).toBe(false);
    expect(store.retry(reading.id).status).toBe("queued");
    expect(await paidOrderCapacityAvailable(repository)).toBe(true);
  });
  it.each(["expired","revoked","safety","deleted"])("operator resume refuses %s work", async reason => {
    const job=attentionJob();
    if(reason==="deleted") await repository.deleteReading(reading.id);
    else if(reason==="revoked") {const e=(await repository.getEntitlement(reading.id))!;e.fullReadingPurchased=false;await repository.saveEntitlement(e);}
    else {const r=(await repository.getReading(reading.id))!;if(reason==="expired")r.expiresAt=new Date(Date.now()-1000).toISOString();else r.safetyRoute="immediate_self";await repository.saveReading(r);}
    expect(resumeByOperator(job.id).status).not.toBe(0);
    expect(store.db.prepare("SELECT count(*) n FROM dream_paid_job_events WHERE stage='operator_resume'").get()?.n).toBe(0);
  });
  it("a corrected source cannot publish the preserved old draft after operator resume", async () => {
    const job=attentionJob(), r=(await repository.getReading(reading.id))!;
    r.encryptedDream=encryptDream("정정된 새로운 꿈입니다.",r.id);await repository.saveReading(r);
    expect(resumeByOperator(job.id).status).not.toBe(0);
    expect(store.claim()).toBeNull();expect(store.get(reading.id)?.status).toBe("attention");
    expect((await repository.getConversationTurns(reading.id)).filter(t=>t.kind==="detailed")).toHaveLength(0);
  });
  it("deduplicates requests and leases across SQLite connections", () => {
    expect(store.enqueue(reading.id).id).toBe(store.enqueue(reading.id).id);
    const peer = new PaidJobStore(repository.databasePath, () => now);
    try { expect(store.claim()).not.toBeNull(); expect(peer.claim()).toBeNull(); } finally { peer.close(); }
  });
  it("encrypts drafts and resumes them after opening a new worker connection", () => {
    store.enqueue(reading.id); const job = store.claim()!; const state = { ...acceptedCheckpoint(), stage: "review" as const, review: null };
    store.checkpoint(job, state);
    expect(store.get(reading.id)?.checkpoint).not.toContain(pipelineReport.directAnswer);
    const peer = new PaidJobStore(repository.databasePath, () => now);
    try { expect(peer.resume(peer.get(reading.id)!)).toEqual(state); } finally { peer.close(); }
  });
  it("fences a crashed worker after its lease is recovered", () => {
    store.enqueue(reading.id); const stale = store.claim()!; now += PAID_JOB_LEASE_MS + 1;
    const next = store.claim()!; expect(next.lease_token).not.toBe(stale.lease_token);
    expect(() => store.checkpoint(stale, acceptedCheckpoint())).toThrow("PAID_JOB_LEASE_LOST");
    store.checkpoint(next, acceptedCheckpoint()); store.complete(next, pipelineReport);
    expect(store.get(reading.id)?.status).toBe("completed");
  });
  it("uses backoff and bounded retries while preserving questions and purchase", async () => {
    store.enqueue(reading.id);
    for (let n = 1; n <= 3; n++) {
      const job = store.claim()!; expect(job.executions).toBe(n); store.fail(job, "LOCAL_CODEX_TIMEOUT", true);
      if (n < 3) { expect(store.claim()).toBeNull(); now += 21_000; }
    }
    expect(store.get(reading.id)?.status).toBe("attention"); expect(store.claim()).toBeNull();
    expect((await repository.getEntitlement(reading.id))?.usedQuestions).toBe(0);
    const result = await getPublicReading((await repository.getReading(reading.id))!, "https://example.test", repository);
    expect(result.entitlement.remainingQuestions).toBe(2); expect(result.canRetryDetailedReading).toBe(true);
    expect(result.paidRecovery?.reference).toHaveLength(8); expect(result.timeline.some(t => t.kind === "detailed")).toBe(false);
    expect(store.retry(reading.id).status).toBe("queued");
    expect((await repository.getReading(reading.id))?.detailGenerationStatus).toBe("generating");
  });
  it("does not resurrect a deleted reading or its private checkpoints", async () => {
    store.enqueue(reading.id); const job = store.claim()!; store.checkpoint(job, acceptedCheckpoint());
    await repository.deleteReading(reading.id);
    expect(() => store.complete(job, pipelineReport)).toThrow("PAID_JOB_LEASE_LOST");
    expect(store.get(reading.id)).toBeUndefined(); expect(store.db.prepare("SELECT count(*) n FROM dream_paid_job_events").get()?.n).toBe(0);
  });
  it("supersedes a job when the customer corrects the source", async () => {
    store.enqueue(reading.id); const stale = store.claim()!;
    const current = (await repository.getReading(reading.id))!; current.encryptedDream = encryptDream("다른 사실로 정정했어요.", current.id); await repository.saveReading(current);
    const replacement = store.enqueue(reading.id); expect(replacement.id).not.toBe(stale.id);
    expect(() => store.complete(stale, pipelineReport)).toThrow("PAID_JOB_LEASE_LOST");
    store.fail(stale, "LOCAL_CODEX_TIMEOUT", true); expect(store.get(reading.id)?.status).toBe("queued");
  });
  it("does not cancel a pending report for an unrelated reaction", async () => {
    store.enqueue(reading.id); const job = store.claim()!;
    const id = "reaction-turn";
    await repository.saveConversationTurn({ id, readingId: reading.id, role: "user", kind: "followup", status: "complete", clientMessageId: "reaction", encryptedContent: encryptJson({text:"고마워요",intent:"reaction"}, "turn", id), createdAt: new Date(now).toISOString() });
    store.checkpoint(job, acceptedCheckpoint()); store.complete(job, pipelineReport);
    expect(store.get(reading.id)?.status).toBe("completed");
  });
  it("recovers the gap between purchase persistence and queue insertion", async () => {
    reading.status = "paid_generating"; reading.detailGenerationStatus = "generating"; await repository.saveReading(reading);
    store.recoverUnqueued(); expect(store.get(reading.id)?.status).toBe("queued");
    store.recoverUnqueued(); expect(store.db.prepare("SELECT count(*) n FROM dream_paid_jobs").get()?.n).toBe(1);
  });
  it("keeps an already published report ready after a delayed duplicate payment save", async () => {
    store.enqueue(reading.id); const job = store.claim()!; store.checkpoint(job, acceptedCheckpoint()); store.complete(job, pipelineReport);
    reading.status = "paid_generating"; reading.detailGenerationStatus = "generating"; await repository.saveReading(reading);
    store.enqueue(reading.id);
    expect((await repository.getReading(reading.id))?.detailGenerationStatus).toBe("ready");
    expect(store.claim()).toBeNull();
  });
  it("does not expose a completed report after the dream input changes", async () => {
    store.enqueue(reading.id); const job = store.claim()!; store.checkpoint(job, acceptedCheckpoint()); store.complete(job, pipelineReport);
    const corrected = (await repository.getReading(reading.id))!;
    corrected.encryptedDream = encryptDream("정정된 새로운 꿈 장면이에요.", corrected.id);
    corrected.status = "paid_generating"; corrected.detailGenerationStatus = "failed";
    await repository.saveReading(corrected);
    const result = await getPublicReading(corrected, "https://example.test", repository);
    expect(result.detailGenerationStatus).toBe("failed");
    expect(result.timeline.some(turn => turn.kind === "detailed")).toBe(false);
    expect(store.retry(reading.id).status).toBe("queued");
  });
  it("does not publish after the entitlement is revoked", async () => {
    store.enqueue(reading.id); const job = store.claim()!; store.checkpoint(job, acceptedCheckpoint());
    const entitlement = (await repository.getEntitlement(reading.id))!; entitlement.fullReadingPurchased = false; await repository.saveEntitlement(entitlement);
    expect(() => store.complete(job, pipelineReport)).toThrow("PAID_JOB_LEASE_LOST");
  });
  it("applies a delayed purchase callback without overwriting a worker's completed reading", async () => {
    store.enqueue(reading.id); const job = store.claim()!; store.checkpoint(job, acceptedCheckpoint()); store.complete(job, pipelineReport);
    const paid = store.confirmPurchase(reading.id, new Date(now), 86_400_000);
    expect(paid.detailGenerationStatus).toBe("ready"); expect(paid.paidAt).toBe(new Date(now).toISOString());
    expect(store.db.prepare("SELECT expires_at FROM dream_readings WHERE id=?").get(reading.id)?.expires_at).toBe(paid.expiresAt);
    expect(store.db.prepare("SELECT paid_at FROM dream_readings WHERE id=?").get(reading.id)?.paid_at).toBe(paid.paidAt);
    expect(store.get(reading.id)?.status).toBe("completed");
  });
  it("marks abandoned work as attention at the deadline and reports worker liveness independently", () => {
    expect(store.workerHealthy()).toBe(false); store.pulseWorker(); expect(store.workerHealthy()).toBe(true);
    store.enqueue(reading.id);
    // Time in the queue does not consume the generation execution deadline.
    now += 21 * 60_000; store.pulseWorker();
    expect(store.workerHealthy()).toBe(true);
    const claimed = store.claim()!;
    expect(claimed.deadline).toBe(now + 20 * 60_000);
    now = claimed.deadline + 1;
    expect(store.workerHealthy()).toBe(false); expect(store.claim()).toBeNull();
    expect(store.get(reading.id)?.status).toBe("attention");
  });
  it("publishes the approved turn and ready state atomically, only once", async () => {
    store.enqueue(reading.id); const job = store.claim()!;
    expect(() => store.complete(job, pipelineReport)).toThrow("PAID_JOB_UNAPPROVED_OUTPUT");
    expect((await repository.getConversationTurns(reading.id)).filter(t => t.kind === "detailed")).toHaveLength(0);
    store.checkpoint(job, acceptedCheckpoint()); store.complete(job, pipelineReport);
    expect(() => store.complete(job, pipelineReport)).toThrow("PAID_JOB_LEASE_LOST");
    expect((await repository.getConversationTurns(reading.id)).filter(t => t.kind === "detailed")).toHaveLength(1);
    expect((await repository.getReading(reading.id))?.detailGenerationStatus).toBe("ready");
    expect((await repository.getEntitlement(reading.id))?.usedQuestions).toBe(0);
  });
  it("persists reviewer progress through a transient worker error", async () => {
    store.enqueue(reading.id); let calls = 0;
    const generate = async (_r: ReadingRecord, _repository: unknown, persistence: PaidPipelinePersistence) => {
      calls++;
      if (calls === 1) { await persistence.save({ ...acceptedCheckpoint(), stage: "review", review: null }); throw Object.assign(new Error("transient"), { code: "LOCAL_CODEX_TIMEOUT" }); }
      expect(persistence.state?.stage).toBe("review"); await persistence.save(acceptedCheckpoint()); return pipelineReport;
    };
    await runPaidJobOnce(store, repository, generate); now += 5001;
    await runPaidJobOnce(store, repository, generate);
    expect(store.get(reading.id)?.status).toBe("completed"); expect(calls).toBe(2);
  });
  it("queues payment durably before returning even when a scheduler is supplied", async () => {
    const fresh = await createReading({ dream: DETAILED_DREAM, emotion: null }, "payment-job", repository);
    const order = await createOrder(fresh, "full_reading", "payment-job", repository), schedule = vi.fn();
    const input = { orderId: order.id, paymentKey: "mock_paid_job", amount: 990 };
    const paid = await confirmPayment(input, "payment-job", repository, undefined, schedule);
    const again = await confirmPayment(input, "payment-job", repository, undefined, schedule);
    expect(schedule).not.toHaveBeenCalled(); expect(store.get(fresh.id)?.status).toBe("queued");
    expect(paid.detailGenerationStatus).toBe("generating"); expect(again.detailGenerationStatus).toBe("generating");
    expect((await repository.getEntitlement(fresh.id))?.usedQuestions).toBe(0);
    expect((await repository.getOrder(order.id))?.status).toBe("paid");
    expect(store.get(fresh.id)?.order_id).toBe(order.id);
    expect((await repository.getReading(fresh.id))?.fullReadingOrderId).toBe(order.id);
    expect(store.db.prepare("SELECT order_id FROM dream_paid_delivery_outbox WHERE reading_id=?").get(fresh.id)).toMatchObject({ order_id: order.id });
  });

  it("passes the captured order ID to the worker and keeps old orderless jobs on the legacy path", async () => {
    const workerReading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "paid-job-worker-contract", repository);
    const workerOrder: OrderRecord = {
      id: "order_worker_contract_12345678",
      readingId: workerReading.id,
      sessionHash: "paid-job-worker-contract",
      product: "full_reading",
      amount: 990,
      status: "paid",
      paymentKey: "mock_worker_contract_paid",
      providerTransactionKey: "worker_contract_tx",
      contentConsentAt: new Date(now).toISOString(),
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString()
    };
    await repository.saveOrder(workerOrder);
    await repository.saveEntitlement({ readingId: workerReading.id, fullReadingPurchased: true, baseQuestionAllowance: 2, extraQuestionAllowance: 0, usedQuestions: 0, extraPackPurchased: false, updatedAt: new Date(now).toISOString() });
    const explicitOrderId = workerOrder.id;
    store.enqueue(workerReading.id, explicitOrderId);
    expect(store.get(workerReading.id)?.order_id).toBe(explicitOrderId);
    let receivedOrderId: string | undefined;
    let receivedReadingId: string | undefined;
    const generate = async (receivedReading: ReadingRecord, _repository: unknown, recovery: PaidPipelinePersistence, orderId?: string) => {
      receivedReadingId = receivedReading.id;
      receivedOrderId = orderId;
      await recovery.save(acceptedCheckpoint());
      return pipelineReport;
    };
    await runPaidJobOnce(store, repository, generate);
    expect(receivedReadingId).toBe(workerReading.id);
    expect(receivedOrderId).toBe(explicitOrderId);

    const legacyReading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "paid-job-legacy", repository);
    await repository.saveEntitlement({ readingId: legacyReading.id, fullReadingPurchased: true, baseQuestionAllowance: 2, extraQuestionAllowance: 0, usedQuestions: 0, extraPackPurchased: false, updatedAt: new Date(now).toISOString() });
    store.enqueue(legacyReading.id);
    receivedOrderId = "unexpected";
    await runPaidJobOnce(store, repository, generate);
    expect(receivedOrderId).toBeUndefined();
  });

  it("does not enqueue paid-offer-v2 into the V2 durable publication worker", async () => {
    const v2OrderId = "order_internal_paid_v2_12345678";
    const v2Order: OrderRecord = {
      id: v2OrderId,
      readingId: reading.id,
      sessionHash: "paid-job-session",
      product: "full_reading",
      amount: 990,
      status: "paid",
      paymentKey: "internal-v2",
      providerTransactionKey: "internal-v2-tx",
      contentConsentAt: new Date(now).toISOString(),
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString()
    };
    const snapshot = createPurchasePromiseSnapshotV2({
      sourceReadingId: reading.id,
      sourceFreeTurnId: "turn_free_internal_v2",
      sourceFreePayloadSha256: "e".repeat(64),
      offer: createStagedPaidOfferV2(),
      captureMode: "confirmed"
    });
    await repository.saveOrder({ ...v2Order, purchasePromiseSnapshot: snapshot });
    expect(() => store.enqueue(reading.id, v2Order.id)).toThrow("PAID_V3_DURABLE_JOB_UNSUPPORTED");
    expect(store.get(reading.id)).toBeUndefined();
  });

  it("publishes a paid V3 composition from the exact free V3 snapshot through the durable worker", async () => {
    const freePayload: StagedFreeReadingV3Payload = {
      freeCompositionVersion: 3,
      contentContractVersion: 1,
      instructionVersion: "staged-free-v3-1",
      generationInstructionSha256: "a".repeat(64),
      appInstructionsSha256: "b".repeat(64),
      generationSource: "codex",
      title: "다리 위에서 방향을 바꾼 꿈",
      primarySection: { heading: "멈춘 순간의 선택", paragraphs: ["낡은 다리 중간에서 멈추고 뒤에서 오는 사람들을 의식했어요.", "그대로 버티지 않고 옆길을 찾아 내려갔다는 점이 이 흐름의 중심이에요."] },
      secondarySection: { heading: "끝에 남은 안도", paragraphs: ["마지막에 편안함이 남아 처음의 두려움과 다른 방향을 더해요."] },
      coverage: {
        primary: { label: "두려움 속에서도 바라봄", evidenceQuotes: ["처음에는 무서웠지만"] },
        secondary: { label: "방향을 바꾼 뒤 안도함", evidenceQuotes: ["마지막에는 이상하게 마음이 편안해졌어요"] },
        reserved: [{ label: "문을 열어 내보냄", evidenceQuotes: ["문을 열어 밖으로 내보냈고"] }]
      },
      contentContract: {
        delivered: { label: "두려움 속에서도 바라봄", evidenceQuotes: ["처음에는 무서웠지만"] },
        discovered: { label: "방향을 바꾼 뒤 안도함", evidenceQuotes: ["마지막에는 이상하게 마음이 편안해졌어요"] },
        reserved: [{ label: "문을 열어 내보냄", evidenceQuotes: ["문을 열어 밖으로 내보냈고"] }],
        offerEligibility: { eligible: true, perspectives: [
          { label: "끝의 안도", evidenceQuotes: ["마지막에는 이상하게 마음이 편안해졌어요"] },
          { label: "문을 열어 내보냄", evidenceQuotes: ["문을 열어 밖으로 내보냈고"] }
        ] }
      }
    };
    const freeTurn = await storeStagedFreeReadingV3(reading.id, freePayload, repository);
    const offer = buildContentContractOffer(freePayload, DETAILED_DREAM)!;
    const snapshot = createPurchasePromiseSnapshotV2({
      sourceReadingId: reading.id,
      sourceFreeTurnId: freeTurn.id,
      sourceFreePayloadSha256: sourceFreePayloadSha256(freePayload),
      offer,
      captureMode: "confirmed"
    });
    const orderId = "order_paid_v3_contract_123456";
    await repository.saveOrder({
      id: orderId, readingId: reading.id, sessionHash: reading.sessionHash, product: "full_reading", amount: 990,
      status: "paid", paymentKey: "test-v3", providerTransactionKey: "test-v3-transaction",
      purchasePromiseSnapshot: snapshot, contentConsentAt: new Date(now).toISOString(),
      createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString()
    });
    const paidPayload: PaidCompositionV3Payload = {
      paidCompositionVersion: 3,
      instructionVersion: "paid-composition-v3-1",
      generationInstructionSha256: "c".repeat(64),
      appInstructionsSha256: "d".repeat(64),
      generationSource: "codex",
      title: "압박과 안도 사이의 선택",
      bridge: "무료에서는 멈춤 뒤 방향을 바꾼 장면을 읽었어요. 상세 해몽은 그 변화의 앞뒤에 놓인 두 흐름을 이어서 봅니다.",
      newPerspectives: [
        { heading: "안도감으로 달라진 결말", perspectiveLabel: offer!.cards![0]!.title, paragraphs: ["마지막의 편안함은 방향을 바꾼 뒤 감정이 달라졌다는 별도 단서예요."], evidenceQuotes: ["마지막에는 이상하게 마음이 편안해졌어요"] },
        { heading: "문을 열어 내보낸 행동", perspectiveLabel: offer!.cards![1]!.title, paragraphs: ["문을 열어 내보내는 행동은 그 대상을 바라보는 데서 한 걸음 더 나아간 장면이에요."], evidenceQuotes: ["문을 열어 밖으로 내보냈고"] }
      ],
      relationshipSynthesis: ["뒤에서 오는 압박과 옆길을 택한 행동, 끝의 안도감이 차례로 이어져요."],
      finalIntegration: "이 꿈은 밀려오는 상황에서 방향을 바꾸고 안도에 이르는 흐름을 담고 있어요."
    };
    expect(store.enqueue(reading.id, orderId).status).toBe("queued");
    await runPaidJobOnce(store, repository, async () => paidPayload);
    const restored = await getPublicReading((await repository.getReading(reading.id))!, "https://dream.example", repository);
    expect(restored.detailGenerationStatus).toBe("ready");
    const visiblePaid = restored.timeline.find(turn => turn.kind === "detailed")?.content;
    expect(visiblePaid).toMatchObject({ paidCompositionVersion: 3, title: paidPayload.title, finalIntegration: paidPayload.finalIntegration });
    expect(visiblePaid && "generationInstructionSha256" in visiblePaid).toBe(false);
    const visiblePerspectives = visiblePaid && "newPerspectives" in visiblePaid ? visiblePaid.newPerspectives : [];
    expect(visiblePerspectives[0] && "evidenceQuotes" in visiblePerspectives[0]).toBe(false);
  });
});
