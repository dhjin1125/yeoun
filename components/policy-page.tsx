import Link from "next/link";
import { businessInfo } from "@/lib/business-info";
import { DreamMark } from "./brand";
import styles from "./policy-page.module.css";

export type PolicySection = { id: string; title: string; body: React.ReactNode };

export function PolicyPage({ title, description, sections }: { title: string; description: string; sections: PolicySection[] }) {
  const business = businessInfo();
  const phoneHref = business.phone.replace(/[^0-9+]/g, "");
  const hasPhone = phoneHref.length >= 8;
  const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(business.email);
  const policyLinks = [
    { href: "/terms", label: "이용약관" },
    { href: "/privacy", label: "개인정보처리방침" },
    { href: "/refund", label: "환불정책" }
  ];

  function sectionLabel(sectionTitle: string) {
    return sectionTitle.replace(/^\d+\.\s*/, "");
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="여운 홈">
          <DreamMark size={32} />
          <span className={styles.brandCopy}>
            <strong>여운</strong>
            <small>꿈을 기록하고 해석해요</small>
          </span>
        </Link>
        <Link className={styles.backLink} href="/">
          <span aria-hidden="true">←</span>
          꿈 해몽으로
        </Link>
      </header>

      <main id="main-content" className={styles.main}>
        <section className={styles.hero} aria-labelledby="policy-title">
          <div className={styles.documentMeta}>
            <p>서비스 정책 안내</p>
            <span>마지막 수정</span>
            <time dateTime="2026-08-31">2026.08.31</time>
          </div>
          <div className={styles.heroCopy}>
            <h1 id="policy-title">{title}</h1>
            <p>{description}</p>
            <div className={styles.statusNote}>
              <span aria-hidden="true" />
              <p>현재 서비스의 판매·처리 흐름을 기준으로 게시한 정책입니다.</p>
            </div>
          </div>
        </section>

        <div className={styles.policyLayout}>
          <aside className={styles.tableOfContents}>
            <p>이 문서 안에서</p>
            <nav aria-label={`${title} 목차`}>
              {sections.map((section, index) => (
                <a href={`#${section.id}`} key={section.id}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {sectionLabel(section.title)}
                </a>
              ))}
            </nav>
          </aside>

          <article className={styles.article}>
            {sections.map((section, index) => (
              <section id={section.id} key={section.id} aria-labelledby={`${section.id}-title`}>
                <header>
                  <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <h2 id={`${section.id}-title`}>{sectionLabel(section.title)}</h2>
                </header>
                <div className={styles.sectionBody}>{section.body}</div>
              </section>
            ))}
          </article>
        </div>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <nav className={styles.policyLinks} aria-label="정책 안내">
            {policyLinks.map((link) => (
              <Link href={link.href} aria-current={link.label === title ? "page" : undefined} key={link.href}>
                {link.label}
              </Link>
            ))}
            <Link href="/">꿈 해몽으로 돌아가기</Link>
          </nav>

          <section className={styles.businessDisclosure} aria-labelledby="policy-business-title">
            <h2 id="policy-business-title">사업자 정보</h2>
            <dl>
              <div><dt>상호명</dt><dd>{business.name}</dd></div>
              <div><dt>대표자명</dt><dd>{business.representative}</dd></div>
              <div><dt>사업자등록번호</dt><dd>{business.registrationNumber}</dd></div>
              {business.mailOrderRegistrationNumber ? <div><dt>통신판매업 신고번호</dt><dd>{business.mailOrderRegistrationNumber}</dd></div> : null}
              <div className={styles.businessAddress}><dt>운영 지역</dt><dd>{business.address}</dd></div>
              {business.phone ? <div><dt>전화번호</dt><dd>{hasPhone ? <a href={`tel:${phoneHref}`}>{business.phone}</a> : business.phone}</dd></div> : null}
              <div><dt>이메일</dt><dd>{hasEmail ? <a href={`mailto:${business.email}`}>{business.email}</a> : business.email}</dd></div>
            </dl>
          </section>

          <p className={styles.safetyNote}>꿈 해몽은 문화적·상징적 참고 정보이며 의료, 재정, 안전 또는 미래 예측의 근거가 아닙니다.</p>
          <small className={styles.copyright}>© 2026 노드오프 · 여운</small>
        </div>
      </footer>
    </div>
  );
}
