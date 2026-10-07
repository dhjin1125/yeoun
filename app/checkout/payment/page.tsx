import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ReviewCheckoutWindow } from "@/components/review-checkout-window";
import { reviewPurchaseLoginRequired } from "@/lib/app-profile";
import { readReviewSession } from "@/lib/auth/reviewer";
import { businessInfo } from "@/lib/business-info";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "결제창 확인",
  robots: { index: false, follow: false, noarchive: true }
};

export default async function PaymentCheckoutPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  if (reviewPurchaseLoginRequired() && !(await readReviewSession())) {
    redirect("/login?next=/products");
  }
  const { product } = await searchParams;
  const productName = product === "followup_pack_2" ? "후속 질문 2회 추가" : "상세 해몽 + 질문 2회";
  const seller = businessInfo();
  return <ReviewCheckoutWindow productName={productName} businessName={seller.name} />;
}
