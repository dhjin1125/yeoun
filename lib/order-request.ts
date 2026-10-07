import type { OrderProduct, PurchasePromiseIdentity } from "./types";

export function buildOrderRequestPayload(input: {
  readingId: string;
  product: OrderProduct;
  restoreToken?: string;
  promise?: PurchasePromiseIdentity | null;
}) {
  if (input.product === "full_reading" && !input.promise) throw new Error("PURCHASE_PROMISE_REQUIRED");
  return {
    readingId: input.readingId,
    product: input.product,
    contentConsent: true as const,
    restoreToken: input.restoreToken,
    ...(input.product === "full_reading" && input.promise ? {
      promiseVersion: input.promise.promiseVersion,
      promiseSha256: input.promise.promiseSha256
    } : {})
  };
}
