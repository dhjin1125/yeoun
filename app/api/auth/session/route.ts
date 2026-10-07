import { reviewPurchaseLoginRequired } from "@/lib/app-profile";
import { noStoreJson } from "@/lib/http";
import { readReviewSession, reviewAuthConfigured } from "@/lib/auth/reviewer";

export const runtime = "nodejs";

export async function GET() {
  if (!reviewPurchaseLoginRequired()) {
    return noStoreJson({ configured: false, signedIn: false, account: null });
  }
  const session = await readReviewSession();
  return noStoreJson({
    configured: reviewAuthConfigured(),
    signedIn: Boolean(session),
    account: session ? { label: session.label } : null
  });
}
