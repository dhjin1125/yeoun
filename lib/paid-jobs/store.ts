import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { decryptJson, encryptJson } from "../crypto";
import type { AssistantTurnPayload, EncryptedPayload, OrderRecord, PaidCompositionV3Payload, ReadingRecord, UserTurnPayload } from "../types";
import type { PaidPipelineState } from "../ai/paid-pipeline";

export const PAID_JOB_LEASE_MS = 90_000;
const DEADLINE_MS = 20 * 60_000;
const MAX_EXECUTIONS = 3;
export type PaidJob = {
  id: string; reading_id: string; order_id: string | null; input_hash: string;
  status: "queued" | "running" | "retry" | "completed" | "attention" | "cancelled";
  executions: number; lease_token: string | null; lease_until: number; not_before: number;
  deadline: number; created_at: number; updated_at: number; error_code: string | null; checkpoint: string | null;
};

export class PaidJobLeaseLost extends Error { constructor() { super("PAID_JOB_LEASE_LOST"); } }

/** The currently deployed origin is SQLite. All claims, publications and cancellations are fenced transactions. */
export class PaidJobStore {
  readonly db: DatabaseSync;
  constructor(path: string, private readonly now = () => Date.now()) {
    this.db = new DatabaseSync(path, { enableForeignKeyConstraints: true, timeout: 5000 });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS dream_paid_jobs (
        id TEXT PRIMARY KEY, reading_id TEXT NOT NULL UNIQUE REFERENCES dream_readings(id) ON DELETE CASCADE,
        order_id TEXT,
        input_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','running','retry','completed','attention','cancelled')),
        executions INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
        not_before INTEGER NOT NULL, deadline INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        error_code TEXT, checkpoint TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS dream_paid_jobs_due ON dream_paid_jobs(status,not_before);
      CREATE TABLE IF NOT EXISTS dream_paid_job_events (
        id INTEGER PRIMARY KEY, job_id TEXT NOT NULL, reading_id TEXT NOT NULL REFERENCES dream_readings(id) ON DELETE CASCADE,
        stage TEXT NOT NULL, encrypted_details TEXT NOT NULL CHECK(json_valid(encrypted_details)), created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS dream_paid_worker_health (id INTEGER PRIMARY KEY CHECK(id=1),last_seen INTEGER NOT NULL) STRICT;`);
    if (!this.hasColumn("dream_paid_jobs", "order_id")) this.db.exec("ALTER TABLE dream_paid_jobs ADD COLUMN order_id TEXT;");
  }
  private hasColumn(table: string, column: string) {
    return (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>).some(row => row.name === column);
  }
  close() { this.db.close(); }
  pulseWorker() { this.db.prepare("INSERT INTO dream_paid_worker_health(id,last_seen) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen").run(this.now()); }
  workerHealthy() {
    const row = this.db.prepare("SELECT last_seen FROM dream_paid_worker_health WHERE id=1").get() as {last_seen: number} | undefined;
    return Boolean(row && this.now() - row.last_seen < 30_000);
  }
  deliverySummary() {
    const attention = this.db.prepare(`SELECT
      (SELECT count(*) FROM dream_paid_jobs WHERE status='attention') +
      (SELECT count(*) FROM dream_paid_delivery_outbox WHERE status='attention') AS count`).get() as {count:number};
    const backlog = this.db.prepare(`SELECT
      (SELECT count(*) FROM dream_paid_jobs WHERE status IN ('queued','retry','running')) AS count,
      (SELECT min(created_at) FROM dream_paid_jobs WHERE status IN ('queued','retry')) AS oldest,
      (SELECT count(*) FROM dream_paid_jobs WHERE status='running' AND lease_until<=?) AS staleRunning`)
      .get(this.now()) as {count:number;oldest:number|null;staleRunning:number};
    return { attentionCount: attention.count, backlogCount: backlog.count, oldestWaitingAt: backlog.oldest, staleRunningCount:backlog.staleRunning };
  }
  deliveryStatus(readingId: string) {
    const job = this.get(readingId);
    if (job) {
      let currentInput = false;
      try {
        const reading = this.reading(readingId);
        currentInput = Boolean(reading && this.inputHash(reading) === job.input_hash);
      } catch { /* A corrupt input cannot make an old result look current. */ }
      return { ...job, current_input: currentInput };
    }
    const outbox = this.db.prepare("SELECT * FROM dream_paid_delivery_outbox WHERE reading_id=?").get(readingId) as {status:string;error_code:string|null;updated_at:string}|undefined;
    if (!outbox) return null;
    return { id:`delivery_${readingId}`, reading_id:readingId, status:outbox.status, error_code:outbox.error_code, current_input:false };
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private reading(id: string): ReadingRecord | null {
    const row = this.db.prepare("SELECT record FROM dream_readings WHERE id=?").get(id) as {record: string} | undefined;
    return row ? JSON.parse(row.record) : null;
  }
  private entitled(id: string) {
    const row = this.db.prepare("SELECT full_reading_purchased AS paid FROM dream_entitlements WHERE reading_id=?").get(id) as {paid: number} | undefined;
    return row?.paid === 1;
  }
  private inputHash(reading: ReadingRecord) {
    const candidates = this.db.prepare("SELECT id,kind,encrypted_content FROM dream_messages WHERE reading_id=? AND (kind='free' OR (role='user' AND kind='followup')) ORDER BY created_at,id").all(reading.id) as {id: string; kind: string; encrypted_content: string}[];
    const turns = candidates.filter(turn => turn.kind === "free" || ["correction", "dream_fact", "reality_context", "repair"].includes(decryptJson<UserTurnPayload>(JSON.parse(turn.encrypted_content), "turn", turn.id).intent ?? ""));
    return createHash("sha256").update(JSON.stringify([reading.encryptedDream, reading.encryptedContext, reading.encryptedClarificationAnswers, reading.selectedEmotion, reading.safetyRoute, turns])).digest("hex");
  }
  private writeReading(reading: ReadingRecord) {
    this.db.prepare("UPDATE dream_readings SET status=?,record=?,updated_at=?,expires_at=?,paid_at=? WHERE id=?").run(reading.status, JSON.stringify(reading), reading.updatedAt, reading.expiresAt, reading.paidAt, reading.id);
  }
  private event(job: PaidJob, stage: string, details: unknown) {
    this.db.prepare("INSERT INTO dream_paid_job_events(job_id,reading_id,stage,encrypted_details,created_at) VALUES(?,?,?,?,?)")
      .run(job.id, job.reading_id, stage, JSON.stringify(encryptJson(details, "context", job.id)), this.now());
  }
  get(readingId: string) { return this.db.prepare("SELECT * FROM dream_paid_jobs WHERE reading_id=?").get(readingId) as PaidJob | undefined; }
  confirmPurchase(readingId: string, paidAt: Date, lifetimeMs: number) {
    return this.transaction(() => {
      const reading = this.reading(readingId);
      if (!reading || Date.parse(reading.expiresAt) <= this.now() || !this.entitled(readingId)) throw new Error("PAID_JOB_NOT_ENTITLED");
      reading.paidAt ??= paidAt.toISOString();
      reading.expiresAt = new Date(Math.max(Date.parse(reading.expiresAt), paidAt.getTime() + lifetimeMs)).toISOString();
      if (reading.detailGenerationStatus === "locked") {
        reading.status = "paid_generating"; reading.detailGenerationStatus = "generating";
      }
      reading.updatedAt = new Date(this.now()).toISOString();
      this.writeReading(reading);
      return reading;
    });
  }
  private reconcilePaidOrders() {
    const rows = this.db.prepare("SELECT record FROM dream_orders WHERE status='paid' ORDER BY updated_at LIMIT 50")
      .all() as Array<{record:string}>;
    for (const row of rows) {
      try {
        const order = JSON.parse(row.record) as OrderRecord;
        this.transaction(() => {
          const reading = this.reading(order.readingId);
          if (!reading || Date.parse(reading.expiresAt) <= this.now()) return;
          const currentOrder = this.db.prepare("SELECT status,record FROM dream_orders WHERE id=?").get(order.id) as {status:string;record:string}|undefined;
          if (currentOrder?.status !== "paid") return;
          const entitlementRow = this.db.prepare("SELECT * FROM dream_entitlements WHERE reading_id=?").get(order.readingId) as {
            full_reading_purchased:number;base_question_allowance:number;extra_question_allowance:number;used_questions:number;extra_pack_purchased:number;updated_at:string;
          }|undefined;
          let full = Boolean(entitlementRow?.full_reading_purchased), base = entitlementRow?.base_question_allowance ?? 0;
          let extra = entitlementRow?.extra_question_allowance ?? 0, used = entitlementRow?.used_questions ?? 0;
          let extraPack = Boolean(entitlementRow?.extra_pack_purchased);
          if (order.product === "full_reading") { full = true; base = 2; }
          else { extraPack = true; extra = 2; }
          const paidAt = order.updatedAt;
          const updatedAt = new Date(this.now()).toISOString();
          this.db.prepare(`INSERT INTO dream_entitlements(reading_id,full_reading_purchased,base_question_allowance,extra_question_allowance,used_questions,extra_pack_purchased,updated_at)
            VALUES(?,?,?,?,?,?,?) ON CONFLICT(reading_id) DO UPDATE SET full_reading_purchased=excluded.full_reading_purchased,
            base_question_allowance=excluded.base_question_allowance,extra_question_allowance=excluded.extra_question_allowance,
            used_questions=excluded.used_questions,extra_pack_purchased=excluded.extra_pack_purchased,updated_at=excluded.updated_at`)
            .run(order.readingId,Number(full),base,extra,used,Number(extraPack),updatedAt);
          reading.paidAt ??= paidAt;
          reading.expiresAt = new Date(Math.max(Date.parse(reading.expiresAt),Date.parse(paidAt)+7*24*60*60*1000)).toISOString();
          if (order.product === "full_reading") reading.fullReadingOrderId ??= order.id;
          if (order.product === "full_reading" && reading.detailGenerationStatus !== "ready") {
            reading.status = "paid_generating";
            this.writeReading(reading);
            const job = this.get(order.readingId);
            if (!job || ["cancelled","completed"].includes(job.status)) {
              this.db.prepare(`INSERT INTO dream_paid_delivery_outbox(reading_id,order_id,status,error_code,created_at,updated_at)
                VALUES(?,?,'pending',NULL,?,?) ON CONFLICT(reading_id) DO UPDATE SET
                  status=CASE WHEN dream_paid_delivery_outbox.status='attention' THEN 'attention' ELSE 'pending' END,
                  order_id=COALESCE(dream_paid_delivery_outbox.order_id,excluded.order_id),
                  updated_at=excluded.updated_at`)
                .run(order.readingId,reading.fullReadingOrderId ?? null,updatedAt,updatedAt);
            }
          } else {
            this.writeReading(reading);
          }
        });
      } catch (error) {
        const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}/.test(error.message) ? error.message.split(":",1)[0]! : "PAID_ORDER_RECONCILE_FAILED";
        console.error(JSON.stringify({event:"paid_order_reconcile_error",orderId:row.record.slice(0,24),code}));
      }
    }
  }
  recoverUnqueued() {
    this.reconcilePaidOrders();
    const expired = new Date(this.now()).toISOString();
    const legacy = this.db.prepare(`SELECT r.id FROM dream_readings r JOIN dream_entitlements e ON e.reading_id=r.id
      LEFT JOIN dream_paid_jobs j ON j.reading_id=r.id LEFT JOIN dream_paid_delivery_outbox x ON x.reading_id=r.id
      WHERE e.full_reading_purchased=1 AND r.expires_at>? AND json_extract(r.record,'$.detailGenerationStatus')!='ready'
      AND (j.id IS NULL OR (j.status IN ('cancelled','completed') AND json_extract(r.record,'$.detailGenerationStatus')!='ready'))
      AND x.reading_id IS NULL LIMIT 20`).all(expired) as {id:string}[];
    for (const row of legacy) this.transaction(() => this.db.prepare(`INSERT OR IGNORE INTO dream_paid_delivery_outbox(reading_id,status,error_code,created_at,updated_at)
      VALUES(?,'pending',NULL,?,?)`).run(row.id,new Date(this.now()).toISOString(),new Date(this.now()).toISOString()));

    const rows = this.db.prepare("SELECT reading_id,order_id FROM dream_paid_delivery_outbox WHERE status='pending' ORDER BY created_at LIMIT 20")
      .all() as {reading_id:string;order_id:string|null}[];
    let queued = 0;
    for (const row of rows) {
      try {
        const previous = this.get(row.reading_id);
        if (previous?.status === "attention") {
          this.markDeliveryAttention(row.reading_id, previous.error_code ?? "PAID_JOB_ATTENTION");
          continue;
        }
        this.enqueue(row.reading_id, row.order_id ?? undefined);
        this.markDeliveryQueued(row.reading_id);
        queued++;
      } catch (error) {
        const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}/.test(error.message) ? error.message.split(":",1)[0]! : "PAID_DELIVERY_RECONCILE_FAILED";
        this.markDeliveryAttention(row.reading_id, code);
        console.error(JSON.stringify({ event:"paid_delivery_attention", readingId:row.reading_id.slice(0,12), code }));
      }
    }
    return queued;
  }

  private markDeliveryQueued(readingId: string) {
    this.db.prepare("UPDATE dream_paid_delivery_outbox SET status='queued',error_code=NULL,updated_at=? WHERE reading_id=?")
      .run(new Date(this.now()).toISOString(),readingId);
  }
  private markDeliveryAttention(readingId: string, code: string) {
    this.transaction(() => {
      this.db.prepare("UPDATE dream_paid_delivery_outbox SET status='attention',error_code=?,updated_at=? WHERE reading_id=?")
        .run(code,new Date(this.now()).toISOString(),readingId);
      try {
        const reading = this.reading(readingId);
        if (reading && this.entitled(readingId) && reading.detailGenerationStatus !== "ready") {
          reading.status="paid_generating"; reading.detailGenerationStatus="failed";
          reading.detailGenerationError="자동 복구를 마치지 못해 확인할 수 있도록 기록했어요. 결제와 남은 질문은 그대로예요.";
          reading.updatedAt=new Date(this.now()).toISOString(); this.writeReading(reading);
        }
      } catch { /* Keep the durable outbox alert even when the reading record is unreadable. */ }
    });
  }
  enqueue(readingId: string, orderId?: string) {
    return this.transaction(() => {
      const reading = this.reading(readingId);
      if (!reading || Date.parse(reading.expiresAt) <= this.now() || !this.entitled(readingId)) throw new Error("PAID_JOB_NOT_ENTITLED");
      if (reading.safetyRoute === "immediate_self") throw new Error("PAID_JOB_SAFETY_BLOCKED");
      if (orderId) {
        const orderRow = this.db.prepare("SELECT record FROM dream_orders WHERE id=?").get(orderId) as {record:string}|undefined;
        if (!orderRow) throw new Error("PAID_ORDER_NOT_FOUND");
        const order = JSON.parse(orderRow.record) as OrderRecord;
        if (order.id !== orderId || order.readingId !== readingId) throw new Error("PAID_ORDER_READING_MISMATCH");
        if (order.status !== "paid" || order.product !== "full_reading") throw new Error("PAID_ORDER_NOT_CONFIRMED");
        if (order.purchasePromiseSnapshot?.promiseVersion === "paid-offer-v2" &&
          (order.purchasePromiseSnapshot.offer.contentContractVersion !== 1 || order.purchasePromiseSnapshot.offer.eligibility !== "eligible")) {
          throw new Error("PAID_V3_DURABLE_JOB_UNSUPPORTED");
        }
      }
      const input = this.inputHash(reading);
      const previous = this.get(readingId);
      const exactOrderId = orderId ?? null;
      if (previous?.input_hash === input && previous.order_id === exactOrderId && ["queued","running","retry"].includes(previous.status)) {
        this.markDeliveryQueued(readingId);
        return previous;
      }
      if (previous?.input_hash === input && previous.order_id === exactOrderId && previous.status === "completed") {
        const canonical = this.db.prepare("SELECT 1 FROM dream_messages WHERE id=? AND kind='detailed' AND status='complete'")
          .get(`turn_detailed_${readingId}`);
        if (canonical) {
          // A delayed duplicate payment response must not strand or hide an
          // already published result, even if its stale caller says generating.
          reading.status = "paid_ready"; reading.detailGenerationStatus = "ready"; reading.detailGenerationError = null;
          reading.updatedAt = new Date(this.now()).toISOString(); this.writeReading(reading);
          this.db.prepare("UPDATE dream_paid_delivery_outbox SET status='completed',error_code=NULL,updated_at=? WHERE reading_id=?")
            .run(new Date(this.now()).toISOString(), readingId);
          return previous;
        }
      }
      const now = this.now();
      const job: PaidJob = { id: randomUUID(), reading_id: readingId, order_id: exactOrderId, input_hash: input, status: "queued", executions: 0, lease_token: null, lease_until: 0, not_before: now, deadline: 0, created_at: now, updated_at: now, error_code: null, checkpoint: null };
      this.db.prepare(`INSERT INTO dream_paid_jobs(id,reading_id,order_id,input_hash,status,executions,lease_token,lease_until,not_before,deadline,created_at,updated_at,error_code,checkpoint)
        VALUES(?,?,?,?, 'queued',0,NULL,0,?,?,?,?,NULL,NULL) ON CONFLICT(reading_id) DO UPDATE SET
        id=excluded.id,order_id=excluded.order_id,input_hash=excluded.input_hash,status='queued',executions=0,lease_token=NULL,lease_until=0,
        not_before=excluded.not_before,deadline=excluded.deadline,created_at=excluded.created_at,updated_at=excluded.updated_at,error_code=NULL,checkpoint=NULL`)
        .run(job.id, readingId, exactOrderId, input, now, job.deadline, now, now);
      reading.status = "paid_generating"; reading.detailGenerationStatus = "generating"; reading.detailGenerationError = null; reading.updatedAt = new Date(now).toISOString();
      this.writeReading(reading);
      this.markDeliveryQueued(readingId);
      this.event(job, "queued", { supersedes: previous?.id ?? null });
      return job;
    });
  }
  private attention(job: PaidJob, code: string) {
    this.db.prepare("UPDATE dream_paid_jobs SET status='attention',error_code=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=?").run(code, this.now(), job.id);
    this.db.prepare("UPDATE dream_paid_delivery_outbox SET status='attention',error_code=?,updated_at=? WHERE reading_id=?").run(code,new Date(this.now()).toISOString(),job.reading_id);
    try {
      const reading = this.reading(job.reading_id);
      if (reading && this.entitled(job.reading_id) && reading.detailGenerationStatus !== "ready") {
        reading.status = "paid_generating"; reading.detailGenerationStatus = "failed";
        reading.detailGenerationError = "자동 복구를 마치지 못해 확인할 수 있도록 기록했어요. 결제와 남은 질문은 그대로예요.";
        reading.updatedAt = new Date(this.now()).toISOString(); this.writeReading(reading);
      }
    } catch { /* Keep durable attention state if the reading record cannot be decoded. */ }
    try { this.event(job, "attention", { code, executions: job.executions }); } catch { /* job state is the durable alert */ }
  }
  claim(): PaidJob | null {
    return this.transaction(() => {
      const now = this.now();
      const candidates = this.db.prepare(`SELECT j.* FROM dream_paid_jobs j JOIN dream_readings r ON r.id=j.reading_id
        WHERE ((j.status IN ('queued','retry') AND j.not_before<=?) OR (j.status='running' AND j.lease_until<=?))
        AND r.expires_at>? ORDER BY j.created_at LIMIT 20`).all(now, now, new Date(now).toISOString()) as PaidJob[];
      for (const job of candidates) {
        let reading: ReadingRecord | null;
        try {
          reading = this.reading(job.reading_id);
          if (!reading || !this.entitled(job.reading_id) || this.inputHash(reading) !== job.input_hash) {
            this.db.prepare("UPDATE dream_paid_jobs SET status='cancelled',lease_token=NULL,updated_at=? WHERE id=?").run(now,job.id);
            if (reading && this.entitled(job.reading_id) && reading.detailGenerationStatus !== "ready") {
              this.db.prepare(`INSERT INTO dream_paid_delivery_outbox(reading_id,status,error_code,created_at,updated_at)
                VALUES(?,'pending',NULL,?,?) ON CONFLICT(reading_id) DO UPDATE SET status=CASE WHEN status='attention' THEN status ELSE 'pending' END,
                  error_code=CASE WHEN status='attention' THEN error_code ELSE NULL END,updated_at=excluded.updated_at`)
                .run(job.reading_id,new Date(now).toISOString(),new Date(now).toISOString());
            }
            continue;
          }
        } catch {
          this.attention(job,"PAID_JOB_INPUT_UNREADABLE");
          continue;
        }
        if (job.executions >= MAX_EXECUTIONS || (job.deadline > 0 && now >= job.deadline)) { this.attention(job, "PAID_RECOVERY_EXHAUSTED"); continue; }
        const deadline = job.deadline || now + DEADLINE_MS;
        const token = randomUUID();
        this.db.prepare("UPDATE dream_paid_jobs SET status='running',executions=executions+1,lease_token=?,lease_until=?,deadline=?,updated_at=? WHERE id=?").run(token, now + PAID_JOB_LEASE_MS, deadline, now, job.id);
        return this.get(job.reading_id)!;
      }
      return null;
    });
  }
  heartbeat(job: PaidJob) {
    const now = this.now();
    const result = this.db.prepare("UPDATE dream_paid_jobs SET lease_until=?,updated_at=? WHERE id=? AND lease_token=? AND status='running' AND lease_until>? AND deadline>?")
      .run(now + PAID_JOB_LEASE_MS, now, job.id, job.lease_token, now, now);
    return result.changes === 1;
  }
  private assertLease(job: PaidJob) {
    const current = this.get(job.reading_id);
    let reading: ReadingRecord | null = null;
    try { reading = this.reading(job.reading_id); } catch { throw new PaidJobLeaseLost(); }
    let hash = "";
    try { if (reading) hash = this.inputHash(reading); } catch { throw new PaidJobLeaseLost(); }
    if (!current || current.id !== job.id || current.status !== "running" || current.lease_token !== job.lease_token || current.lease_until <= this.now() || current.deadline <= this.now() || !reading || Date.parse(reading.expiresAt) <= this.now() || !this.entitled(job.reading_id) || hash !== job.input_hash) throw new PaidJobLeaseLost();
    return reading;
  }
  checkpoint(job: PaidJob, state: PaidPipelineState) {
    this.transaction(() => {
      this.assertLease(job);
      this.db.prepare("UPDATE dream_paid_jobs SET checkpoint=?,updated_at=? WHERE id=? AND lease_token=?")
        .run(JSON.stringify(encryptJson(state, "context", job.id)), this.now(), job.id, job.lease_token);
      this.event(job, state.stage, state);
    });
  }
  resume(job: PaidJob): PaidPipelineState | null {
    return job.checkpoint ? decryptJson<PaidPipelineState>(JSON.parse(job.checkpoint) as EncryptedPayload, "context", job.id) : null;
  }
  retry(readingId: string, orderId?: string) {
    const initialReading = this.reading(readingId);
    if (!initialReading || Date.parse(initialReading.expiresAt) <= this.now() || !this.entitled(readingId)) throw new Error("PAID_JOB_NOT_ENTITLED");
    if (initialReading.safetyRoute === "immediate_self") throw new Error("PAID_JOB_SAFETY_BLOCKED");
    const initialJob = this.get(readingId);
    const initialInput = this.inputHash(initialReading);
    const exactOrderId = orderId ?? null;
    if (initialJob?.status === "completed" && initialJob.input_hash === initialInput && initialJob.order_id === exactOrderId) {
      const canonical = this.db.prepare("SELECT 1 FROM dream_messages WHERE id=? AND kind='detailed' AND status='complete'")
        .get(`turn_detailed_${readingId}`);
      if (canonical) {
        const restored = this.transaction(() => {
          const current = this.reading(readingId);
          const currentJob = this.get(readingId);
          if (!current || !currentJob || currentJob.status !== "completed" || currentJob.input_hash !== this.inputHash(current)) return null;
          if (current.detailGenerationStatus !== "ready") {
            current.status = "paid_ready"; current.detailGenerationStatus = "ready"; current.detailGenerationError = null;
            current.updatedAt = new Date(this.now()).toISOString(); this.writeReading(current);
          }
          return currentJob;
        });
        if (restored) return restored;
      }
    }
    if (initialJob && initialJob.input_hash === initialInput && initialJob.order_id === exactOrderId && ["queued", "running", "retry"].includes(initialJob.status)) return initialJob;
    if (initialJob && initialJob.input_hash === initialInput && initialJob.order_id === exactOrderId && initialJob.status === "attention") {
      const queued = this.transaction(() => {
        const reading = this.reading(readingId), previous = this.get(readingId);
        if (!reading || !previous || previous.status !== "attention" || previous.input_hash !== this.inputHash(reading)) return null;
        let checkpoint: PaidPipelineState | null = null;
        try { checkpoint = this.resume(previous); } catch { /* Restart from the durable paid request if a checkpoint is corrupt. */ }
        if (checkpoint) {
          checkpoint.repairs = 0;
          checkpoint.reviewCorrections = 0;
          checkpoint.reviewProblems = [];
        }
        const now = this.now();
        const encryptedCheckpoint = checkpoint ? JSON.stringify(encryptJson(checkpoint, "context", previous.id)) : null;
        this.db.prepare(`UPDATE dream_paid_jobs SET status='queued',executions=0,lease_token=NULL,lease_until=0,
          not_before=?,deadline=0,error_code=NULL,checkpoint=?,updated_at=? WHERE id=?`)
          .run(now, encryptedCheckpoint, now, previous.id);
        reading.status = "paid_generating"; reading.detailGenerationStatus = "generating"; reading.detailGenerationError = null;
        reading.updatedAt = new Date(now).toISOString(); this.writeReading(reading);
        this.db.prepare("UPDATE dream_paid_delivery_outbox SET status='queued',error_code=NULL,updated_at=? WHERE reading_id=?")
          .run(new Date(now).toISOString(), readingId);
        this.event({ ...previous, status: "queued", executions: 0, checkpoint: encryptedCheckpoint }, "customer_retry", { resumed: Boolean(checkpoint) });
        return this.get(readingId)!;
      });
      if (queued) return queued;
    }
    return this.enqueue(readingId, exactOrderId ?? undefined);
  }
  record(job: PaidJob, payload: Record<string, unknown>) {
    this.transaction(() => { this.assertLease(job); this.event(job, "request_context", payload); });
  }
  complete(job: PaidJob, payload: AssistantTurnPayload) {
    this.transaction(() => {
      const reading = this.assertLease(job);
      const current = this.get(job.reading_id)!;
      const accepted = this.resume(current);
      if (accepted?.stage !== "accepted" || !accepted.review?.approved || accepted.review.findings.length || !accepted.review.headlineAnswered || !accepted.review.correctionApplied || !accepted.review.addsValueBeyondFree || !["traditional", "psychology", "pattern", "action"].every(key => accepted.review!.offerCoverage.some(card => card.key === key && card.fulfilled)) || accepted.localError || JSON.stringify(accepted.report) !== JSON.stringify(payload)) throw new Error("PAID_JOB_UNAPPROVED_OUTPUT");
      const now = new Date(this.now()).toISOString(), turnId = `turn_detailed_${reading.id}`;
      this.db.prepare(`INSERT INTO dream_messages(id,reading_id,role,kind,status,client_message_id,encrypted_content,created_at)
        VALUES(?,?,'kkumgyeol','detailed','complete',NULL,?,?) ON CONFLICT(id) DO UPDATE SET encrypted_content=excluded.encrypted_content,status='complete'`)
        .run(turnId, reading.id, JSON.stringify(encryptJson(payload, "turn", turnId)), now);
      reading.status = "paid_ready"; reading.detailGenerationStatus = "ready"; reading.detailGenerationError = null; reading.updatedAt = now;
      this.writeReading(reading);
      this.db.prepare("UPDATE dream_paid_jobs SET status='completed',lease_token=NULL,lease_until=0,error_code=NULL,updated_at=? WHERE id=?").run(this.now(), job.id);
      this.db.prepare("UPDATE dream_paid_delivery_outbox SET status='completed',error_code=NULL,updated_at=? WHERE reading_id=?")
        .run(now,reading.id);
      this.event(job, "completed", { executions: current.executions, repairs: accepted.repairs, durationMs: this.now() - current.created_at });
    });
  }
  completeCompositionV3(job: PaidJob, payload: PaidCompositionV3Payload) {
    this.transaction(() => {
      const reading = this.assertLease(job);
      const current = this.get(job.reading_id)!;
      if (payload.paidCompositionVersion !== 3 || payload.instructionVersion !== "paid-composition-v3-1" ||
        !payload.generationInstructionSha256 || !payload.appInstructionsSha256 || !["openai", "codex"].includes(payload.generationSource)) {
        throw new Error("PAID_V3_UNAPPROVED_OUTPUT");
      }
      const now = new Date(this.now()).toISOString(), turnId = `turn_detailed_${reading.id}`;
      this.db.prepare(`INSERT INTO dream_messages(id,reading_id,role,kind,status,client_message_id,encrypted_content,created_at)
        VALUES(?,?,'kkumgyeol','detailed','complete',NULL,?,?) ON CONFLICT(id) DO UPDATE SET encrypted_content=excluded.encrypted_content,status='complete'`)
        .run(turnId, reading.id, JSON.stringify(encryptJson(payload, "turn", turnId)), now);
      reading.status = "paid_ready"; reading.detailGenerationStatus = "ready"; reading.detailGenerationError = null; reading.updatedAt = now;
      this.writeReading(reading);
      this.db.prepare("UPDATE dream_paid_jobs SET status='completed',lease_token=NULL,lease_until=0,error_code=NULL,updated_at=? WHERE id=?").run(this.now(), job.id);
      this.db.prepare("UPDATE dream_paid_delivery_outbox SET status='completed',error_code=NULL,updated_at=? WHERE reading_id=?").run(now, reading.id);
      this.event(job, "completed", { executions: current.executions, compositionVersion: 3, durationMs: this.now() - current.created_at });
    });
  }
  fail(job: PaidJob, code: string, retryable: boolean, diagnostic?: Record<string, unknown>) {
    return this.transaction(() => {
      // Fence stale workers without turning a newly corrected/deleted reading into a failure.
      const current = this.get(job.reading_id);
      if (!current || current.id !== job.id || current.lease_token !== job.lease_token || current.status !== "running" || current.lease_until <= this.now()) return;
      let reading: ReadingRecord | null = null;
      try { reading = this.reading(job.reading_id); } catch { /* quarantine below */ }
      let sameInput = false;
      try { sameInput = Boolean(reading && this.inputHash(reading) === job.input_hash); } catch { /* quarantine below */ }
      if (!reading || !sameInput) {
        if (reading && this.entitled(job.reading_id)) this.attention(current,"PAID_JOB_INPUT_UNREADABLE");
        else this.db.prepare("UPDATE dream_paid_jobs SET status='cancelled',lease_token=NULL,updated_at=? WHERE id=?").run(this.now(), job.id);
        return;
      }
      this.event(current, "failure", { code, retryable, diagnostic: diagnostic ?? null });
      if (retryable && current.executions < MAX_EXECUTIONS && this.now() + 10_000 < current.deadline) {
        const delay = current.executions === 1 ? 5000 : 20_000;
        this.db.prepare("UPDATE dream_paid_jobs SET status='retry',not_before=?,error_code=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=?").run(this.now()+delay, code, this.now(), job.id);
        this.event(current, "retry", { code, executions: current.executions });
      } else this.attention(current, code);
    });
  }
}
