import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ephemeralMemoryAllowed } from "../app-profile";
import type {
  AnalyticsEvent,
  ConversationTurn,
  OrderProduct,
  OrderRecord,
  QuestionReservation,
  ReadingEntitlement,
  ReadingRecord
} from "../types";
import { isCurrentReadingRecord, migrateLegacyReading } from "../legacy-reading";
import { SQLiteRepository } from "./sqlite";
import { mutateMemoryConversationGuard, transitionConversationGuard, type ConversationGuardCommand, type ConversationGuardResult, type ConversationGuardState, type StoredConversationGuard } from "../conversation-guard";

export type StoredAnalyticsEvent = {
  event: AnalyticsEvent;
  readingId: string | null;
  context: Record<string, string>;
  occurredAt: string;
};

export interface DreamRepository {
  checkHealth(): Promise<void>;
  mutateConversationGuard(key: string, command: ConversationGuardCommand, expiresAt: number): Promise<ConversationGuardResult>;
  getReading(id: string): Promise<ReadingRecord | null>;
  saveReading(reading: ReadingRecord): Promise<void>;
  deleteReading(id: string): Promise<void>;
  getConversationTurns(readingId: string): Promise<ConversationTurn[]>;
  saveConversationTurn(turn: ConversationTurn): Promise<void>;
  getEntitlement(readingId: string): Promise<ReadingEntitlement | null>;
  saveEntitlement(entitlement: ReadingEntitlement): Promise<void>;
  reserveQuestion(readingId: string, clientMessageId: string, charge?: boolean, turn?: ConversationTurn, requestHash?: string): Promise<QuestionReservation>;
  heartbeatQuestionReservation(readingId: string, clientMessageId: string): Promise<boolean>;
  completeQuestionReservation(readingId: string, clientMessageId: string): Promise<void>;
  completeQuestionWithTurns(readingId: string, clientMessageId: string, userTurn: ConversationTurn, assistantTurn: ConversationTurn, encryptedContext?: ReadingRecord["encryptedContext"]): Promise<void>;
  releaseQuestionReservation(readingId: string, clientMessageId: string, userTurn?: ConversationTurn): Promise<void>;
  recoverStaleQuestionReservations(): Promise<number>;
  getOrder(id: string): Promise<OrderRecord | null>;
  saveOrder(order: OrderRecord): Promise<void>;
  setPurchasePromiseSnapshotIfMissing(orderId: string, snapshot: NonNullable<OrderRecord["purchasePromiseSnapshot"]>): Promise<OrderRecord>;
  createPendingOrder(order: OrderRecord, reading: ReadingRecord): Promise<OrderRecord>;
  recordPaymentVerificationKey(orderId: string, sessionHash: string, paymentKey: string): Promise<void>;
  commitVerifiedPayment(order: OrderRecord, paidAt: string, lifetimeMs: number, enqueueDelivery: boolean): Promise<ReadingRecord>;
  findPendingOrder(
    readingId: string,
    sessionHash: string,
    product: OrderProduct
  ): Promise<OrderRecord | null>;
  recordEvent(event: StoredAnalyticsEvent): Promise<void>;
}

type ReservationState = {
  readingId: string;
  clientMessageId: string;
  status: "reserved" | "complete" | "released";
  reservedAt: string;
  charged?: boolean;
  requestHash?: string;
};

type MemoryState = {
  conversationGuards: Map<string, StoredConversationGuard>;
  readings: Map<string, ReadingRecord>;
  turns: Map<string, ConversationTurn>;
  entitlements: Map<string, ReadingEntitlement>;
  reservations: Map<string, ReservationState>;
  orders: Map<string, OrderRecord>;
  events: StoredAnalyticsEvent[];
};

declare global {
  var __kkumgyeolMemoryState: MemoryState | undefined;
}

const ANALYTICS_CONTEXT_KEYS = new Set([
  "source",
  "step",
  "paymentMode",
  "product",
  "offerVariant",
  "riskClass",
  "cardKey",
  "focus",
  "model",
  "operation",
  "success",
  "durationBucket",
  "rating", "reason", "intent"
]);

export function sanitizedAnalyticsContext(context: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(context)
      .filter(([key, value]) => ANALYTICS_CONTEXT_KEYS.has(key) && value.length <= 80)
      .map(([key, value]) => [key, value])
  );
}

