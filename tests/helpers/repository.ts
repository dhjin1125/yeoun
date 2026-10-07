import type { DreamRepository, StoredAnalyticsEvent } from "@/lib/repository";
import { mutateMemoryConversationGuard, type ConversationGuardCommand, type StoredConversationGuard } from "@/lib/conversation-guard";
import type {
  ConversationTurn,
  OrderProduct,
  OrderRecord,
  QuestionReservation,
  ReadingEntitlement,
  ReadingRecord
} from "@/lib/types";

type Reservation = {
  readingId: string;
  clientMessageId: string;
  status: "reserved" | "complete" | "released";
  charged?: boolean;
  requestHash?: string;
  reservedAt?: number;
};

function reservationKey(readingId: string, clientMessageId: string) {
  return `${readingId}:${clientMessageId}`;
}

function allowance(entitlement: ReadingEntitlement) {
  return entitlement.baseQuestionAllowance + entitlement.extraQuestionAllowance;
}

export class TestRepository implements DreamRepository {
  readonly conversationGuards = new Map<string, StoredConversationGuard>();
  readonly readings = new Map<string, ReadingRecord>();
  readonly turns = new Map<string, ConversationTurn>();
  readonly entitlements = new Map<string, ReadingEntitlement>();
  readonly reservations = new Map<string, Reservation>();
  readonly orders = new Map<string, OrderRecord>();
  readonly events: StoredAnalyticsEvent[] = [];

  async checkHealth() {}

  async mutateConversationGuard(key: string, command: ConversationGuardCommand, expiresAt: number) {
    return mutateMemoryConversationGuard(this.conversationGuards, key, command, expiresAt);
  }

  async getReading(id: string) {
    const reading = this.readings.get(id);
    return reading ? structuredClone(reading) : null;
  }

  async saveReading(reading: ReadingRecord) {
    this.readings.set(reading.id, structuredClone(reading));
  }

  async deleteReading(id: string) {
    this.conversationGuards.delete(`reading:${id}`);
    this.readings.delete(id);
    this.entitlements.delete(id);
    for (const [turnId, turn] of this.turns) {
      if (turn.readingId === id) this.turns.delete(turnId);
    }
    for (const [key, reservation] of this.reservations) {
      if (reservation.readingId === id) this.reservations.delete(key);
    }
    for (const [orderId, order] of this.orders) {
      if (order.readingId === id) this.orders.delete(orderId);
    }
    for (const event of this.events) {
      if (event.readingId === id) event.readingId = null;
    }
  }

