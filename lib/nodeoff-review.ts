export function nodeOffReviewSiteEnabled() {
  return process.env.NODEOFF_REVIEW_SITE === "true";
}

const NODEOFF_REVIEW_UI_ENABLED = process.env.NEXT_PUBLIC_NODEOFF_REVIEW_SITE === "true";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRestoreUrl(value: string) {
  if (typeof window === "undefined") return value;
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return value;
    return `${window.location.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return value;
  }
}

export function normalizeNodeOffReviewPayload<T>(value: T): T {
  if (!NODEOFF_REVIEW_UI_ENABLED || typeof window === "undefined") return value;

  function visit(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(visit);
    if (!isRecord(input)) return input;

    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(input)) {
      result[key] = key === "restoreUrl" && typeof nested === "string" ? normalizeRestoreUrl(nested) : visit(nested);
    }

    if (typeof result.canPurchaseFullReading === "boolean") {
      result.canPurchaseFullReading = false;
      result.checkoutMode = "unavailable";
    }
    if (isRecord(result.entitlement) && typeof result.entitlement.canPurchaseExtraPack === "boolean") {
      result.entitlement = { ...result.entitlement, canPurchaseExtraPack: false };
    }
    return result;
  }

  return visit(value) as T;
}
