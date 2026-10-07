import Link from "next/link";
import { reviewPurchaseLoginRequired } from "@/lib/app-profile";
import { businessInfo } from "@/lib/business-info";
import { BrandLink } from "./brand";

export function SiteFooter() {
  const business = businessInfo();
  const showLogin = reviewPurchaseLoginRequired();
  const phoneHref = business.phone.replace(/[^0-9+]/g, "");
  const hasPhone = phoneHref.length >= 8;
  const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(business.email);

  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand-column">
          <BrandLink />
          <p>꿈 해몽은 상징적 참고 풀이이며 실제 사건의 예측이나 진단이 아닙니다.</p>
        </div>
        <section className="business-disclosure" aria-labelledby="business-info-title">
          <div>
            <h2 id="business-info-title">사업자 정보</h2>
          </div>
          <dl>
            <div><dt>상호명</dt><dd>{business.name}</dd></div>
            <div><dt>대표자명</dt><dd>{business.representative}</dd></div>
            <div><dt>사업자등록번호</dt><dd>{business.registrationNumber}</dd></div>
            {business.mailOrderRegistrationNumber ? <div><dt>통신판매업 신고번호</dt><dd>{business.mailOrderRegistrationNumber}</dd></div> : null}
            <div className="business-address"><dt>운영 지역</dt><dd>{business.address}</dd></div>
            {business.phone ? <div><dt>고객센터 전화</dt><dd>{hasPhone ? <a href={`tel:${phoneHref}`}>{business.phone}</a> : business.phone}</dd></div> : null}
            <div><dt>고객센터 이메일</dt><dd>{hasEmail ? <a href={`mailto:${business.email}`}>{business.email}</a> : business.email}</dd></div>
          </dl>
        </section>
        <nav aria-label="정책 및 계정">
          <Link href="/terms">이용약관</Link>
          <Link href="/privacy">개인정보처리방침</Link>
          <Link href="/refund">환불정책</Link>
          {showLogin ? <Link href="/login?next=/products">로그인</Link> : null}
          <Link href="/products">상품 안내</Link>
        </nav>
        <small>© 2026 노드오프 · 여운</small>
      </div>
    </footer>
  );
}