function memoryState() {
  if (!globalThis.__kkumgyeolMemoryState) {
    globalThis.__kkumgyeolMemoryState = {
      conversationGuards: new Map(),
      readings: new Map(),
      turns: new Map(),
      entitlements: new Map(),
      reservations: new Map(),
      orders: new Map(),
      events: []
    };
  }
  return globalThis.__kkumgyeolMemoryState;
}

function reservationKey(readingId: string, clientMessageId: string) {
  return `${readingId}:${clientMessageId}`;
}

function allowance(entitlement: ReadingEntitlement) {
  return entitlement.baseQuestionAllowance + entitlement.extraQuestionAllowance;
}

class MemoryRepository implements DreamRepository {
  async checkHealth() {}

  async mutateConversationGuard(key: string, command: ConversationGuardCommand, expiresAt: number) {
    const state = memoryState();
    state.conversationGuards ??= new Map();
    return mutateMemoryConversationGuard(state.conversationGuards, key, command, expiresAt);
  }

  async getReading(id: string) {
    const reading = memoryState().readings.get(id) ?? null;
    if (reading && new Date(reading.expiresAt).getTime() <= Date.now()) {
      await this.deleteReading(id);
      return null;
    }
    return reading ? structuredClone(reading) : null;
  }

  async saveReading(reading: ReadingRecord) {
    memoryState().readings.set(reading.id, structuredClone(reading));
  }

  async deleteReading(id: string) {
    const state = memoryState();
    state.conversationGuards?.delete(`reading:${id}`);
    state.readings.delete(id);
    state.entitlements.delete(id);
    for (const [turnId, turn] of state.turns) if (turn.readingId === id) state.turns.delete(turnId);
    for (const [key, item] of state.reservations) if (item.readingId === id) state.reservations.delete(key);
    for (const [orderId, order] of state.orders) if (order.readingId === id) state.orders.delete(orderId);
    state.events = state.events.map((event) => (event.readingId === id ? { ...event, readingId: null } : event));
  }

