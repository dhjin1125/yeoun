import { stagedFreeReadingV3PayloadSchema } from "./ai/schemas";
import {
  type AssistantTurnPayload,
  type ConversationTurn,
  type OrderRecord,
  type PurchasePromiseSnapshot,
  type StagedFreeReadingV3Payload,
} from "./types";
import { isPurchasePromiseSnapshotValid, sourceFreePayloadSha256 } from "./purchase-promise";

export type ResolvedPaidGenerationContract =
  | { kind: "legacy-v2" }
  | { kind: "snapshot-v1-v2"; snapshot: Extract<PurchasePromiseSnapshot, { promiseVersion: "paid-offer-v1" }>; sourceFreePayload: AssistantTurnPayload | StagedFreeReadingV3Payload }
  | { kind: "staged-v3"; snapshot: Extract<PurchasePromiseSnapshot, { promiseVersion: "paid-offer-v2" }>; sourceFreePayload: StagedFreeReadingV3Payload };

function isFreeV2(value: unknown): value is AssistantTurnPayload {
  return Boolean(value && typeof value === "object" &&
    typeof (value as { directAnswer?: unknown }).directAnswer === "string" &&
    (value as { directAnswer: string }).directAnswer.trim());
}

function parseFreePayload(value: unknown): AssistantTurnPayload | StagedFreeReadingV3Payload {
  const staged = stagedFreeReadingV3PayloadSchema.safeParse(value);
  if (staged.success) return staged.data as StagedFreeReadingV3Payload;
  if (isFreeV2(value)) return value;
  throw new Error("SOURCE_FREE_PAYLOAD_INVALID");
}

/**
 * Resolves an order's immutable paid-generation contract against its exact persisted free turn.
 * Orders without a snapshot intentionally retain the pre-snapshot latest-free behavior.
 */
export function resolvePaidGenerationContract(input: {
  readingId: string;
  orderId?: string;
  order?: OrderRecord | null;
  sourceTurn?: ConversationTurn | null;
  sourcePayload?: unknown;
}): ResolvedPaidGenerationContract {
  if (!input.orderId) return { kind: "legacy-v2" };
  const order = input.order;
  if (!order) throw new Error("PAID_ORDER_NOT_FOUND");
  if (order.id !== input.orderId || order.readingId !== input.readingId) throw new Error("PAID_ORDER_READING_MISMATCH");
  if (order.product !== "full_reading" || order.status !== "paid") throw new Error("PAID_ORDER_NOT_CONFIRMED");
  const snapshot = order.purchasePromiseSnapshot;
  if (!snapshot) return { kind: "legacy-v2" };
  if (snapshot.sourceReadingId !== input.readingId) throw new Error("PURCHASE_PROMISE_READING_MISMATCH");
  if (!input.sourceTurn || snapshot.sourceFreeTurnId !== input.sourceTurn.id) throw new Error("SOURCE_FREE_TURN_MISSING");
  const sourceTurn = input.sourceTurn;
  if (!sourceTurn || sourceTurn.readingId !== input.readingId || sourceTurn.kind !== "free" ||
    sourceTurn.role !== "kkumgyeol" || sourceTurn.status !== "complete") {
    throw new Error("SOURCE_FREE_TURN_MISSING");
  }
  if (!isPurchasePromiseSnapshotValid(snapshot)) throw new Error("PURCHASE_PROMISE_HASH_MISMATCH");

  const payload = parseFreePayload(input.sourcePayload);
  const digest = sourceFreePayloadSha256(payload);
  const actualVersion = "freeCompositionVersion" in payload ? payload.freeCompositionVersion ?? null : null;

  if (snapshot.promiseVersion === "paid-offer-v2") {
    if (!snapshot.sourceFreePayloadSha256) throw new Error("SOURCE_FREE_PAYLOAD_HASH_MISSING");
    if (actualVersion !== 3 || !stagedFreeReadingV3PayloadSchema.safeParse(payload).success) {
      throw new Error("PAID_OFFER_V2_REQUIRES_FREE_V3");
    }
    if (snapshot.sourceFreeCompositionVersion !== actualVersion) throw new Error("SOURCE_FREE_COMPOSITION_MISMATCH");
    if (snapshot.sourceFreePayloadSha256 !== digest) throw new Error("SOURCE_FREE_PAYLOAD_MISMATCH");
    return { kind: "staged-v3", snapshot, sourceFreePayload: payload as StagedFreeReadingV3Payload };
  }
  if (snapshot.sourceFreePayloadSha256 && snapshot.sourceFreePayloadSha256 !== digest) {
    throw new Error("SOURCE_FREE_PAYLOAD_MISMATCH");
  }
  if (actualVersion === 3 || stagedFreeReadingV3PayloadSchema.safeParse(payload).success) {
    throw new Error("PAID_OFFER_V1_REQUIRES_FREE_V2");
  }
  if (snapshot.sourceFreeCompositionVersion !== null && actualVersion !== snapshot.sourceFreeCompositionVersion) {
    throw new Error("SOURCE_FREE_COMPOSITION_MISMATCH");
  }
  return { kind: "snapshot-v1-v2", snapshot, sourceFreePayload: payload };
}
