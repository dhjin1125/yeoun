import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLink } from "@/components/brand";
import { ReviewProductCatalog } from "@/components/review-product-catalog";
import { SiteFooter } from "@/components/site-footer";
import { reviewPurchaseLoginRequired } from "@/lib/app-profile";
import { readReviewSession } from "@/lib/auth/reviewer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "상품 선택",
  robots: { index: false, follow: false, noarchive: true }
};

export default async function ProductsPage() {
  const loginRequired = reviewPurchaseLoginRequired();
  const account = loginRequired ? await readReviewSession() : null;
  if (loginRequired && !account) redirect("/login?next=/products");

  return (
    <>
      <main id="main-content" className="review-products-page">
        <header className="review-page-header">
          <BrandLink />
          <nav>
            <Link href="/">꿈 해몽</Link>
            {loginRequired ? <form action="/api/auth/logout" method="post"><button type="submit">로그아웃</button></form> : null}
          </nav>
        </header>
        <ReviewProductCatalog accountLabel={account?.label ?? null} loginRequired={loginRequired} />
      </main>
      <SiteFooter />
    </>
  );
}