  async getConversationTurns(readingId: string) {
    return [...memoryState().turns.values()]
      .filter((turn) => turn.readingId === readingId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((turn) => structuredClone(turn));
  }

  async saveConversationTurn(turn: ConversationTurn) {
    const state = memoryState();
    if (turn.clientMessageId) {
      const duplicate = [...state.turns.values()].find(
        (candidate) =>
          candidate.readingId === turn.readingId &&
          candidate.clientMessageId === turn.clientMessageId &&
          candidate.id !== turn.id
      );
      if (duplicate) throw new Error("MESSAGE_CLIENT_ID_CONFLICT");
    }
    state.turns.set(turn.id, structuredClone(turn));
  }

  async getEntitlement(readingId: string) {
    const entitlement = memoryState().entitlements.get(readingId) ?? null;
    return entitlement ? structuredClone(entitlement) : null;
  }

  async saveEntitlement(entitlement: ReadingEntitlement) {
    memoryState().entitlements.set(entitlement.readingId, structuredClone(entitlement));
  }

  async reserveQuestion(readingId: string, clientMessageId: string, charge = true, turn?: ConversationTurn, requestHash?: string): Promise<QuestionReservation> {
    const state = memoryState();
    const key = reservationKey(readingId, clientMessageId);
    const entitlement = state.entitlements.get(readingId);
    for (const item of state.reservations.values()) {
      if (item.readingId===readingId && item.status==="reserved" && new Date(item.reservedAt).getTime()<Date.now()-30*60*1000) {
        item.status="released";
        if (entitlement && item.charged !== false) entitlement.usedQuestions=Math.max(0,entitlement.usedQuestions-1);
        for (const turn of state.turns.values()) if (turn.readingId===readingId && turn.clientMessageId===item.clientMessageId && turn.status==="pending") turn.status="failed";
      }
    }
    const existing = state.reservations.get(key);
    if (existing?.requestHash && requestHash && existing.requestHash !== requestHash) throw new Error("MESSAGE_CLIENT_ID_CONFLICT");
    const remaining = entitlement ? Math.max(0, allowance(entitlement) - entitlement.usedQuestions) : 0;
    if (existing?.status === "complete") return { status: "duplicate_complete", remainingQuestions: remaining };
    if (existing?.status === "reserved") return { status: "duplicate_pending", remainingQuestions: remaining };
    if (!entitlement?.fullReadingPurchased) return { status: "not_entitled", remainingQuestions: 0 };
    if ([...state.reservations.values()].some(item=>item.readingId===readingId && item.status === "reserved")) return {status:"duplicate_pending",remainingQuestions:remaining};
    if (charge && remaining <= 0) return { status: "credits_exhausted", remainingQuestions: 0 };

    entitlement.usedQuestions += charge ? 1 : 0;
    entitlement.updatedAt = new Date().toISOString();
    state.entitlements.set(readingId, structuredClone(entitlement));
    state.reservations.set(key, {
      readingId,
      clientMessageId,
      status: "reserved",
      reservedAt: entitlement.updatedAt,
      charged: charge,
      requestHash
    });
    if (turn) state.turns.set(turn.id, structuredClone(turn));
    return {
      status: "reserved",
      remainingQuestions: Math.max(0, allowance(entitlement) - entitlement.usedQuestions)
    };
  }

  async completeQuestionReservation(readingId: string, clientMessageId: string) {
    const item = memoryState().reservations.get(reservationKey(readingId, clientMessageId));
    if (!item || item.status !== "reserved") throw new Error("QUESTION_RESERVATION_NOT_FOUND");
    item.status = "complete";
  }

  async heartbeatQuestionReservation(readingId: string, clientMessageId: string) {
    const reservation = memoryState().reservations.get(reservationKey(readingId, clientMessageId));
    if (!reservation || reservation.status !== "reserved") return false;
    reservation.reservedAt = new Date().toISOString();
    return true;
  }

  async completeQuestionWithTurns(readingId: string, clientMessageId: string, userTurn: ConversationTurn, assistantTurn: ConversationTurn, encryptedContext?: ReadingRecord["encryptedContext"]) {
    const state = memoryState();
    const reservation = state.reservations.get(reservationKey(readingId, clientMessageId));
    if (reservation?.status === "complete" && state.turns.has(assistantTurn.id)) return;
    if (!reservation || reservation.status !== "reserved") throw new Error("QUESTION_RESERVATION_NOT_FOUND");
    const current = state.readings.get(readingId);
    if (!current) throw new Error("READING_NOT_FOUND");
    state.turns.set(userTurn.id, structuredClone(userTurn));
    state.turns.set(assistantTurn.id, structuredClone(assistantTurn));
    if (encryptedContext) {
      current.encryptedContext = structuredClone(encryptedContext);
      current.updatedAt = new Date().toISOString();
    }
    reservation.status = "complete";
  }

  async releaseQuestionReservation(readingId: string, clientMessageId: string, userTurn?: ConversationTurn) {
    const state = memoryState();
    const item = state.reservations.get(reservationKey(readingId, clientMessageId));
    if (!item || item.status !== "reserved") return;
    const entitlement = state.entitlements.get(readingId);
    if (entitlement && item.charged !== false) {
      entitlement.usedQuestions = Math.max(0, entitlement.usedQuestions - 1);
      entitlement.updatedAt = new Date().toISOString();
    }
    item.status = "released";
    if (userTurn) state.turns.set(userTurn.id, structuredClone(userTurn));
  }

  async recoverStaleQuestionReservations() {
    const state = memoryState();
    const cutoff = Date.now() - 30 * 60 * 1000;
    let recovered = 0;
    for (const item of state.reservations.values()) {
      if (item.status !== "reserved" || Date.parse(item.reservedAt) >= cutoff) continue;
      const entitlement = state.entitlements.get(item.readingId);
      if (entitlement && item.charged !== false) entitlement.usedQuestions = Math.max(0, entitlement.usedQuestions - 1);
      item.status = "released";
      for (const turn of state.turns.values()) if (turn.readingId === item.readingId && turn.clientMessageId === item.clientMessageId && turn.status === "pending") turn.status = "failed";
      recovered++;
    }
    return recovered;
  }

  async getOrder(id: string) {
    const order = memoryState().orders.get(id) ?? null;
    return order ? structuredClone(order) : null;
  }

  async saveOrder(order: OrderRecord) {
    const state = memoryState();
    if (order.paymentKey) {
      const duplicate = [...state.orders.values()].find(
        (candidate) => candidate.paymentKey === order.paymentKey && candidate.id !== order.id
      );
      if (duplicate) throw new Error("ORDER_STORE_WRITE_FAILED:SQLITE_CONSTRAINT_UNIQUE:payment_key_unique");
    }
    const current = state.orders.get(order.id);
    if (current && current.status !== "pending") return;
    state.orders.set(order.id, structuredClone(current
      ? { ...order, purchasePromiseSnapshot: current.purchasePromiseSnapshot }
      : order));
  }

  async setPurchasePromiseSnapshotIfMissing(orderId: string, snapshot: NonNullable<OrderRecord["purchasePromiseSnapshot"]>) {
    const state = memoryState();
    const current = state.orders.get(orderId);
    if (!current || current.status !== "pending") throw new Error("ORDER_NOT_PENDING");
    if (!current.purchasePromiseSnapshot) {
      current.purchasePromiseSnapshot = structuredClone(snapshot);
      state.orders.set(orderId, current);
    }
    return structuredClone(current);
  }

  async createPendingOrder(order: OrderRecord, reading: ReadingRecord) {
    const state = memoryState();
    const existing = [...state.orders.values()].find(candidate => candidate.readingId === reading.id && candidate.sessionHash === order.sessionHash && candidate.product === order.product && candidate.status === "pending");
    if (existing) {
      if (!existing.purchasePromiseSnapshot && order.purchasePromiseSnapshot) {
        return this.setPurchasePromiseSnapshotIfMissing(existing.id, order.purchasePromiseSnapshot);
      }
      return structuredClone(existing);
    }
    const current = state.readings.get(reading.id);
    if (!current) throw new Error("READING_NOT_FOUND");
    if (order.product === "full_reading") {
      current.status = "payment_pending";
      current.updatedAt = order.updatedAt;
    }
    state.readings.set(reading.id, structuredClone(current));
    state.orders.set(order.id, structuredClone(order));
    return structuredClone(order);
  }

  async recordPaymentVerificationKey(orderId: string, sessionHash: string, paymentKey: string) {
    const order = memoryState().orders.get(orderId);
    if (!order || order.sessionHash !== sessionHash || order.status !== "pending") throw new Error("ORDER_NOT_PENDING");
    if (order.verificationPaymentKey && order.verificationPaymentKey !== paymentKey) throw new Error("PAYMENT_KEY_MISMATCH");
    order.verificationPaymentKey = paymentKey;
    order.updatedAt = new Date().toISOString();
  }

  async commitVerifiedPayment(order: OrderRecord, paidAt: string, lifetimeMs: number, enqueueDelivery: boolean) {
    const state = memoryState();
    const currentOrder = state.orders.get(order.id);
    if (!currentOrder || !["pending", "paid"].includes(currentOrder.status)) throw new Error("ORDER_NOT_PENDING");
    if (currentOrder.status === "paid" && currentOrder.paymentKey !== order.paymentKey) throw new Error("PAYMENT_KEY_MISMATCH");
    const duplicate = [...state.orders.values()].find(candidate => candidate.id !== order.id && candidate.paymentKey && candidate.paymentKey === order.paymentKey);
    if (duplicate) throw new Error("SQLITE_CONSTRAINT_UNIQUE:payment_key_unique");
    const reading = state.readings.get(order.readingId);
    const entitlement = state.entitlements.get(order.readingId);
    if (!reading || !entitlement) throw new Error("PAID_PURCHASE_RECORD_MISSING");
    state.orders.set(order.id, structuredClone({ ...currentOrder, ...order, purchasePromiseSnapshot: currentOrder.purchasePromiseSnapshot, status: "paid", updatedAt: paidAt }));
    if (order.product === "full_reading") {
      entitlement.fullReadingPurchased = true;
      entitlement.baseQuestionAllowance = 2;
    } else {
      entitlement.extraPackPurchased = true;
      entitlement.extraQuestionAllowance = 2;
    }
    entitlement.updatedAt = paidAt;
    reading.paidAt ??= paidAt;
    if (order.product === "full_reading") reading.fullReadingOrderId ??= order.id;
    reading.expiresAt = new Date(Math.max(Date.parse(reading.expiresAt), Date.parse(paidAt) + lifetimeMs)).toISOString();
    if (enqueueDelivery && order.product === "full_reading" && reading.detailGenerationStatus !== "ready") {
      reading.status = "paid_generating";
      reading.detailGenerationStatus = "generating";
      reading.detailGenerationError = null;
    }
    reading.updatedAt = paidAt;
    state.entitlements.set(order.readingId, structuredClone(entitlement));
    state.readings.set(order.readingId, structuredClone(reading));
    return structuredClone(reading);
  }

  async findPendingOrder(readingId: string, sessionHash: string, product: OrderProduct) {
    const order = [...memoryState().orders.values()].find(
      (candidate) =>
        candidate.readingId === readingId &&
        candidate.sessionHash === sessionHash &&
        candidate.product === product &&
        candidate.status === "pending"
    );
    return order ? structuredClone(order) : null;
  }

  async recordEvent(event: StoredAnalyticsEvent) {
    const state = memoryState();
    state.events.push({ ...structuredClone(event), context: sanitizedAnalyticsContext(event.context) });
    if (state.events.length > 5_000) state.events.splice(0, state.events.length - 5_000);
  }
}

class SupabaseRepository implements DreamRepository {
  constructor(private readonly client: SupabaseClient) {}