  async getConversationTurns(readingId: string) {
    return [...this.turns.values()]
      .filter((turn) => turn.readingId === readingId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((turn) => structuredClone(turn));
  }

  async saveConversationTurn(turn: ConversationTurn) {
    this.turns.set(turn.id, structuredClone(turn));
  }

  async getEntitlement(readingId: string) {
    const entitlement = this.entitlements.get(readingId);
    return entitlement ? structuredClone(entitlement) : null;
  }

  async saveEntitlement(entitlement: ReadingEntitlement) {
    this.entitlements.set(entitlement.readingId, structuredClone(entitlement));
  }

  async reserveQuestion(readingId: string, clientMessageId: string, charge = true, turn?: ConversationTurn, requestHash?: string): Promise<QuestionReservation> {
    const key = reservationKey(readingId, clientMessageId);
    const existing = this.reservations.get(key);
    const entitlement = this.entitlements.get(readingId);
    if (existing?.requestHash && requestHash && existing.requestHash !== requestHash) throw new Error("MESSAGE_CLIENT_ID_CONFLICT");
    const remaining = entitlement ? Math.max(0, allowance(entitlement) - entitlement.usedQuestions) : 0;
    if (existing?.status === "complete") return { status: "duplicate_complete", remainingQuestions: remaining };
    if (existing?.status === "reserved") return { status: "duplicate_pending", remainingQuestions: remaining };
    if (!entitlement?.fullReadingPurchased) return { status: "not_entitled", remainingQuestions: 0 };
    if ([...this.reservations.values()].some(item=>item.readingId===readingId && item.status === "reserved")) return {status:"duplicate_pending",remainingQuestions:remaining};
    if (charge && remaining === 0) return { status: "credits_exhausted", remainingQuestions: 0 };

    entitlement.usedQuestions += charge ? 1 : 0;
    entitlement.updatedAt = new Date().toISOString();
    this.entitlements.set(readingId, structuredClone(entitlement));
    this.reservations.set(key, { readingId, clientMessageId, status: "reserved", charged: charge, requestHash, reservedAt: Date.now() });
    if (turn) this.turns.set(turn.id, structuredClone(turn));
    return { status: "reserved", remainingQuestions: remaining - (charge ? 1 : 0) };
  }

  async completeQuestionReservation(readingId: string, clientMessageId: string) {
    const reservation = this.reservations.get(reservationKey(readingId, clientMessageId));
    if (!reservation || reservation.status !== "reserved") throw new Error("QUESTION_RESERVATION_NOT_FOUND");
    reservation.status = "complete";
  }

  async heartbeatQuestionReservation(readingId: string, clientMessageId: string) {
    const reservation = this.reservations.get(reservationKey(readingId, clientMessageId));
    if (!reservation || reservation.status !== "reserved") return false;
    reservation.reservedAt = Date.now();
    return true;
  }

  async completeQuestionWithTurns(readingId: string, clientMessageId: string, userTurn: ConversationTurn, assistantTurn: ConversationTurn, encryptedContext?: ReadingRecord["encryptedContext"]) {
    const reservation = this.reservations.get(reservationKey(readingId, clientMessageId));
    if (reservation?.status === "complete" && this.turns.has(assistantTurn.id)) return;
    if (!reservation || reservation.status !== "reserved") throw new Error("QUESTION_RESERVATION_NOT_FOUND");
    const current = this.readings.get(readingId);
    if (!current) throw new Error("READING_NOT_FOUND");
    this.turns.set(userTurn.id, structuredClone(userTurn));
    this.turns.set(assistantTurn.id, structuredClone(assistantTurn));
    if (encryptedContext) { current.encryptedContext = structuredClone(encryptedContext); current.updatedAt = new Date().toISOString(); }
    reservation.status = "complete";
  }

  async releaseQuestionReservation(readingId: string, clientMessageId: string, userTurn?: ConversationTurn) {
    const reservation = this.reservations.get(reservationKey(readingId, clientMessageId));
    if (!reservation || reservation.status !== "reserved") return;
    const entitlement = this.entitlements.get(readingId);
    if (entitlement && reservation.charged !== false) {
      entitlement.usedQuestions = Math.max(0, entitlement.usedQuestions - 1);
      entitlement.updatedAt = new Date().toISOString();
      this.entitlements.set(readingId, structuredClone(entitlement));
    }
    reservation.status = "released";
    if (userTurn) this.turns.set(userTurn.id, structuredClone(userTurn));
  }

  async recoverStaleQuestionReservations() {
    const cutoff = Date.now() - 30 * 60 * 1000;
    let count = 0;
    for (const reservation of this.reservations.values()) {
      if (reservation.status !== "reserved" || (reservation.reservedAt ?? Date.now()) >= cutoff) continue;
      const entitlement = this.entitlements.get(reservation.readingId);
      if (entitlement && reservation.charged !== false) entitlement.usedQuestions = Math.max(0, entitlement.usedQuestions - 1);
      reservation.status = "released";
      for (const turn of this.turns.values()) if (turn.readingId === reservation.readingId && turn.clientMessageId === reservation.clientMessageId && turn.status === "pending") turn.status = "failed";
      count++;
    }
    return count;
  }

  async getOrder(id: string) {
    const order = this.orders.get(id);
    return order ? structuredClone(order) : null;
  }

  async saveOrder(order: OrderRecord) {
    if (order.paymentKey) {
      const duplicate = [...this.orders.values()].find(
        (candidate) => candidate.paymentKey === order.paymentKey && candidate.id !== order.id
      );
      if (duplicate) throw new Error("ORDER_STORE_WRITE_FAILED:SQLITE_CONSTRAINT_UNIQUE:payment_key_unique");
    }
    const current = this.orders.get(order.id);
    if (current && current.status !== "pending") return;
    this.orders.set(order.id, structuredClone(current
      ? { ...order, purchasePromiseSnapshot: current.purchasePromiseSnapshot }
      : order));
  }

  async setPurchasePromiseSnapshotIfMissing(orderId: string, snapshot: NonNullable<OrderRecord["purchasePromiseSnapshot"]>) {
    const current = this.orders.get(orderId);
    if (!current || current.status !== "pending") throw new Error("ORDER_NOT_PENDING");
    if (!current.purchasePromiseSnapshot) current.purchasePromiseSnapshot = structuredClone(snapshot);
    this.orders.set(orderId, structuredClone(current));
    return structuredClone(current);
  }

  async createPendingOrder(order: OrderRecord, reading: ReadingRecord) {
    const existing = [...this.orders.values()].find(candidate => candidate.readingId === reading.id && candidate.sessionHash === order.sessionHash && candidate.product === order.product && candidate.status === "pending");
    if (existing) {
      if (!existing.purchasePromiseSnapshot && order.purchasePromiseSnapshot) {
        return this.setPurchasePromiseSnapshotIfMissing(existing.id, order.purchasePromiseSnapshot);
      }
      return structuredClone(existing);
    }
    const current = this.readings.get(reading.id);
    if (!current) throw new Error("READING_NOT_FOUND");
    if (order.product === "full_reading") { current.status = "payment_pending"; current.updatedAt = order.updatedAt; }
    this.readings.set(reading.id, structuredClone(current));
    this.orders.set(order.id, structuredClone(order));
    return structuredClone(order);
  }

  async recordPaymentVerificationKey(orderId: string, sessionHash: string, paymentKey: string) {
    const order = this.orders.get(orderId);
    if (!order || order.sessionHash !== sessionHash || order.status !== "pending") throw new Error("ORDER_NOT_PENDING");
    if (order.verificationPaymentKey && order.verificationPaymentKey !== paymentKey) throw new Error("PAYMENT_KEY_MISMATCH");
    order.verificationPaymentKey = paymentKey;
  }

  async commitVerifiedPayment(order: OrderRecord, paidAt: string, lifetimeMs: number, enqueueDelivery: boolean) {
    const currentOrder = this.orders.get(order.id), reading = this.readings.get(order.readingId), entitlement = this.entitlements.get(order.readingId);
    if (!currentOrder || !["pending", "paid"].includes(currentOrder.status)) throw new Error("ORDER_NOT_PENDING");
    if (!reading || !entitlement) throw new Error("PAID_PURCHASE_RECORD_MISSING");
    if (currentOrder.status === "paid" && currentOrder.paymentKey !== order.paymentKey) throw new Error("PAYMENT_KEY_MISMATCH");
    const duplicate = [...this.orders.values()].find(candidate => candidate.id !== order.id && candidate.paymentKey && candidate.paymentKey === order.paymentKey);
    if (duplicate) throw new Error("SQLITE_CONSTRAINT_UNIQUE:payment_key_unique");
    this.orders.set(order.id, structuredClone({ ...currentOrder, ...order, purchasePromiseSnapshot: currentOrder.purchasePromiseSnapshot, status: "paid", updatedAt: currentOrder.status === "paid" ? currentOrder.updatedAt : paidAt }));
    if (order.product === "full_reading") { entitlement.fullReadingPurchased = true; entitlement.baseQuestionAllowance = 2; }
    else { entitlement.extraPackPurchased = true; entitlement.extraQuestionAllowance = 2; }
    entitlement.updatedAt = paidAt;
    reading.paidAt ??= paidAt;
    if (order.product === "full_reading") reading.fullReadingOrderId ??= order.id;
    reading.expiresAt = new Date(Math.max(Date.parse(reading.expiresAt), Date.parse(paidAt) + lifetimeMs)).toISOString();
    if (enqueueDelivery && order.product === "full_reading" && reading.detailGenerationStatus !== "ready") { reading.status = "paid_generating"; reading.detailGenerationStatus = "generating"; reading.detailGenerationError = null; }
    reading.updatedAt = paidAt;
    this.entitlements.set(order.readingId, structuredClone(entitlement));
    this.readings.set(order.readingId, structuredClone(reading));
    return structuredClone(reading);
  }

  async findPendingOrder(readingId: string, sessionHash: string, product: OrderProduct) {
    const order = [...this.orders.values()].find(
      (candidate) =>
        candidate.readingId === readingId &&
        candidate.sessionHash === sessionHash &&
        candidate.product === product &&
        candidate.status === "pending"
    );
    return order ? structuredClone(order) : null;
  }

  async recordEvent(event: StoredAnalyticsEvent) {
    this.events.push(structuredClone(event));
  }
}

export const DETAILED_DREAM =
  "검은 뱀이 우리 집 창문으로 천천히 들어왔어요. 처음에는 무서웠지만 도망치지 않고 가만히 바라보다가 문을 열어 밖으로 내보냈고, 마지막에는 이상하게 마음이 편안해졌어요.";
