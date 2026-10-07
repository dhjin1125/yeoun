import type { Metadata } from "next";
import { ReadingExperience } from "@/components/dream-experience";
import { JournalPageShell } from "@/components/journal-page-shell";
import { reviewPurchaseLoginRequired } from "@/lib/app-profile";
import { readReviewSession } from "@/lib/auth/reviewer";

export const metadata: Metadata = {
  title: "나의 꿈 해몽",
  robots: { index: false, follow: false, noarchive: true, nocache: true },
  referrer: "no-referrer"
};

export default async function ReadingPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string; checkout?: string; preview?: string }>;
}) {
  const { id } = await params;
  const { token = "", checkout, preview } = await searchParams;
  const purchaseLoginRequired = reviewPurchaseLoginRequired();
  const reviewSignedIn = purchaseLoginRequired && Boolean(await readReviewSession());
  return (
    <JournalPageShell>
      <ReadingExperience
        id={id}
        token={token}
        purchaseLoginRequired={purchaseLoginRequired}
        reviewSignedIn={reviewSignedIn}
        resumeCheckout={checkout === "full_reading"}
        previewKey={preview}
      />
    </JournalPageShell>
  );
}
