import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { JournalPageShell } from "@/components/journal-page-shell";
import { ReviewLoginForm } from "@/components/review-login-form";
import { reviewPurchaseLoginRequired } from "@/lib/app-profile";
import { readReviewSession, safeReviewReturnPath } from "@/lib/auth/reviewer";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "로그인",
  robots: { index: false, follow: false, noarchive: true }
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const nextPath = safeReviewReturnPath(next);
  if (!reviewPurchaseLoginRequired()) redirect(nextPath);
  if (await readReviewSession()) redirect(nextPath);

  return (
    <JournalPageShell
      headerEnd={<Link className={styles.homeLink} href="/">꿈 해몽으로</Link>}
    >
      <main id="main-content" className={styles.page}>
        <section className={styles.layout} aria-labelledby="login-title">
          <div className={styles.intro}>
            <p className={styles.eyebrow}>계정</p>
            <h1 id="login-title">기록을 이어서<br />살펴볼까요?</h1>
            <p className={styles.description}>
              상품 선택과 결제를 계속하려면 로그인해 주세요. 입력한 계정 정보는
              로그인 확인에만 사용합니다.
            </p>
            <dl className={styles.assurances}>
              <div>
                <dt>01</dt>
                <dd>상품과 결제 내역을 한 계정에서 확인해요.</dd>
              </div>
              <div>
                <dt>02</dt>
                <dd>비밀번호는 서버에서만 확인해요.</dd>
              </div>
            </dl>
          </div>
          <div className={styles.formPanel}>
            <div className={styles.formHeading}>
              <p>로그인 정보</p>
              <span>안내받은 아이디 또는 이메일과 비밀번호를 입력해 주세요.</span>
            </div>
            <ReviewLoginForm nextPath={nextPath} />
          </div>
        </section>
      </main>
    </JournalPageShell>
  );
}
