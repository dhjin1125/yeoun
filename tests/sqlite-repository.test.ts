import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { decryptJson, encryptDream, encryptJson } from "@/lib/crypto";
import { analyzeDreamLocally } from "@/lib/local-engine";
import { createOrder } from "@/lib/payments";
import { SQLiteRepository } from "@/lib/repository/sqlite";
import { createReading, PAID_LIFETIME_MS, storeStagedFreeReadingV3 } from "@/lib/readings";
import type { AssistantTurnPayload, ConversationTurn, OrderRecord, StagedFreeReadingV3Payload } from "@/lib/types";
import { DETAILED_DREAM } from "./helpers/repository";

const temporaryDirectories: string[] = [];

function databaseFixture() {
  const directory = mkdtempSync(join(tmpdir(), "kkumgyeol-sqlite-"));
  temporaryDirectories.push(directory);
  return { directory, path: join(directory, "dream.sqlite3") };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLiteRepository", () => {
  it("serializes concurrent pending-order creation and commits a verified purchase with its delivery outbox", async () => {
    const fixture = databaseFixture();
    const repository = new SQLiteRepository(fixture.path);
    const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "atomic-payment", repository);
    const [first, second] = await Promise.all([
      createOrder(reading, "full_reading", "atomic-payment", repository),
      createOrder(reading, "full_reading", "atomic-payment", repository)
    ]);
    expect(first.id).toBe(second.id);
    const firstSnapshot = first.purchasePromiseSnapshot!;
    if (firstSnapshot.promiseVersion !== "paid-offer-v1") throw new Error("Expected the public v1 offer snapshot.");
    const inspector = new DatabaseSync(fixture.path);
    expect(inspector.prepare("SELECT count(*) AS count FROM dream_orders WHERE status='pending'").get()).toMatchObject({ count: 1 });

    await repository.recordPaymentVerificationKey(first.id, "atomic-payment", "toss_atomic_key");
    const paidAt = new Date().toISOString();
    const approved = {
      ...first,
      purchasePromiseSnapshot: {
        ...firstSnapshot,
        promiseSha256: "e".repeat(64),
        offer: { ...firstSnapshot.offer, headline: `${firstSnapshot.offer.headline}!` }
      },
      status: "paid" as const,
      paymentKey: "toss_atomic_key",
      providerTransactionKey: "tx_atomic",
      verificationPaymentKey: "toss_atomic_key"
    };
    inspector.exec(`CREATE TRIGGER fail_paid_delivery BEFORE INSERT ON dream_paid_delivery_outbox BEGIN SELECT RAISE(ABORT, 'injected outbox write failure'); END;`);
    await expect(repository.commitVerifiedPayment(approved, paidAt, PAID_LIFETIME_MS, true)).rejects.toThrow("VERIFIED_PAYMENT_COMMIT_FAILED");
    expect((await repository.getOrder(first.id))?.status).toBe("pending");
    expect((await repository.getOrder(first.id))?.purchasePromiseSnapshot).toEqual(firstSnapshot);
    expect((await repository.getEntitlement(reading.id))?.fullReadingPurchased).toBe(false);
    expect((await repository.getReading(reading.id))?.detailGenerationStatus).toBe("locked");
    expect(inspector.prepare("SELECT count(*) AS count FROM dream_paid_delivery_outbox").get()).toMatchObject({ count: 0 });

    inspector.exec("DROP TRIGGER fail_paid_delivery;");
    await repository.commitVerifiedPayment(approved, paidAt, PAID_LIFETIME_MS, true);
    expect((await repository.getOrder(first.id))?.status).toBe("paid");
    expect((await repository.getOrder(first.id))?.purchasePromiseSnapshot).toEqual(firstSnapshot);
    expect((await repository.getEntitlement(reading.id))?.fullReadingPurchased).toBe(true);
    expect((await repository.getReading(reading.id))?.detailGenerationStatus).toBe("generating");
    expect(inspector.prepare("SELECT status,order_id FROM dream_paid_delivery_outbox WHERE reading_id=?").get(reading.id)).toMatchObject({ status: "pending", order_id: first.id });
    expect((await repository.getReading(reading.id))?.fullReadingOrderId).toBe(first.id);
    inspector.close();
    repository.close();
  });

  it("roundtrips V2, versionless, and V3 encrypted free turns while keeping legacy orders readable", async () => {
    const fixture = databaseFixture();
    let repository = new SQLiteRepository(fixture.path);
    const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "free-turn-roundtrip", repository);
    const v2Payload: AssistantTurnPayload = {
      qualityVersion: 2,
      freeCompositionVersion: 2,
      generationSource: "local",
      directAnswerTitle: "먼저 답하면",
      directAnswer: "꿈에 나온 장면을 살펴볼게요.",
      sections: [],
      interpretationChanges: null,
      uncertainty: [],
      shareableSentences: [],
      suggestedQuestions: []
    };
    const versionlessPayload: AssistantTurnPayload = { ...v2Payload };
    delete versionlessPayload.freeCompositionVersion;
    const v2TurnId = "turn_free_v2_roundtrip";
    const legacyTurnId = "turn_free_versionless_roundtrip";
    const makeTurn = (id: string, payload: AssistantTurnPayload): ConversationTurn => ({
      id,
      readingId: reading.id,
      role: "kkumgyeol",
      kind: "free",
      status: "complete",
      clientMessageId: null,
      encryptedContent: encryptJson(payload, "turn", id),
      createdAt: new Date().toISOString()
    });
    await repository.saveConversationTurn(makeTurn(v2TurnId, v2Payload));
    await repository.saveConversationTurn(makeTurn(legacyTurnId, versionlessPayload));
    const v3Payload: StagedFreeReadingV3Payload = {
      freeCompositionVersion: 3,
      contentContractVersion: 1,
      instructionVersion: "staged-free-v3-1",
      generationInstructionSha256: "1".repeat(64),
      appInstructionsSha256: "2".repeat(64),
      generationSource: "codex",
      title: "건너다 멈춘 꿈",
      primarySection: { heading: "멈춘 지점", paragraphs: ["낡은 다리 한가운데서 잠시 멈춰 섰어요.", "뒤에서 사람들이 다가오는 순간 옆길을 살폈어요."] },
      secondarySection: { heading: "마음이 놓인 순간", paragraphs: ["옆길로 내려간 뒤 마음이 조금씩 놓였어요."] },
      coverage: {
        primary: { label: "다리에서 멈춤", evidenceQuotes: ["중간에서 멈췄어요"] },
        secondary: { label: "옆길로 내려감", evidenceQuotes: ["옆길로 내려갔고"] },
        reserved: [{ label: "뒤에서 다가온 사람들", evidenceQuotes: ["뒤에서 사람들이 다가와서"] }]
      },
      contentContract: {
        delivered: { label: "다리에서 멈춤", evidenceQuotes: ["중간에서 멈췄어요"] },
        discovered: { label: "옆길로 내려감", evidenceQuotes: ["옆길로 내려갔고"] },
        reserved: [{ label: "뒤에서 다가온 사람들", evidenceQuotes: ["뒤에서 사람들이 다가와서"] }],
        offerEligibility: { eligible: false, perspectives: [] }
      }
    };
    const v3Turn = await storeStagedFreeReadingV3(reading.id, v3Payload, repository, "2026-09-27T02:00:00.000Z");
    repository.close();
    repository = new SQLiteRepository(fixture.path);
    const turns = await repository.getConversationTurns(reading.id);
    expect(decryptJson<AssistantTurnPayload>(turns.find(turn => turn.id === v2TurnId)!.encryptedContent, "turn", v2TurnId)).toEqual(v2Payload);
    expect(decryptJson<AssistantTurnPayload>(turns.find(turn => turn.id === legacyTurnId)!.encryptedContent, "turn", legacyTurnId)).toEqual(versionlessPayload);
    expect(decryptJson<StagedFreeReadingV3Payload>(turns.find(turn => turn.id === v3Turn.id)!.encryptedContent, "turn", v3Turn.id)).toEqual(v3Payload);

    const legacyOrder: OrderRecord = {
      id: "order_legacy_roundtrip",
      readingId: reading.id,
      sessionHash: "free-turn-roundtrip",
      product: "full_reading",
      amount: 990,
      status: "pending",
      paymentKey: null,
      providerTransactionKey: null,
      contentConsentAt: "2026-09-27T00:00:00.000Z",
      createdAt: "2026-09-27T00:00:00.000Z",
      updatedAt: "2026-09-27T00:00:00.000Z"
    };
    await repository.saveOrder(legacyOrder);
    expect(await repository.getOrder(legacyOrder.id)).toEqual(legacyOrder);
    repository.close();
  });

  it("reclaims abandoned completion requests only after the full provider budget",async()=> {
    const fixture=databaseFixture();
    const repository=new SQLiteRepository(fixture.path);
    const reading=await createReading({dream:DETAILED_DREAM,emotion:null},"stale-completion",repository);
    const entitlement=(await repository.getEntitlement(reading.id))!;
    await repository.saveEntitlement({...entitlement,fullReadingPurchased:true,baseQuestionAllowance:2,usedQuestions:0});
    await repository.reserveQuestion(reading.id,"prior_question",true);
    const inspector=new DatabaseSync(fixture.path);
    inspector.prepare("UPDATE dream_message_reservations SET reserved_at=? WHERE reading_id=?").run(new Date(Date.now()-6*60*1000).toISOString(),reading.id);
    expect((await repository.reserveQuestion(reading.id,"repair",false)).status).toBe("duplicate_pending");
    inspector.prepare("UPDATE dream_message_reservations SET reserved_at=? WHERE reading_id=?").run(new Date(Date.now()-31*60*1000).toISOString(),reading.id);
    expect((await repository.reserveQuestion(reading.id,"repair",false)).status).toBe("reserved");
    expect((await repository.getEntitlement(reading.id))?.usedQuestions).toBe(0);
    inspector.close();repository.close();
  });
  it("extends an active follow-up reservation so recovery cannot refund its live credit", async () => {
    const fixture = databaseFixture();
    const repository = new SQLiteRepository(fixture.path);
    const reading = await createReading({ dream: DETAILED_DREAM, emotion: null }, "active-completion", repository);
    const entitlement = (await repository.getEntitlement(reading.id))!;
    await repository.saveEntitlement({ ...entitlement, fullReadingPurchased: true, baseQuestionAllowance: 2, usedQuestions: 0 });
    expect((await repository.reserveQuestion(reading.id, "live_question")).status).toBe("reserved");
    const inspector = new DatabaseSync(fixture.path);
    inspector.prepare("UPDATE dream_message_reservations SET reserved_at=? WHERE reading_id=?")
      .run(new Date(Date.now() - 31 * 60_000).toISOString(), reading.id);
    inspector.close();
    expect(await repository.heartbeatQuestionReservation(reading.id, "live_question")).toBe(true);
    expect(await repository.recoverStaleQuestionReservations()).toBe(0);
    expect((await repository.getEntitlement(reading.id))?.usedQuestions).toBe(1);
    await repository.releaseQuestionReservation(reading.id, "live_question");
    repository.close();
  });
  it("persists uncharged completion requests at zero credits and never refunds a credit for them", async()=> {
    const fixture=databaseFixture();
    const repository=new SQLiteRepository(fixture.path);
    const reading=await createReading({dream:DETAILED_DREAM,emotion:null},"sqlite-completion",repository);
    const entitlement=(await repository.getEntitlement(reading.id))!;
    await repository.saveEntitlement({...entitlement,fullReadingPurchased:true,baseQuestionAllowance:2,usedQuestions:2});
    expect((await repository.reserveQuestion(reading.id,"free_fix",false)).status).toBe("reserved");
    expect((await repository.reserveQuestion(reading.id,"free_fix",false)).status).toBe("duplicate_pending");
    expect((await repository.reserveQuestion(reading.id,"other_fix",false)).status).toBe("duplicate_pending");
    expect((await repository.reserveQuestion(reading.id,"paid_question")).status).toBe("duplicate_pending");
    await repository.releaseQuestionReservation(reading.id,"free_fix");
    expect((await repository.getEntitlement(reading.id))?.usedQuestions).toBe(2);
    expect((await repository.reserveQuestion(reading.id,"free_fix",false)).status).toBe("reserved");
    await repository.completeQuestionReservation(reading.id,"free_fix");
    repository.close();
    const reopened=new SQLiteRepository(fixture.path);
    expect((await reopened.reserveQuestion(reading.id,"free_fix",false)).status).toBe("duplicate_complete");
    await reopened.releaseQuestionReservation(reading.id,"free_fix");
    expect((await reopened.getEntitlement(reading.id))?.usedQuestions).toBe(2);
    expect((await reopened.reserveQuestion(reading.id,"paid_question")).status).toBe("credits_exhausted");
    reopened.close();
  });
  it("migrates legacy records into encrypted timeline storage without deleting the reading", async () => {
    const fixture = databaseFixture();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
    const readingId = "dream_legacy_fixture";
    const legacySentinel = "LEGACY_PLAINTEXT_ASSISTANT_SENTINEL";
    const legacy = {
      id: readingId,
      status: "free_ready",
      sessionHash: "legacy-session",
      ownerUserId: null,
      encryptedDream: encryptDream(DETAILED_DREAM, readingId),
      structure: analyzeDreamLocally(DETAILED_DREAM, null).structure,
      selectedEmotion: null,
      questions: [],
      questionCursor: 0,
      answers: [],
      freeResult: {
        headline: legacySentinel,
        directions: ["심리 반영"],
        symbols: [{ name: "뱀", meaning: "이전 장면 해석" }],
        psychology: "이전 심리 해석",
        uncertaintyNote: null
      },
      paidPreviews: [],
      paidReport: null,
      followUp: null,
      safetyNotice: null,
      createdAt,
      updatedAt: createdAt,
      paidAt: null,
      expiresAt
    };
    const legacyOrder = {
      id: "order_legacy_fixture",
      readingId,
      sessionHash: "legacy-session",
      amount: 990,
      status: "pending",
      paymentKey: null,
      providerTransactionKey: null,
      contentConsentAt: createdAt,
      createdAt,
      updatedAt: createdAt
    };
    const old = new DatabaseSync(fixture.path, { enableForeignKeyConstraints: true });
    old.exec(`
      CREATE TABLE dream_readings (
        id TEXT PRIMARY KEY, session_hash TEXT NOT NULL, owner_user_id TEXT,
        status TEXT NOT NULL, record TEXT NOT NULL CHECK (json_valid(record)),
        expires_at TEXT NOT NULL, paid_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE dream_orders (
        id TEXT PRIMARY KEY, reading_id TEXT NOT NULL REFERENCES dream_readings(id) ON DELETE CASCADE,
        session_hash TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL,
        payment_key TEXT, record TEXT NOT NULL CHECK (json_valid(record)),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE dream_analytics_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_name TEXT NOT NULL CHECK (event_name IN ('analysis_submitted')),
        reading_id TEXT REFERENCES dream_readings(id) ON DELETE SET NULL,
        context TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(context)), occurred_at TEXT NOT NULL
      ) STRICT;
    `);
    old.prepare(`
      INSERT INTO dream_readings (
        id, session_hash, owner_user_id, status, record, expires_at, paid_at, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, ?)
    `).run(readingId, "legacy-session", "free_ready", JSON.stringify(legacy), expiresAt, createdAt, createdAt);
    old.prepare(`
      INSERT INTO dream_orders (
        id, reading_id, session_hash, amount, status, payment_key, record, created_at, updated_at
      ) VALUES (?, ?, ?, 990, 'pending', NULL, ?, ?, ?)
    `).run(legacyOrder.id, readingId, "legacy-session", JSON.stringify(legacyOrder), createdAt, createdAt);
    old.close();

    const repository = new SQLiteRepository(fixture.path);
    const migrated = await repository.getReading(readingId);
    const turns = await repository.getConversationTurns(readingId);

    expect(migrated?.detailGenerationStatus).toBe("locked");
    expect(migrated).not.toHaveProperty("structure");
    expect(turns.map((turn) => turn.kind)).toEqual(["dream", "free"]);
    expect(await repository.getEntitlement(readingId)).toMatchObject({ fullReadingPurchased: false, usedQuestions: 0 });
    expect((await repository.getOrder(legacyOrder.id))?.product).toBe("full_reading");
    repository.close();

    expect(readFileSync(fixture.path).includes(Buffer.from(legacySentinel, "utf8"))).toBe(false);
  });

  it("survives close and reopen without storing plaintext dream text", async () => {
    const fixture = databaseFixture();
    const first = new SQLiteRepository(fixture.path);
    const reading = await createReading(
      { dream: DETAILED_DREAM, emotion: null },
      "sqlite-restart-session",
      first
    );
    const order = await createOrder(reading, "full_reading", "sqlite-restart-session", first);
    await first.recordEvent({
      event: "analysis_submitted",
      readingId: reading.id,
      context: { source: "test" },
      occurredAt: new Date().toISOString()
    });
    first.close();

    expect(readFileSync(fixture.path).includes(Buffer.from(DETAILED_DREAM, "utf8"))).toBe(false);

    const reopened = new SQLiteRepository(fixture.path);
    await expect(reopened.checkHealth()).resolves.toBeUndefined();
    expect(await reopened.getReading(reading.id)).toEqual({ ...reading, status: "payment_pending", updatedAt: order.updatedAt });
    expect((await reopened.findPendingOrder(reading.id, "sqlite-restart-session", "full_reading"))?.id).toBe(order.id);

    await reopened.deleteReading(reading.id);
    expect(await reopened.getOrder(order.id)).toBeNull();
    reopened.close();

    const inspector = new DatabaseSync(fixture.path, { readOnly: true });
    const event = inspector.prepare("SELECT reading_id FROM dream_analytics_events LIMIT 1").get() as {
      reading_id: string | null;
    };
    expect(event.reading_id).toBeNull();
    inspector.close();
  });

  it("upgrades an existing analytics allowlist before recording contextual offer events", async () => {
    const fixture = databaseFixture();
    const old = new DatabaseSync(fixture.path, { enableForeignKeyConstraints: true });
    old.exec(`
      CREATE TABLE dream_readings (
        id TEXT PRIMARY KEY, session_hash TEXT NOT NULL, owner_user_id TEXT,
        status TEXT NOT NULL, record TEXT NOT NULL CHECK (json_valid(record)),
        expires_at TEXT NOT NULL, paid_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE dream_orders (
        id TEXT PRIMARY KEY, reading_id TEXT NOT NULL REFERENCES dream_readings(id) ON DELETE CASCADE,
        session_hash TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL,
        payment_key TEXT, record TEXT NOT NULL CHECK (json_valid(record)),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE dream_analytics_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_name TEXT NOT NULL CHECK (event_name IN ('analysis_submitted', 'deep_reading_viewed')),
        reading_id TEXT REFERENCES dream_readings(id) ON DELETE SET NULL,
        context TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(context)), occurred_at TEXT NOT NULL
      ) STRICT;
    `);
    old.close();

    const repository = new SQLiteRepository(fixture.path);
    await expect(repository.recordEvent({
      event: "paywall_viewed",
      readingId: null,
      context: { offerVariant: "contextual_questions_v1", riskClass: "standard" },
      occurredAt: new Date().toISOString()
    })).resolves.toBeUndefined();
    repository.close();

    const inspector = new DatabaseSync(fixture.path, { readOnly: true });
    const event = inspector.prepare("SELECT event_name FROM dream_analytics_events LIMIT 1").get() as {
      event_name: string;
    };
    expect(event.event_name).toBe("paywall_viewed");
    inspector.close();
  });

  it("removes expired readings on lookup", async () => {
    const fixture = databaseFixture();
    const repository = new SQLiteRepository(fixture.path);
    const reading = await createReading(
      { dream: DETAILED_DREAM, emotion: null },
      "sqlite-expired-session",
      repository
    );
    reading.expiresAt = new Date(Date.now() - 1_000).toISOString();
    await repository.saveReading(reading);

    expect(await repository.getReading(reading.id)).toBeNull();
    repository.close();
  });
});
