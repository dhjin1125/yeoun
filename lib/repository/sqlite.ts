import "server-only";

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateLegacyReading } from "../legacy-reading";
import { safetyNoticeForRoute } from "../safety";
import { AppError } from "../http";
import { ANALYTICS_EVENTS } from "../types";
import { transitionConversationGuard, type ConversationGuardCommand, type ConversationGuardState } from "../conversation-guard";
import type {
  ConversationTurn,
  OrderProduct,
  OrderRecord,
  QuestionReservation,
  ReadingEntitlement,
  ReadingRecord
} from "../types";
import { sanitizedAnalyticsContext, type DreamRepository, type StoredAnalyticsEvent } from "./index";

type ReadingRow = { record: string; expires_at: string };
type RecordRow = { record: string };

function sqliteErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  if (error instanceof Error) {
    const match = error.message.match(/^([A-Z][A-Z0-9_]{2,80})(?::|$)/);
    if (match) return match[1];
  }
  return "SQLITE_UNKNOWN";
}

function storeFailure(prefix: string, error: unknown): never {
  throw new Error(`${prefix}:${sqliteErrorCode(error)}`, { cause: error });
}

function parseRecord<T>(serialized: string, prefix: string): T {
  try {
    return JSON.parse(serialized) as T;
  } catch (error) {
    storeFailure(prefix, error);
  }
}