  async mutateConversationGuard(key: string, command: ConversationGuardCommand, expiresAt: number) {
    // Compare-and-swap keeps counters and the generation lease shared across workers.
    // Missing migration or repeated contention fails closed; never fall back to memory.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { data, error } = await this.client.from("dream_conversation_guards")
        .select("state, version, expires_at").eq("key", key).maybeSingle();
      if (error) throw new Error(`CONVERSATION_GUARD_READ_FAILED:${error.code}`);
      const now = Date.now();
      const previous = data && Number(data.expires_at) > now ? data.state as ConversationGuardState : null;
      const updated = transitionConversationGuard(previous, command, now);
      const write = await this.client.rpc("compare_and_swap_conversation_guard", {
        p_key: key, p_version: data?.version ?? 0, p_state: updated.state, p_expires_at: expiresAt
      });
      if (write.error) throw new Error(`CONVERSATION_GUARD_WRITE_FAILED:${write.error.code}`);
      if (write.data === true) return updated.result;
    }
    throw new Error("CONVERSATION_GUARD_BUSY");
  }

  async checkHealth() {
    const { error } = await this.client.from("dream_readings").select("id", { head: true, count: "exact" }).limit(1);
    if (error) throw new Error(`READING_STORE_HEALTH_FAILED:${error.code}`);
  }

