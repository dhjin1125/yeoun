import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { accessGatePassed } from "@/lib/access-gate";
import { AccessGateForm } from "@/components/access-gate-form";
import { JournalPageShell } from "@/components/journal-page-shell";
import styles from "@/app/login/login.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "입장 비밀번호",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer"
};

export default async function AccessPage() {
  if (await accessGatePassed()) redirect("/");
  return <JournalPageShell>
    <main id="main-content" className={styles.page}>
      <section className={styles.layout} aria-labelledby="access-title">
        <div className={styles.intro}>
          <p className={styles.eyebrow}>여운</p>
          <h1 id="access-title">비밀번호를 입력해 주세요</h1>
          <p className={styles.description}>전달받은 비밀번호로 입장할 수 있어요.</p>
        </div>
        <div className={styles.formPanel}><AccessGateForm /></div>
      </section>
    </main>
  </JournalPageShell>;
}
