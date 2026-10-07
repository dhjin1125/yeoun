import type { ReactNode } from "react";
import Link from "next/link";
import { ReviewAccountNav } from "@/components/review-account-nav";
import { reviewPurchaseLoginRequired } from "@/lib/app-profile";
import { businessInfo } from "@/lib/business-info";
import { promptLabAvailable } from "@/lib/prompt-lab";
import styles from "./journal-page-shell.module.css";

function JournalDreamMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="dream-mark"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
    >
      <path d="M12.5 14.5c8.2-6.1 19.4-3.8 24.5 4.9 4.2 7.2 1.8 16.5-5.4 20.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M16.4 20.1c5.4-4.1 13.2-2.7 16.8 3.1 3.1 5 1.5 11.6-3.5 14.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M20.1 25.7c2.8-2.1 6.7-1.3 8.5 1.7 1.5 2.6.7 5.9-1.8 7.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M11 39.5h11.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="11" cy="39.5" r="2" fill="currentColor" />
    </svg>
  );
}

export function JournalPageShell({
  children,
  headerEnd
}: {
  children: ReactNode;
  headerEnd?: ReactNode;
}) {
  const business = businessInfo();
  const showReviewAccount = reviewPurchaseLoginRequired();
  const phoneHref = business.phone.replace(/[^0-9+]/g, "");
  const registrationDigits = business.registrationNumber.replace(/\D/g, "");
  const hasPhone = phoneHref.length >= 8;
  const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(business.email);
  const hasRegistrationNumber = registrationDigits.length === 10;

  return (
    <div
      className={styles.journalRoot}
      data-design-source="design-preview-golden-master"
    >
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="여운 홈">
          <JournalDreamMark />
          <span className={styles.brandCopy}>
            <strong>여운</strong>
            <small>꿈을 기록하고 해석해요</small>
          </span>
        </Link>
        {headerEnd !== undefined ? headerEnd : showReviewAccount ? <ReviewAccountNav /> : null}
      </header>

      {children}

      <footer className={styles.businessFooter}>
        <div className={styles.footerInner}>
          <nav className={styles.policyLinks} aria-label="정책 안내">
            {promptLabAvailable() ? <Link href="/prompt-lab">프롬프트 실험실</Link> : null}
            <Link href="/products">판매 상품</Link>
            <Link href="/terms">이용약관</Link>
            <Link href="/privacy">개인정보처리방침</Link>
            <Link href="/refund">환불정책</Link>
          </nav>

          <section className={styles.businessDisclosure} aria-labelledby="reading-business-title">
            <h2 id="reading-business-title">사업자 정보</h2>
            <dl>
              <div>
                <dt>상호명</dt>
                <dd>{business.name}</dd>
              </div>
              <div>
                <dt>대표자명</dt>
                <dd>{business.representative}</dd>
              </div>
              <div>
                <dt>사업자등록번호</dt>
                <dd>
                  {business.registrationNumber}
                  {hasRegistrationNumber ? (
                    <a
                      href={`https://www.ftc.go.kr/bizCommPop.do?apv_perm_no=&wrkr_no=${registrationDigits}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      사업자정보 확인
                    </a>
                  ) : null}
                </dd>
              </div>
              {business.mailOrderRegistrationNumber ? <div>
                <dt>통신판매업 신고번호</dt>
                <dd>{business.mailOrderRegistrationNumber}</dd>
              </div> : null}
              <div className={styles.businessAddress}>
                <dt>운영 지역</dt>
                <dd>{business.address}</dd>
              </div>
              {business.phone ? <div>
                <dt>고객센터 전화</dt>
                <dd>{hasPhone ? <a href={`tel:${phoneHref}`}>{business.phone}</a> : business.phone}</dd>
              </div> : null}
              <div>
                <dt>고객센터 이메일</dt>
                <dd>{hasEmail ? <a href={`mailto:${business.email}`}>{business.email}</a> : business.email}</dd>
              </div>
            </dl>
          </section>

          <p className={styles.safetyNote}>
            꿈 해몽은 상징적 참고 풀이이며 실제 사건의 예측이나 진단이 아닙니다.
          </p>
          <small className={styles.copyright}>© 2026 여운</small>
        </div>
      </footer>
    </div>
  );
}