  async getReading(id: string) {
    const { data, error } = await this.client
      .from("dream_readings")
      .select("record, expires_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`READING_STORE_READ_FAILED:${error.code}`);
    if (!data) return null;
    if (new Date(data.expires_at).getTime() <= Date.now()) {
      await this.deleteReading(id);
      return null;
    }
    if (isCurrentReadingRecord(data.record)) return data.record;
    const migrated = migrateLegacyReading(data.record);
    if (!migrated) return data.record as ReadingRecord;
    await this.saveReading(migrated.reading);
    await this.saveEntitlement(migrated.entitlement);
    for (const turn of migrated.turns) await this.saveConversationTurn(turn);
    return migrated.reading;
  }

  async saveReading(reading: ReadingRecord) {
    const { error } = await this.client.from("dream_readings").upsert({
      id: reading.id,
      session_hash: reading.sessionHash,
      owner_user_id: reading.ownerUserId,
      status: reading.status,
      record: reading,
      expires_at: reading.expiresAt,
      paid_at: reading.paidAt,
      updated_at: reading.updatedAt
    });
    if (error) throw new Error(`READING_STORE_WRITE_FAILED:${error.code}`);
  }

  async deleteReading(id: string) {
    const { error } = await this.client.from("dream_readings").delete().eq("id", id);
    if (error) throw new Error(`READING_STORE_DELETE_FAILED:${error.code}`);
    const deleted = await this.client.from("dream_conversation_guards").delete().eq("key", `reading:${id}`);
    if (deleted.error) throw new Error(`CONVERSATION_GUARD_DELETE_FAILED:${deleted.error.code}`);
  }

  async getConversationTurns(readingId: string) {
    const { data, error } = await this.client
      .from("dream_messages")
      .select("id, reading_id, role, kind, status, client_message_id, encrypted_content, created_at")
      .eq("reading_id", readingId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`MESSAGE_STORE_READ_FAILED:${error.code}`);
    return (data ?? []).map((row) => ({
      id: row.id,
      readingId: row.reading_id,
      role: row.role,
      kind: row.kind,
      status: row.status,
      clientMessageId: row.client_message_id,
      encryptedContent: row.encrypted_content,
      createdAt: row.created_at
    })) as ConversationTurn[];
  }

  async saveConversationTurn(turn: ConversationTurn) {
    const { error } = await this.client.from("dream_messages").upsert({
      id: turn.id,
      reading_id: turn.readingId,
      role: turn.role,
      kind: turn.kind,
      status: turn.status,
      client_message_id: turn.clientMessageId,
      encrypted_content: turn.encryptedContent,
      created_at: turn.createdAt
    });
    if (error) throw new Error(`MESSAGE_STORE_WRITE_FAILED:${error.code}`);
  }

  async getEntitlement(readingId: string) {
    const { data, error } = await this.client
      .from("dream_entitlements")
      .select("*")
      .eq("reading_id", readingId)
      .maybeSingle();
    if (error) throw new Error(`ENTITLEMENT_STORE_READ_FAILED:${error.code}`);
    if (!data) return null;
    return {
      readingId: data.reading_id,
      fullReadingPurchased: data.full_reading_purchased,
      baseQuestionAllowance: data.base_question_allowance,
      extraQuestionAllowance: data.extra_question_allowance,
      usedQuestions: data.used_questions,
      extraPackPurchased: data.extra_pack_purchased,
      updatedAt: data.updated_at
    } as ReadingEntitlement;
  }

  async saveEntitlement(entitlement: ReadingEntitlement) {
    const { error } = await this.client.from("dream_entitlements").upsert({
      reading_id: entitlement.readingId,
      full_reading_purchased: entitlement.fullReadingPurchased,
      base_question_allowance: entitlement.baseQuestionAllowance,
      extra_question_allowance: entitlement.extraQuestionAllowance,
      used_questions: entitlement.usedQuestions,
      extra_pack_purchased: entitlement.extraPackPurchased,
      updated_at: entitlement.updatedAt
    });
    if (error) throw new Error(`ENTITLEMENT_STORE_WRITE_FAILED:${error.code}`);
  }

  async reserveQuestion(readingId: string, clientMessageId: string, charge = true, turn?: ConversationTurn, requestHash?: string): Promise<QuestionReservation> {
    if (turn) {
      const existingTurns = await this.getConversationTurns(readingId);
      const existing = existingTurns.find(item => item.clientMessageId === clientMessageId);
      if (existing && requestHash) {
        const { decryptJson } = await import("../crypto");
        const prior = decryptJson<{ text?: string }>(existing.encryptedContent, "turn", existing.id);
        if (prior.text !== decryptJson<{ text?: string }>(turn.encryptedContent, "turn", turn.id).text) throw new Error("MESSAGE_CLIENT_ID_CONFLICT");
      }
    }
    const { data, error } = await this.client.rpc("reserve_dream_message_v2", {
      p_reading_id: readingId,
      p_client_message_id: clientMessageId,
      p_charge: charge
    });
    if (error) throw new Error(`QUESTION_RESERVATION_FAILED:${error.code}`);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("QUESTION_RESERVATION_FAILED:EMPTY_RESULT");
    if (turn && row.reservation_status === "reserved") await this.saveConversationTurn(turn);
    return { status: row.reservation_status, remainingQuestions: row.remaining_questions } as QuestionReservation;
  }

  async completeQuestionReservation(readingId: string, clientMessageId: string) {
    const { error } = await this.client
      .from("dream_message_reservations")
      .update({ status: "complete", updated_at: new Date().toISOString() })
      .eq("reading_id", readingId)
      .eq("client_message_id", clientMessageId)
      .eq("status", "reserved");
    if (error) throw new Error(`QUESTION_RESERVATION_COMPLETE_FAILED:${error.code}`);
  }

  async heartbeatQuestionReservation(readingId: string, clientMessageId: string) {
    const now = new Date().toISOString();
    const { data, error } = await this.client.from("dream_message_reservations")
      .update({ reserved_at: now, updated_at: now })
      .eq("reading_id", readingId).eq("client_message_id", clientMessageId).eq("status", "reserved")
      .select("client_message_id");
    if (error) throw new Error(`QUESTION_RESERVATION_HEARTBEAT_FAILED:${error.code}`);
    return data?.length === 1;
  }

  async completeQuestionWithTurns(readingId: string, clientMessageId: string, userTurn: ConversationTurn, assistantTurn: ConversationTurn, encryptedContext?: ReadingRecord["encryptedContext"]) {
    await this.saveConversationTurn(userTurn);
    await this.saveConversationTurn(assistantTurn);
    if (encryptedContext) {
      const reading = await this.getReading(readingId);
      if (reading) {
        reading.encryptedContext = encryptedContext;
        reading.updatedAt = new Date().toISOString();
        await this.saveReading(reading);
      }
    }
    await this.completeQuestionReservation(readingId, clientMessageId);
  }

  async releaseQuestionReservation(readingId: string, clientMessageId: string, userTurn?: ConversationTurn) {
    if (userTurn) await this.saveConversationTurn(userTurn);
    const { error } = await this.client.rpc("release_dream_followup", {
      p_reading_id: readingId,
      p_client_message_id: clientMessageId
    });
    if (error) throw new Error(`QUESTION_RESERVATION_RELEASE_FAILED:${error.code}`);
  }

  async recoverStaleQuestionReservations() { return 0; }

  async getOrder(id: string) {
    const { data, error } = await this.client.from("dream_orders").select("record").eq("id", id).maybeSingle();
    if (error) throw new Error(`ORDER_STORE_READ_FAILED:${error.code}`);
    return data ? (data.record as OrderRecord) : null;
  }

  async saveOrder(order: OrderRecord) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.getOrder(order.id);
      if (current && current.status !== "pending") return;
      const persistedOrder = current
        ? { ...order, purchasePromiseSnapshot: current.purchasePromiseSnapshot }
        : order;
      if (!current) {
        const { error } = await this.client.from("dream_orders").upsert({
          id: persistedOrder.id,
          reading_id: persistedOrder.readingId,
          session_hash: persistedOrder.sessionHash,
          product: persistedOrder.product,
          amount: persistedOrder.amount,
          status: persistedOrder.status,
          payment_key: persistedOrder.paymentKey,
          record: persistedOrder,
          updated_at: persistedOrder.updatedAt
        });
        if (error) throw new Error(`ORDER_STORE_WRITE_FAILED:${error.code}`);
        return;
      }
      let query = this.client.from("dream_orders").update({
        reading_id: persistedOrder.readingId,
        session_hash: persistedOrder.sessionHash,
        product: persistedOrder.product,
        amount: persistedOrder.amount,
        status: persistedOrder.status,
        payment_key: persistedOrder.paymentKey,
        record: persistedOrder,
        updated_at: persistedOrder.updatedAt
      }).eq("id", order.id).eq("status", current.status);
      query = current.purchasePromiseSnapshot
        ? query.eq("record->purchasePromiseSnapshot->>promiseSha256", current.purchasePromiseSnapshot.promiseSha256)
          .eq("record->purchasePromiseSnapshot->>capturedAt", current.purchasePromiseSnapshot.capturedAt)
          .eq("record->purchasePromiseSnapshot->>captureMode", current.purchasePromiseSnapshot.captureMode)
        : query.is("record->purchasePromiseSnapshot", null);
      const { data, error } = await query.select("id").maybeSingle();
      if (error) throw new Error(`ORDER_STORE_WRITE_FAILED:${error.code}`);
      if (data) return;
    }
    throw new Error("ORDER_STORE_WRITE_CONFLICT");
  }

  async setPurchasePromiseSnapshotIfMissing(orderId: string, snapshot: NonNullable<OrderRecord["purchasePromiseSnapshot"]>) {
    const current = await this.getOrder(orderId);
    if (!current || current.status !== "pending") throw new Error("ORDER_NOT_PENDING");
    if (current.purchasePromiseSnapshot) return current;
    const updated = { ...current, purchasePromiseSnapshot: snapshot };
    const { data, error } = await this.client.from("dream_orders")
      .update({ record: updated })
      .eq("id", orderId)
      .eq("status", "pending")
      .is("record->purchasePromiseSnapshot", null)
      .select("record")
      .maybeSingle();
    if (error) throw new Error(`ORDER_PROMISE_SNAPSHOT_WRITE_FAILED:${error.code}`);
    if (data?.record) return data.record as OrderRecord;
    const latest = await this.getOrder(orderId);
    if (!latest) throw new Error("ORDER_NOT_FOUND");
    return latest;
  }

  async createPendingOrder(order: OrderRecord, reading: ReadingRecord) {
    const existing = await this.findPendingOrder(reading.id, order.sessionHash, order.product);
    if (existing) {
      if (!existing.purchasePromiseSnapshot && order.purchasePromiseSnapshot) {
        return this.setPurchasePromiseSnapshotIfMissing(existing.id, order.purchasePromiseSnapshot);
      }
      return existing;
    }
    if (order.product === "full_reading") {
      reading.status = "payment_pending";
      reading.updatedAt = order.updatedAt;
      await this.saveReading(reading);
    }
    await this.saveOrder(order);
    return order;
  }

  async recordPaymentVerificationKey(orderId: string, sessionHash: string, paymentKey: string) {
    const order = await this.getOrder(orderId);
    if (!order || order.sessionHash !== sessionHash || order.status !== "pending") throw new Error("ORDER_NOT_PENDING");
    if (order.verificationPaymentKey && order.verificationPaymentKey !== paymentKey) throw new Error("PAYMENT_KEY_MISMATCH");
    order.verificationPaymentKey = paymentKey;
    order.updatedAt = new Date().toISOString();
    await this.saveOrder(order);
  }

  async commitVerifiedPayment(order: OrderRecord, paidAt: string, lifetimeMs: number, enqueueDelivery: boolean) {
    const currentOrder = await this.getOrder(order.id);
    if (!currentOrder || !["pending", "paid"].includes(currentOrder.status)) throw new Error("ORDER_NOT_PENDING");
    if (currentOrder.status === "paid" && currentOrder.paymentKey !== order.paymentKey) throw new Error("PAYMENT_KEY_MISMATCH");
    const reading = await this.getReading(order.readingId);
    const entitlement = await this.getEntitlement(order.readingId);
    if (!reading || !entitlement) throw new Error("PAID_PURCHASE_RECORD_MISSING");
    await this.saveOrder({ ...currentOrder, ...order, status: "paid", updatedAt: paidAt });
    if (order.product === "full_reading") {
      entitlement.fullReadingPurchased = true;
      entitlement.baseQuestionAllowance = 2;
    } else {
      entitlement.extraPackPurchased = true;
      entitlement.extraQuestionAllowance = 2;
    }
    entitlement.updatedAt = paidAt;
    reading.paidAt ??= paidAt;
    if (order.product === "full_reading") reading.fullReadingOrderId ??= order.id;
    reading.expiresAt = new Date(Math.max(Date.parse(reading.expiresAt), Date.parse(paidAt) + lifetimeMs)).toISOString();
    if (enqueueDelivery && order.product === "full_reading" && reading.detailGenerationStatus !== "ready") {
      reading.status = "paid_generating";
      reading.detailGenerationStatus = "generating";
      reading.detailGenerationError = null;
    }
    reading.updatedAt = paidAt;
    await this.saveEntitlement(entitlement);
    await this.saveReading(reading);
    return reading;
  }

  async findPendingOrder(readingId: string, sessionHash: string, product: OrderProduct) {
    const { data, error } = await this.client
      .from("dream_orders")
      .select("record")
      .eq("reading_id", readingId)
      .eq("session_hash", sessionHash)
      .eq("product", product)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`ORDER_STORE_READ_FAILED:${error.code}`);
    return data ? (data.record as OrderRecord) : null;
  }

  async recordEvent(event: StoredAnalyticsEvent) {
    const { error } = await this.client.from("dream_analytics_events").insert({
      event_name: event.event,
      reading_id: event.readingId,
      context: sanitizedAnalyticsContext(event.context),
      occurred_at: event.occurredAt
    });
    if (error) throw new Error(`EVENT_STORE_WRITE_FAILED:${error.code}`);
  }
}

