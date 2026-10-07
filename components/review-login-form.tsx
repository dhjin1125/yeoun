"use client";

import { ArrowRight, LockKeyhole } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import styles from "@/app/login/login.module.css";

type LoginResponse = {
  ok?: boolean;
  redirectTo?: string;
  error?: { message?: string };
};

export function ReviewLoginForm({ nextPath }: { nextPath: string }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setReady(true), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: String(form.get("identifier") ?? ""),
          password: String(form.get("password") ?? ""),
          next: nextPath
        }),
        cache: "no-store"
      });
      const body = (await response.json()) as LoginResponse;
      if (!response.ok || !body.ok) throw new Error(body.error?.message ?? "로그인하지 못했어요.");
      window.location.assign(body.redirectTo ?? nextPath);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로그인하지 못했어요.");
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.form}
      method="post"
      action="/api/auth/login"
      onSubmit={submit}
      aria-busy={busy}
      noValidate
    >
      <div className={styles.field}>
        <label htmlFor="review-identifier">아이디 또는 이메일</label>
        <input
          id="review-identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="아이디 또는 이메일"
          required
          maxLength={160}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="review-password">비밀번호</label>
        <input
          id="review-password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="비밀번호"
          required
          maxLength={128}
        />
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button className={styles.submit} type="submit" disabled={busy || !ready}>
        {!ready ? "로그인 준비 중" : busy ? "확인하는 중" : <>로그인하고 상품 보기 <ArrowRight size={18} /></>}
      </button>
      <p className={styles.securityNote}><LockKeyhole size={13} />비밀번호는 브라우저에 저장하지 않습니다.</p>
    </form>
  );
}
