import "server-only";

import { createHash } from "node:crypto";
import {
  PURCHASE_PROMISE_VERSION,
  PURCHASE_PROMISE_V2_VERSION,
  type PaidOfferV1Snapshot,
  type PaidOfferV2Snapshot,
  type PaidCompositionPromiseV2,
  type PaidOffer,
  type PurchasePromiseSnapshot
} from "./types";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

export function sourceFreePayloadSha256(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

export function purchasePromiseSha256(snapshot: PurchasePromiseSnapshot): string {
  const hashInput = {
    promiseVersion: snapshot.promiseVersion,
    sourceReadingId: snapshot.sourceReadingId,
    sourceFreeTurnId: snapshot.sourceFreeTurnId,
    sourceFreeCompositionVersion: snapshot.sourceFreeCompositionVersion,
    ...(snapshot.promiseVersion === PURCHASE_PROMISE_V2_VERSION
      ? { sourceFreePayloadSha256: snapshot.sourceFreePayloadSha256 }
      : {}),
    offer: snapshot.offer
  };
  return createHash("sha256").update(canonicalJson(hashInput), "utf8").digest("hex");
}

export function createPurchasePromiseSnapshot(input: {
  sourceReadingId: string;
  sourceFreeTurnId: string;
  sourceFreeCompositionVersion: 2 | 3 | null;
  sourceFreePayloadSha256?: string;
  offer: PaidOffer;
  captureMode: PurchasePromiseSnapshot["captureMode"];
  capturedAt?: string;
}): PaidOfferV1Snapshot {
  const promiseVersion = PURCHASE_PROMISE_VERSION;
  const hashInput = {
    promiseVersion,
    sourceReadingId: input.sourceReadingId,
    sourceFreeTurnId: input.sourceFreeTurnId,
    sourceFreeCompositionVersion: input.sourceFreeCompositionVersion,
    offer: input.offer
  };
  const promiseSha256 = createHash("sha256").update(canonicalJson(hashInput), "utf8").digest("hex");
  return {
    promiseVersion,
    promiseSha256,
    sourceReadingId: input.sourceReadingId,
    sourceFreeTurnId: input.sourceFreeTurnId,
    sourceFreeCompositionVersion: input.sourceFreeCompositionVersion,
    ...(input.sourceFreePayloadSha256 ? { sourceFreePayloadSha256: input.sourceFreePayloadSha256 } : {}),
    captureMode: input.captureMode,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    offer: structuredClone(input.offer)
  };
}

export function createPurchasePromiseSnapshotV2(input: {
  sourceReadingId: string;
  sourceFreeTurnId: string;
  sourceFreePayloadSha256: string;
  offer: PaidCompositionPromiseV2;
  captureMode: PaidOfferV2Snapshot["captureMode"];
  capturedAt?: string;
}): PaidOfferV2Snapshot {
  const snapshotWithoutHash = {
    promiseVersion: PURCHASE_PROMISE_V2_VERSION,
    sourceReadingId: input.sourceReadingId,
    sourceFreeTurnId: input.sourceFreeTurnId,
    sourceFreeCompositionVersion: 3 as const,
    sourceFreePayloadSha256: input.sourceFreePayloadSha256,
    captureMode: input.captureMode,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    offer: structuredClone(input.offer)
  };
  const promiseSha256 = purchasePromiseSha256({ ...snapshotWithoutHash, promiseSha256: "" });
  return { ...snapshotWithoutHash, promiseSha256 };
}

export function isPurchasePromiseSnapshotValid(snapshot: PurchasePromiseSnapshot) {
  return snapshot.promiseSha256 === purchasePromiseSha256(snapshot);
}

export function samePurchasePromiseIdentity(
  left: Pick<PurchasePromiseSnapshot, "promiseVersion" | "promiseSha256"> | null | undefined,
  right: Pick<PurchasePromiseSnapshot, "promiseVersion" | "promiseSha256"> | null | undefined
) {
  return Boolean(left && right && left.promiseVersion === right.promiseVersion && left.promiseSha256 === right.promiseSha256);
}