let repository: DreamRepository | null = null;

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "kkumgyeol-server" } }
  });
}

export function getRepository(): DreamRepository {
  if (repository) return repository;
  const requested = process.env.DREAM_REPOSITORY?.trim().toLowerCase();
  const allowEphemeralMemory = ephemeralMemoryAllowed();
  if (requested && !["sqlite", "supabase", "memory"].includes(requested)) {
    throw new Error("DREAM_REPOSITORY must be one of: sqlite, supabase, memory.");
  }

  const client = supabaseAdmin();
  if (requested === "supabase") {
    if (!client) throw new Error("Supabase persistence requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    repository = new SupabaseRepository(client);
    return repository;
  }

  if (requested === "memory") {
    if (process.env.NODE_ENV === "production" && !allowEphemeralMemory) {
      throw new Error("Memory persistence is disabled in production.");
    }
    repository = new MemoryRepository();
    return repository;
  }

  const databasePath = process.env.DREAM_DATABASE_PATH?.trim();
  if (requested === "sqlite" || databasePath) {
    const sqlite = new SQLiteRepository(databasePath || ".data/kkumgyeol.sqlite3");
    repository = sqlite;
    return sqlite;
  }

  if (client) {
    repository = new SupabaseRepository(client);
    return repository;
  }

  if (process.env.NODE_ENV === "production") {
    if (allowEphemeralMemory) {
      repository = new MemoryRepository();
      return repository;
    }
    throw new Error("Persistent dream storage is required in production. Configure Supabase.");
  }

  const sqlite = new SQLiteRepository(".data/kkumgyeol.sqlite3");
  repository = sqlite;
  return sqlite;
}

export function setRepositoryForTests(next: DreamRepository | null) {
  repository = next;
}

export function resetMemoryRepository() {
  if (repository instanceof SQLiteRepository) repository.close();
  globalThis.__kkumgyeolMemoryState = undefined;
  repository = null;
}

export function readMemoryEventsForTests() {
  return structuredClone(memoryState().events);
}
