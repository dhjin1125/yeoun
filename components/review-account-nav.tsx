"use client";

import { LogIn, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type SessionState = {
  configured: boolean;
  signedIn: boolean;
  account: { label: string } | null;
};

export function ReviewAccountNav() {
  const [session, setSession] = useState<SessionState | null>(null);
  const nodeOffReviewSite = process.env.NEXT_PUBLIC_NODEOFF_REVIEW_SITE === "true";

  useEffect(() => {
    if (nodeOffReviewSite) return;
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => (response.ok ? (response.json() as Promise<SessionState>) : null))
      .then((value) => { if (active && value) setSession(value); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [nodeOffReviewSite]);

  return (
    <nav className="account-nav" aria-label="계정 및 상품">
      <Link href="/products">상품</Link>
      {nodeOffReviewSite ? null : session?.signedIn ? (
        <form action="/api/auth/logout" method="post">
          <span title={session.account?.label ?? "로그인 계정"}><UserRound size={14} />로그인됨</span>
          <button type="submit">로그아웃</button>
        </form>
      ) : (
        <Link className="account-login-link" href="/login?next=/products"><LogIn size={14} />로그인</Link>
      )}
    </nav>
  );
}