const EVENT_NAMES = ANALYTICS_EVENTS.map((name) => `'${name}'`).join(", ");

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS dream_conversation_guards (
    key TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK (json_valid(state)),
    expires_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS dream_conversation_guards_expiry_idx ON dream_conversation_guards(expires_at);

  CREATE TABLE IF NOT EXISTS dream_readings (
    id TEXT PRIMARY KEY,
    session_hash TEXT NOT NULL,
    owner_user_id TEXT,
    status TEXT NOT NULL CHECK (status IN (
      'intake', 'clarifying', 'free_ready', 'payment_pending', 'paid_generating', 'paid_ready'
    )),
    record TEXT NOT NULL CHECK (json_valid(record)),
    expires_at TEXT NOT NULL,
    paid_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS dream_readings_session_hash_idx ON dream_readings(session_hash);
  CREATE INDEX IF NOT EXISTS dream_readings_owner_user_id_idx ON dream_readings(owner_user_id);
  CREATE INDEX IF NOT EXISTS dream_readings_expires_at_idx ON dream_readings(expires_at);

  CREATE TABLE IF NOT EXISTS dream_orders (
    id TEXT PRIMARY KEY,
    reading_id TEXT NOT NULL REFERENCES dream_readings(id) ON DELETE CASCADE,
    session_hash TEXT NOT NULL,
    product TEXT NOT NULL DEFAULT 'full_reading' CHECK (product IN ('full_reading', 'followup_pack_2')),
    amount INTEGER NOT NULL CHECK (amount = 990),
    status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
    payment_key TEXT,
    record TEXT NOT NULL CHECK (json_valid(record)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS dream_orders_reading_idx ON dream_orders(reading_id, status);
  CREATE UNIQUE INDEX IF NOT EXISTS dream_orders_payment_key_unique
    ON dream_orders(payment_key) WHERE payment_key IS NOT NULL;

  CREATE TABLE IF NOT EXISTS dream_messages (
    id TEXT PRIMARY KEY,
    reading_id TEXT NOT NULL REFERENCES dream_readings(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'kkumgyeol')),
    kind TEXT NOT NULL CHECK (kind IN ('dream', 'clarification', 'free', 'detailed', 'followup', 'safety')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'complete', 'failed')),
    client_message_id TEXT,
    encrypted_content TEXT NOT NULL CHECK (json_valid(encrypted_content)),
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS dream_messages_reading_idx ON dream_messages(reading_id, created_at);
  CREATE UNIQUE INDEX IF NOT EXISTS dream_messages_client_message_unique
    ON dream_messages(reading_id, client_message_id) WHERE client_message_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS dream_entitlements (
    reading_id TEXT PRIMARY KEY REFERENCES dream_readings(id) ON DELETE CASCADE,
    full_reading_purchased INTEGER NOT NULL DEFAULT 0 CHECK (full_reading_purchased IN (0, 1)),
    base_question_allowance INTEGER NOT NULL DEFAULT 0 CHECK (base_question_allowance IN (0, 2)),
    extra_question_allowance INTEGER NOT NULL DEFAULT 0 CHECK (extra_question_allowance IN (0, 2)),
    used_questions INTEGER NOT NULL DEFAULT 0 CHECK (used_questions BETWEEN 0 AND 4),
    extra_pack_purchased INTEGER NOT NULL DEFAULT 0 CHECK (extra_pack_purchased IN (0, 1)),
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS dream_message_reservations (
    reading_id TEXT NOT NULL REFERENCES dream_readings(id) ON DELETE CASCADE,
    client_message_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('reserved', 'complete', 'released')),
    reserved_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    request_hash TEXT,
    PRIMARY KEY (reading_id, client_message_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS dream_paid_delivery_outbox (
    reading_id TEXT PRIMARY KEY REFERENCES dream_readings(id) ON DELETE CASCADE,
    order_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending','queued','attention','completed')),
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS dream_analytics_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name TEXT NOT NULL CHECK (event_name IN (${EVENT_NAMES})),
    reading_id TEXT REFERENCES dream_readings(id) ON DELETE SET NULL,
    context TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(context)),
    occurred_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS dream_analytics_events_occurred_at_idx
    ON dream_analytics_events(occurred_at);
`;

export class SQLiteRepository implements DreamRepository {
  readonly databasePath: string;
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(databasePath: string) {
    this.databasePath = resolve(databasePath);
    mkdirSync(dirname(this.databasePath), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(this.databasePath, {
      enableForeignKeyConstraints: true,
      timeout: 5_000
    });
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec("PRAGMA synchronous = NORMAL;");
    this.database.exec("PRAGMA busy_timeout = 5000;");
    this.database.exec(SCHEMA);
    this.migrateLegacySchema();
    this.migrateLegacyRecords();
    this.purgeExpiredData();
  }

  private assertOpen() {
    if (this.closed) throw new Error("SQLITE_REPOSITORY_CLOSED");
  }

  private hasColumn(table: string, column: string) {
    const rows = this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some((row) => row.name === column);
  }

  private migrateLegacySchema() {
    if (!this.hasColumn("dream_message_reservations", "charged")) this.database.exec("ALTER TABLE dream_message_reservations ADD COLUMN charged INTEGER NOT NULL DEFAULT 1 CHECK (charged IN (0,1));");
    if (!this.hasColumn("dream_message_reservations", "request_hash")) this.database.exec("ALTER TABLE dream_message_reservations ADD COLUMN request_hash TEXT;");
    if (!this.hasColumn("dream_paid_delivery_outbox", "order_id")) this.database.exec("ALTER TABLE dream_paid_delivery_outbox ADD COLUMN order_id TEXT;");
    if (!this.hasColumn("dream_orders", "product")) {
      this.database.exec("ALTER TABLE dream_orders ADD COLUMN product TEXT NOT NULL DEFAULT 'full_reading';");
    }

    const row = this.database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'dream_analytics_events'")
      .get() as { sql: string } | undefined;
    if (row && ANALYTICS_EVENTS.every((event) => row.sql.includes(`'${event}'`))) return;

    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database.exec(`
        ALTER TABLE dream_analytics_events RENAME TO dream_analytics_events_legacy;
        CREATE TABLE dream_analytics_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_name TEXT NOT NULL CHECK (event_name IN (${EVENT_NAMES})),
          reading_id TEXT REFERENCES dream_readings(id) ON DELETE SET NULL,
          context TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(context)),
          occurred_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO dream_analytics_events (id, event_name, reading_id, context, occurred_at)
          SELECT id, event_name, reading_id, context, occurred_at FROM dream_analytics_events_legacy;
        DROP TABLE dream_analytics_events_legacy;
        CREATE INDEX dream_analytics_events_occurred_at_idx ON dream_analytics_events(occurred_at);
      `);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      storeFailure("SQLITE_SCHEMA_MIGRATION_FAILED", error);
    }
  }

  private migrateLegacyRecords() {
    const rows = this.database
      .prepare(`SELECT id, record FROM dream_readings WHERE json_type(record, '$.encryptedContext') IS NULL`)
      .all() as Array<{ id: string; record: string }>;
    if (rows.length === 0) return;

    this.database.exec("BEGIN IMMEDIATE;");
    try {
      for (const row of rows) {
        const legacy = parseRecord<unknown>(row.record, "READING_LEGACY_MIGRATION_FAILED");
        const migrated = migrateLegacyReading(legacy);
        if (!migrated) continue;
        const reading = migrated.reading;
        this.database
          .prepare(`
            UPDATE dream_readings SET
              session_hash = ?, owner_user_id = ?, status = ?, record = ?, expires_at = ?,
              paid_at = ?, updated_at = ?
            WHERE id = ?
          `)
          .run(
            reading.sessionHash,
            reading.ownerUserId,
            reading.status,
            JSON.stringify(reading),
            reading.expiresAt,
            reading.paidAt,
            reading.updatedAt,
            reading.id
          );
        const entitlement = migrated.entitlement;
        this.database
          .prepare(`
            INSERT INTO dream_entitlements (
              reading_id, full_reading_purchased, base_question_allowance,
              extra_question_allowance, used_questions, extra_pack_purchased, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(reading_id) DO UPDATE SET
              full_reading_purchased = excluded.full_reading_purchased,
              base_question_allowance = excluded.base_question_allowance,
              extra_question_allowance = excluded.extra_question_allowance,
              used_questions = excluded.used_questions,
              extra_pack_purchased = excluded.extra_pack_purchased,
              updated_at = excluded.updated_at
          `)
          .run(
            entitlement.readingId,
            Number(entitlement.fullReadingPurchased),
            entitlement.baseQuestionAllowance,
            entitlement.extraQuestionAllowance,
            entitlement.usedQuestions,
            Number(entitlement.extraPackPurchased),
            entitlement.updatedAt
          );
        const saveTurn = this.database.prepare(`
          INSERT INTO dream_messages (
            id, reading_id, role, kind, status, client_message_id, encrypted_content, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `);
        for (const turn of migrated.turns) {
          saveTurn.run(
            turn.id,
            turn.readingId,
            turn.role,
            turn.kind,
            turn.status,
            turn.clientMessageId,
            JSON.stringify(turn.encryptedContent),
            turn.createdAt
          );
        }
      }
      this.database.exec("COMMIT;");
      this.database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      this.database.exec("VACUUM;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      storeFailure("READING_LEGACY_MIGRATION_FAILED", error);
    }
  }

  private purgeExpiredData(now = new Date().toISOString()) {
    this.database.prepare("DELETE FROM dream_readings WHERE expires_at <= ?").run(now);
    this.database
      .prepare("DELETE FROM dream_analytics_events WHERE occurred_at < ?")
      .run(new Date(Date.now() - 13 * 31 * 24 * 60 * 60 * 1_000).toISOString());
  }

  async checkHealth() {
    this.assertOpen();
    this.database.prepare("SELECT 1").get();
  }

  async mutateConversationGuard(key: string, command: ConversationGuardCommand, expiresAt: number) {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const now = Date.now();
      this.database.prepare("DELETE FROM dream_conversation_guards WHERE key IN (SELECT key FROM dream_conversation_guards WHERE expires_at <= ? LIMIT 100)").run(now);
      const row = this.database.prepare("SELECT state, expires_at FROM dream_conversation_guards WHERE key = ?").get(key) as { state: string; expires_at: number } | undefined;
      const previous = row && row.expires_at > now ? parseRecord<ConversationGuardState>(row.state, "CONVERSATION_GUARD_READ_FAILED") : null;
      const updated = transitionConversationGuard(previous, command, now);
      this.database.prepare("INSERT INTO dream_conversation_guards (key,state,expires_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET state=excluded.state,expires_at=excluded.expires_at")
        .run(key, JSON.stringify(updated.state), expiresAt);
      this.database.exec("COMMIT");
      return updated.result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      storeFailure("CONVERSATION_GUARD_WRITE_FAILED", error);
    }
  }

  async getReading(id: string) {
    this.assertOpen();
    try {
      const row = this.database
        .prepare("SELECT record, expires_at FROM dream_readings WHERE id = ?")
        .get(id) as ReadingRow | undefined;
      if (!row) return null;
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        await this.deleteReading(id);
        return null;
      }
      const reading = parseRecord<ReadingRecord>(row.record, "READING_STORE_READ_FAILED");
      if (reading.id !== id || reading.expiresAt !== row.expires_at) throw new Error("SQLITE_READING_RECORD_MISMATCH");
      return reading;
    } catch (error) {
      storeFailure("READING_STORE_READ_FAILED", error);
    }
  }

  async saveReading(reading: ReadingRecord) {
    this.assertOpen();
    try {
      this.database
        .prepare(`
          INSERT INTO dream_readings (
            id, session_hash, owner_user_id, status, record, expires_at,
            paid_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            session_hash = excluded.session_hash,
            owner_user_id = excluded.owner_user_id,
            status = excluded.status,
            record = excluded.record,
            expires_at = excluded.expires_at,
            paid_at = excluded.paid_at,
            updated_at = excluded.updated_at
        `)
        .run(
          reading.id,
          reading.sessionHash,
          reading.ownerUserId,
          reading.status,
          JSON.stringify(reading),
          reading.expiresAt,
          reading.paidAt,
          reading.createdAt,
          reading.updatedAt
        );
    } catch (error) {
      storeFailure("READING_STORE_WRITE_FAILED", error);
    }
  }

  async deleteReading(id: string) {
    this.assertOpen();
    try {
      this.database.prepare("DELETE FROM dream_readings WHERE id = ?").run(id);
      this.database.prepare("DELETE FROM dream_conversation_guards WHERE key = ?").run(`reading:${id}`);
    } catch (error) {
      storeFailure("READING_STORE_DELETE_FAILED", error);
    }
  }

  async getConversationTurns(readingId: string) {
    this.assertOpen();
    try {
      const rows = this.database
        .prepare(`
          SELECT id, reading_id, role, kind, status, client_message_id, encrypted_content, created_at
          FROM dream_messages WHERE reading_id = ? ORDER BY created_at ASC, id ASC
        `)
        .all(readingId) as Array<{
          id: string;
          reading_id: string;
          role: ConversationTurn["role"];
          kind: ConversationTurn["kind"];
          status: ConversationTurn["status"];
          client_message_id: string | null;
          encrypted_content: string;
          created_at: string;
        }>;
      return rows.map((row) => ({
        id: row.id,
        readingId: row.reading_id,
        role: row.role,
        kind: row.kind,
        status: row.status,
        clientMessageId: row.client_message_id,
        encryptedContent: parseRecord<ConversationTurn["encryptedContent"]>(
          row.encrypted_content,
          "MESSAGE_STORE_READ_FAILED"
        ),
        createdAt: row.created_at
      }));
    } catch (error) {
      storeFailure("MESSAGE_STORE_READ_FAILED", error);
    }
  }

  async saveConversationTurn(turn: ConversationTurn) {
    this.assertOpen();
    try {
      this.writeTurn(turn);
    } catch (error) {
      storeFailure("MESSAGE_STORE_WRITE_FAILED", error);
    }
  }

  private writeTurn(turn: ConversationTurn) {
    this.database.prepare(`
          INSERT INTO dream_messages (
            id, reading_id, role, kind, status, client_message_id, encrypted_content, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            role = excluded.role,
            kind = excluded.kind,
            status = excluded.status,
            client_message_id = excluded.client_message_id,
            encrypted_content = excluded.encrypted_content
        `)
        .run(
          turn.id,
          turn.readingId,
          turn.role,
          turn.kind,
          turn.status,
          turn.clientMessageId,
          JSON.stringify(turn.encryptedContent),
          turn.createdAt
        );
  }

  async getEntitlement(readingId: string) {
    this.assertOpen();
    const row = this.database
      .prepare("SELECT * FROM dream_entitlements WHERE reading_id = ?")
      .get(readingId) as
      | {
          reading_id: string;
          full_reading_purchased: number;
          base_question_allowance: 0 | 2;
          extra_question_allowance: 0 | 2;
          used_questions: number;
          extra_pack_purchased: number;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      readingId: row.reading_id,
      fullReadingPurchased: Boolean(row.full_reading_purchased),
      baseQuestionAllowance: row.base_question_allowance,
      extraQuestionAllowance: row.extra_question_allowance,
      usedQuestions: row.used_questions,
      extraPackPurchased: Boolean(row.extra_pack_purchased),
      updatedAt: row.updated_at
    } satisfies ReadingEntitlement;
  }

  async saveEntitlement(entitlement: ReadingEntitlement) {
    this.assertOpen();
    try {
      this.database
        .prepare(`
          INSERT INTO dream_entitlements (
            reading_id, full_reading_purchased, base_question_allowance,
            extra_question_allowance, used_questions, extra_pack_purchased, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(reading_id) DO UPDATE SET
            full_reading_purchased = excluded.full_reading_purchased,
            base_question_allowance = excluded.base_question_allowance,
            extra_question_allowance = excluded.extra_question_allowance,
            used_questions = excluded.used_questions,
            extra_pack_purchased = excluded.extra_pack_purchased,
            updated_at = excluded.updated_at
        `)
        .run(
          entitlement.readingId,
          Number(entitlement.fullReadingPurchased),
          entitlement.baseQuestionAllowance,
          entitlement.extraQuestionAllowance,
          entitlement.usedQuestions,
          Number(entitlement.extraPackPurchased),
          entitlement.updatedAt
        );
    } catch (error) {
      storeFailure("ENTITLEMENT_STORE_WRITE_FAILED", error);
    }
  }

  async reserveQuestion(readingId: string, clientMessageId: string, charge = true, turn?: ConversationTurn, requestHash?: string): Promise<QuestionReservation> {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      // A request may use one planner plus two generation/review attempts,
      // each with a maximum five-minute provider timeout. Reclaim only after
      // that entire budget, including requests abandoned in another tab.
      const cutoff=new Date(Date.now()-30*60*1000).toISOString();
      const stale=this.database.prepare("SELECT coalesce(sum(charged),0) AS charged FROM dream_message_reservations WHERE reading_id = ? AND status = 'reserved' AND reserved_at < ?").get(readingId,cutoff) as {charged:number};
      if (stale.charged) this.database.prepare("UPDATE dream_entitlements SET used_questions=max(0,used_questions-?),updated_at=? WHERE reading_id=?").run(stale.charged,new Date().toISOString(),readingId);
      this.database.prepare("UPDATE dream_messages SET status='failed' WHERE reading_id=? AND status='pending' AND client_message_id IN (SELECT client_message_id FROM dream_message_reservations WHERE reading_id=? AND status='reserved' AND reserved_at < ?)").run(readingId,readingId,cutoff);
      this.database.prepare("UPDATE dream_message_reservations SET status='released',updated_at=? WHERE reading_id=? AND status='reserved' AND reserved_at < ?").run(new Date().toISOString(),readingId,cutoff);
      const existing = this.database.prepare(`
          SELECT status, reserved_at, charged, request_hash FROM dream_message_reservations
          WHERE reading_id = ? AND client_message_id = ?
        `)
        .get(readingId, clientMessageId) as { status: string; reserved_at: string; charged: number; request_hash: string | null } | undefined;
      if (existing?.request_hash && requestHash && existing.request_hash !== requestHash) throw new Error("MESSAGE_CLIENT_ID_CONFLICT");
      const entitlementRow = this.database.prepare("SELECT * FROM dream_entitlements WHERE reading_id = ?").get(readingId) as {
        full_reading_purchased: number; base_question_allowance: 0 | 2; extra_question_allowance: 0 | 2; used_questions: number;
      } | undefined;
      const entitlement = entitlementRow ? {
        fullReadingPurchased: Boolean(entitlementRow.full_reading_purchased),
        baseQuestionAllowance: entitlementRow.base_question_allowance,
        extraQuestionAllowance: entitlementRow.extra_question_allowance,
        usedQuestions: entitlementRow.used_questions
      } : null;
      const remaining = entitlement
        ? Math.max(0, entitlement.baseQuestionAllowance + entitlement.extraQuestionAllowance - entitlement.usedQuestions)
        : 0;

      if (existing?.status === "complete") {
        this.database.exec("COMMIT;");
        return { status: "duplicate_complete", remainingQuestions: remaining };
      }
      if (existing?.status === "reserved") {
        this.database.exec("COMMIT;");
        return { status: "duplicate_pending", remainingQuestions: remaining };
      }

      if (!entitlement?.fullReadingPurchased) {
        this.database.exec("COMMIT;");
        return { status: "not_entitled", remainingQuestions: 0 };
      }
      const available =
        entitlement.baseQuestionAllowance + entitlement.extraQuestionAllowance - entitlement.usedQuestions;
      const conflicting = this.database.prepare("SELECT 1 FROM dream_message_reservations WHERE reading_id = ? AND status = 'reserved' LIMIT 1").get(readingId);
      if (conflicting) { this.database.exec("COMMIT;"); return {status:"duplicate_pending", remainingQuestions:Math.max(0,available)}; }
      if (charge && available <= 0) {
        this.database.exec("COMMIT;");
        return { status: "credits_exhausted", remainingQuestions: 0 };
      }

      const now = new Date().toISOString();
      entitlement.usedQuestions += charge ? 1 : 0;
      this.database.prepare("UPDATE dream_entitlements SET used_questions=?,updated_at=? WHERE reading_id=?")
        .run(entitlement.usedQuestions, now, readingId);
      this.database
        .prepare(`
          INSERT INTO dream_message_reservations (
            reading_id, client_message_id, status, reserved_at, updated_at, charged, request_hash
          ) VALUES (?, ?, 'reserved', ?, ?, ?, ?)
          ON CONFLICT(reading_id, client_message_id) DO UPDATE SET
            status = 'reserved', reserved_at = excluded.reserved_at, updated_at = excluded.updated_at,
            charged = excluded.charged, request_hash = coalesce(excluded.request_hash, dream_message_reservations.request_hash)
        `)
        .run(readingId, clientMessageId, now, now, Number(charge), requestHash ?? null);
      if (turn) this.writeTurn(turn);
      this.database.exec("COMMIT;");
      return {
        status: "reserved",
        remainingQuestions: Math.max(
          0,
          entitlement.baseQuestionAllowance + entitlement.extraQuestionAllowance - entitlement.usedQuestions
        )
      };
    } catch (error) {
      this.database.exec("ROLLBACK;");
      storeFailure("QUESTION_RESERVATION_FAILED", error);
    }
  }

  async completeQuestionReservation(readingId: string, clientMessageId: string) {
    this.assertOpen();
    const result = this.database
      .prepare(`
        UPDATE dream_message_reservations SET status = 'complete', updated_at = ?
        WHERE reading_id = ? AND client_message_id = ? AND status = 'reserved'
      `)
      .run(new Date().toISOString(), readingId, clientMessageId);
    if (result.changes !== 1) throw new Error("QUESTION_RESERVATION_NOT_FOUND");
  }

  async heartbeatQuestionReservation(readingId: string, clientMessageId: string) {
    this.assertOpen();
    const now = new Date().toISOString();
    const result = this.database.prepare(`UPDATE dream_message_reservations SET reserved_at=?,updated_at=?
      WHERE reading_id=? AND client_message_id=? AND status='reserved'`).run(now, now, readingId, clientMessageId);
    return result.changes === 1;
  }

  async completeQuestionWithTurns(readingId: string, clientMessageId: string, userTurn: ConversationTurn, assistantTurn: ConversationTurn, encryptedContext?: ReadingRecord["encryptedContext"]) {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const reservation = this.database.prepare("SELECT status FROM dream_message_reservations WHERE reading_id=? AND client_message_id=?")
        .get(readingId, clientMessageId) as {status:string} | undefined;
      if (reservation?.status === "complete") {
        const existing = this.database.prepare("SELECT 1 FROM dream_messages WHERE id=? AND status='complete'").get(assistantTurn.id);
        if (existing) { this.database.exec("COMMIT;"); return; }
      }
      if (!reservation || reservation.status !== "reserved") throw new Error("QUESTION_RESERVATION_NOT_FOUND");
      this.writeTurn(userTurn);
      this.writeTurn(assistantTurn);
      if (encryptedContext) {
        const row = this.database.prepare("SELECT record FROM dream_readings WHERE id=?").get(readingId) as RecordRow | undefined;
        if (!row) throw new Error("READING_NOT_FOUND");
        const reading = parseRecord<ReadingRecord>(row.record,"READING_STORE_READ_FAILED");
        reading.encryptedContext = encryptedContext;
        reading.updatedAt = new Date().toISOString();
        this.database.prepare("UPDATE dream_readings SET record=?,updated_at=? WHERE id=?").run(JSON.stringify(reading),reading.updatedAt,readingId);
      }
      const result = this.database.prepare("UPDATE dream_message_reservations SET status='complete',updated_at=? WHERE reading_id=? AND client_message_id=? AND status='reserved'")
        .run(new Date().toISOString(),readingId,clientMessageId);
      if (result.changes !== 1) throw new Error("QUESTION_RESERVATION_NOT_FOUND");
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      storeFailure("QUESTION_RESPONSE_COMMIT_FAILED",error);
    }
  }

  async releaseQuestionReservation(readingId: string, clientMessageId: string, userTurn?: ConversationTurn) {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.database
        .prepare(`SELECT status, charged FROM dream_message_reservations WHERE reading_id = ? AND client_message_id = ?`)
        .get(readingId, clientMessageId) as { status: string; charged: number } | undefined;
      if (row?.status === "reserved") {
        this.database
          .prepare(`
            UPDATE dream_entitlements
            SET used_questions = max(0, used_questions - ?), updated_at = ?
            WHERE reading_id = ?
          `)
          .run(row.charged, new Date().toISOString(), readingId);
        this.database
          .prepare(`
            UPDATE dream_message_reservations SET status = 'released', updated_at = ?
            WHERE reading_id = ? AND client_message_id = ?
          `)
          .run(new Date().toISOString(), readingId, clientMessageId);
      }
      // A commit may have succeeded even if the caller lost the response.
      // Never let that retry path overwrite a published request as failed.
      if (userTurn && row?.status !== "complete") this.writeTurn(userTurn);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      storeFailure("QUESTION_RESERVATION_RELEASE_FAILED", error);
    }
  }

  async recoverStaleQuestionReservations() {
    this.assertOpen();
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const rows = this.database.prepare(`SELECT reading_id, coalesce(sum(charged),0) AS charged FROM dream_message_reservations
        WHERE status='reserved' AND reserved_at < ? GROUP BY reading_id`).all(cutoff) as Array<{reading_id:string;charged:number}>;
      for (const row of rows) {
        if (row.charged) this.database.prepare("UPDATE dream_entitlements SET used_questions=max(0,used_questions-?),updated_at=? WHERE reading_id=?").run(row.charged,new Date().toISOString(),row.reading_id);
      }
      this.database.prepare(`UPDATE dream_messages SET status='failed' WHERE status='pending' AND EXISTS (
        SELECT 1 FROM dream_message_reservations r WHERE r.reading_id=dream_messages.reading_id
          AND r.client_message_id=dream_messages.client_message_id AND r.status='reserved' AND r.reserved_at < ?
      )`).run(cutoff);
      const result = this.database.prepare("UPDATE dream_message_reservations SET status='released',updated_at=? WHERE status='reserved' AND reserved_at < ?")
        .run(new Date().toISOString(),cutoff);
      this.database.exec("COMMIT;");
      return Number(result.changes);
    } catch (error) {
      this.database.exec("ROLLBACK;");
      storeFailure("QUESTION_RESERVATION_RECOVERY_FAILED",error);
    }
  }

  async getOrder(id: string) {
    this.assertOpen();
    try {
      const row = this.database.prepare("SELECT record FROM dream_orders WHERE id = ?").get(id) as RecordRow | undefined;
      if (!row) return null;
      const order = parseRecord<OrderRecord>(row.record, "ORDER_STORE_READ_FAILED");
      return order.product ? order : ({ ...order, product: "full_reading" } as OrderRecord);
    } catch (error) {
      storeFailure("ORDER_STORE_READ_FAILED", error);
    }
  }

  private writeOrderRecord(order: OrderRecord) {
    this.database.prepare(`INSERT INTO dream_orders (
      id,reading_id,session_hash,product,amount,status,payment_key,record,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      reading_id=excluded.reading_id,session_hash=excluded.session_hash,product=excluded.product,
      amount=excluded.amount,status=excluded.status,payment_key=excluded.payment_key,
      record=excluded.record,updated_at=excluded.updated_at`)
      .run(order.id,order.readingId,order.sessionHash,order.product,order.amount,order.status,order.paymentKey,JSON.stringify(order),order.createdAt,order.updatedAt);
  }

  private writeReadingRecord(reading: ReadingRecord) {
    this.database.prepare(`UPDATE dream_readings SET status=?,record=?,updated_at=?,expires_at=?,paid_at=? WHERE id=?`)
      .run(reading.status,JSON.stringify(reading),reading.updatedAt,reading.expiresAt,reading.paidAt,reading.id);
  }

  async createPendingOrder(order: OrderRecord, reading: ReadingRecord) {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const existing = this.database.prepare(`SELECT record FROM dream_orders WHERE reading_id=? AND session_hash=? AND product=?
        AND status='pending' ORDER BY created_at DESC,id DESC LIMIT 1`).get(reading.id,order.sessionHash,order.product) as RecordRow | undefined;
      if (existing) {
        const existingOrder = parseRecord<OrderRecord>(existing.record,"ORDER_STORE_READ_FAILED");
        if (!existingOrder.purchasePromiseSnapshot && order.purchasePromiseSnapshot) {
          existingOrder.purchasePromiseSnapshot = structuredClone(order.purchasePromiseSnapshot);
          this.writeOrderRecord(existingOrder);
        }
        this.database.exec("COMMIT;");
        return existingOrder;
      }
      const stored = this.database.prepare("SELECT record FROM dream_readings WHERE id=?").get(reading.id) as RecordRow | undefined;
      if (!stored) throw new Error("READING_NOT_FOUND");
      const current = parseRecord<ReadingRecord>(stored.record,"READING_STORE_READ_FAILED");
      if (safetyNoticeForRoute(current.safetyRoute)?.blocksInterpretation) throw new AppError("PURCHASE_DISABLED","지금은 결제보다 안전 안내를 우선해요.",409);
      const entitlement = this.database.prepare("SELECT * FROM dream_entitlements WHERE reading_id=?").get(reading.id) as {
        full_reading_purchased:number;base_question_allowance:number;extra_question_allowance:number;used_questions:number;extra_pack_purchased:number;
      }|undefined;
      if (order.product === "full_reading") {
        if (entitlement?.full_reading_purchased) throw new AppError("ALREADY_PURCHASED","이미 전체 해몽이 열려 있어요.",409);
        if (!(current.status === "free_ready" || current.status === "payment_pending")) throw new AppError("FREE_READING_REQUIRED","무료 해몽을 먼저 확인해 주세요.",409);
      } else {
        if (!entitlement?.full_reading_purchased || current.detailGenerationStatus !== "ready") throw new AppError("PAID_READING_REQUIRED","전체 해몽을 먼저 열어주세요.",403);
        if (entitlement.extra_pack_purchased) throw new AppError("FOLLOWUP_PACK_ALREADY_PURCHASED","추가 질문 묶음은 한 번만 구매할 수 있어요.",409);
        if (entitlement.used_questions < entitlement.base_question_allowance + entitlement.extra_question_allowance) throw new AppError("FOLLOWUP_CREDITS_REMAIN","남은 질문을 먼저 사용해 주세요.",409);
      }
      if (order.product === "full_reading") {
        current.status = "payment_pending";
        current.updatedAt = order.updatedAt;
        this.writeReadingRecord(current);
      }
      this.writeOrderRecord(order);
      this.database.exec("COMMIT;");
      return order;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      if (error instanceof AppError) throw error;
      storeFailure("PENDING_ORDER_COMMIT_FAILED",error);
    }
  }

  async setPurchasePromiseSnapshotIfMissing(orderId: string, snapshot: NonNullable<OrderRecord["purchasePromiseSnapshot"]>) {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.database.prepare("SELECT record FROM dream_orders WHERE id=?").get(orderId) as RecordRow | undefined;
      if (!row) throw new Error("ORDER_NOT_FOUND");
      const order = parseRecord<OrderRecord>(row.record,"ORDER_STORE_READ_FAILED");
      if (order.status !== "pending") throw new Error("ORDER_NOT_PENDING");
      if (!order.purchasePromiseSnapshot) {
        order.purchasePromiseSnapshot = structuredClone(snapshot);
        this.writeOrderRecord(order);
      }
      this.database.exec("COMMIT;");
      return order;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      storeFailure("ORDER_PROMISE_SNAPSHOT_WRITE_FAILED",error);
    }
  }

  async recordPaymentVerificationKey(orderId: string, sessionHash: string, paymentKey: string) {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.database.prepare("SELECT record FROM dream_orders WHERE id=?").get(orderId) as RecordRow | undefined;
      if (!row) throw new Error("ORDER_NOT_FOUND");
      const order = parseRecord<OrderRecord>(row.record,"ORDER_STORE_READ_FAILED");
      if (order.sessionHash !== sessionHash || order.status !== "pending") throw new Error("ORDER_NOT_PENDING");
      if (order.verificationPaymentKey && order.verificationPaymentKey !== paymentKey) throw new Error("PAYMENT_KEY_MISMATCH");
      order.verificationPaymentKey = paymentKey;
      order.updatedAt = new Date().toISOString();
      this.writeOrderRecord(order);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      storeFailure("PAYMENT_VERIFICATION_KEY_SAVE_FAILED",error);
    }
  }

  async commitVerifiedPayment(order: OrderRecord, paidAt: string, lifetimeMs: number, enqueueDelivery: boolean) {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const orderRow = this.database.prepare("SELECT record FROM dream_orders WHERE id=?").get(order.id) as RecordRow | undefined;
      if (!orderRow) throw new Error("ORDER_NOT_FOUND");
      const storedOrder = parseRecord<OrderRecord>(orderRow.record,"ORDER_STORE_READ_FAILED");
      if (!["pending","paid"].includes(storedOrder.status)) throw new Error("ORDER_NOT_PENDING");
      if (storedOrder.id !== order.id || storedOrder.readingId !== order.readingId || storedOrder.product !== order.product || storedOrder.amount !== order.amount) throw new Error("ORDER_PAYMENT_DETAILS_MISMATCH");
      if (storedOrder.status === "paid" && storedOrder.paymentKey !== order.paymentKey) throw new Error("PAYMENT_KEY_MISMATCH");
      if (storedOrder.verificationPaymentKey && storedOrder.verificationPaymentKey !== order.paymentKey) throw new Error("PAYMENT_KEY_MISMATCH");
      const effectivePaidAt = storedOrder.status === "paid" ? storedOrder.updatedAt : paidAt;
      const paidOrder: OrderRecord = {
        ...storedOrder,
        ...order,
        purchasePromiseSnapshot: storedOrder.purchasePromiseSnapshot,
        status: "paid",
        paymentKey: storedOrder.status === "paid" ? storedOrder.paymentKey : order.paymentKey,
        providerTransactionKey: storedOrder.status === "paid" ? storedOrder.providerTransactionKey : order.providerTransactionKey,
        verificationPaymentKey: storedOrder.verificationPaymentKey ?? order.verificationPaymentKey ?? order.paymentKey,
        updatedAt: effectivePaidAt
      };
      const readingRow = this.database.prepare("SELECT record FROM dream_readings WHERE id=?").get(order.readingId) as RecordRow | undefined;
      if (!readingRow) throw new Error("READING_NOT_FOUND");
      const reading = parseRecord<ReadingRecord>(readingRow.record,"READING_STORE_READ_FAILED");
      if (order.product === "full_reading") reading.fullReadingOrderId ??= order.id;
      const entitlementRow = this.database.prepare("SELECT * FROM dream_entitlements WHERE reading_id=?").get(order.readingId) as {
        full_reading_purchased:number; base_question_allowance:0|2; extra_question_allowance:0|2; used_questions:number; extra_pack_purchased:number; updated_at:string;
      } | undefined;
      const entitlement: ReadingEntitlement = entitlementRow ? {
        readingId:order.readingId, fullReadingPurchased:Boolean(entitlementRow.full_reading_purchased),
        baseQuestionAllowance:entitlementRow.base_question_allowance, extraQuestionAllowance:entitlementRow.extra_question_allowance,
        usedQuestions:entitlementRow.used_questions, extraPackPurchased:Boolean(entitlementRow.extra_pack_purchased),updatedAt:entitlementRow.updated_at
      } : { readingId:order.readingId,fullReadingPurchased:false,baseQuestionAllowance:0,extraQuestionAllowance:0,usedQuestions:0,extraPackPurchased:false,updatedAt:effectivePaidAt };
      if (order.product === "full_reading") {
        entitlement.fullReadingPurchased = true;
        entitlement.baseQuestionAllowance = 2;
      } else {
        entitlement.extraPackPurchased = true;
        entitlement.extraQuestionAllowance = 2;
      }
      entitlement.updatedAt = effectivePaidAt;
      reading.paidAt ??= effectivePaidAt;
      reading.expiresAt = new Date(Math.max(Date.parse(reading.expiresAt),Date.parse(effectivePaidAt)+lifetimeMs)).toISOString();
      if (enqueueDelivery && order.product === "full_reading" && reading.detailGenerationStatus !== "ready") {
        reading.status = "paid_generating";
        reading.detailGenerationStatus = "generating";
        reading.detailGenerationError = null;
      }
      reading.updatedAt = effectivePaidAt;
      this.writeOrderRecord(paidOrder);
      this.database.prepare(`INSERT INTO dream_entitlements(reading_id,full_reading_purchased,base_question_allowance,
        extra_question_allowance,used_questions,extra_pack_purchased,updated_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(reading_id) DO UPDATE SET full_reading_purchased=excluded.full_reading_purchased,
          base_question_allowance=excluded.base_question_allowance,extra_question_allowance=excluded.extra_question_allowance,
          used_questions=excluded.used_questions,extra_pack_purchased=excluded.extra_pack_purchased,updated_at=excluded.updated_at`)
        .run(entitlement.readingId,Number(entitlement.fullReadingPurchased),entitlement.baseQuestionAllowance,entitlement.extraQuestionAllowance,
          entitlement.usedQuestions,Number(entitlement.extraPackPurchased),entitlement.updatedAt);
      this.writeReadingRecord(reading);
      if (enqueueDelivery && order.product === "full_reading" && reading.detailGenerationStatus !== "ready") {
        this.database.prepare(`INSERT INTO dream_paid_delivery_outbox(reading_id,order_id,status,error_code,created_at,updated_at)
          VALUES(?,?,'pending',NULL,?,?) ON CONFLICT(reading_id) DO UPDATE SET order_id=COALESCE(dream_paid_delivery_outbox.order_id,excluded.order_id)`)
          .run(order.readingId, order.product === "full_reading" ? order.id : null, effectivePaidAt,effectivePaidAt);
      }
      this.database.exec("COMMIT;");
      return reading;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      storeFailure("VERIFIED_PAYMENT_COMMIT_FAILED",error);
    }
  }

  async saveOrder(order: OrderRecord) {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const currentRow = this.database.prepare("SELECT record FROM dream_orders WHERE id=?").get(order.id) as RecordRow | undefined;
      const current = currentRow ? parseRecord<OrderRecord>(currentRow.record,"ORDER_STORE_READ_FAILED") : null;
      if (current && current.status !== "pending") {
        this.database.exec("COMMIT;");
        return;
      }
      const persistedOrder = current ? { ...order, purchasePromiseSnapshot: current.purchasePromiseSnapshot } : order;
      this.writeOrderRecord(persistedOrder);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      storeFailure("ORDER_STORE_WRITE_FAILED", error);
    }
  }

  async findPendingOrder(readingId: string, sessionHash: string, product: OrderProduct) {
    this.assertOpen();
    try {
      const row = this.database
        .prepare(`
          SELECT record FROM dream_orders
          WHERE reading_id = ? AND session_hash = ? AND product = ? AND status = 'pending'
          ORDER BY created_at DESC, id DESC LIMIT 1
        `)
        .get(readingId, sessionHash, product) as RecordRow | undefined;
      if (!row) return null;
      const order = parseRecord<OrderRecord>(row.record, "ORDER_STORE_READ_FAILED");
      return order.product ? order : ({ ...order, product: "full_reading" } as OrderRecord);
    } catch (error) {
      storeFailure("ORDER_STORE_READ_FAILED", error);
    }
  }

  async recordEvent(event: StoredAnalyticsEvent) {
    this.assertOpen();
    try {
      this.database
        .prepare(`
          INSERT INTO dream_analytics_events (event_name, reading_id, context, occurred_at)
          VALUES (?, ?, ?, ?)
        `)
        .run(event.event, event.readingId, JSON.stringify(sanitizedAnalyticsContext(event.context)), event.occurredAt);
    } catch (error) {
      storeFailure("EVENT_STORE_WRITE_FAILED", error);
    }
  }

  close() {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }
}
