"use client";

import { ArrowRight, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import styles from "@/app/login/login.module.css";

type UnlockResponse = {
  ok?: boolean;
  error?: { message?: string };
};

export function AccessGateForm({ onUnlocked }: { onUnlocked?: () => void } = {}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: String(form.get("password") ?? "") }),
        cache: "no-store"
      });
      const body = (await response.json()) as UnlockResponse;
      if (!response.ok || !body.ok) throw new Error(body.error?.message ?? "비밀번호를 확인하지 못했어요.");
      onUnlocked?.();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "비밀번호를 확인하지 못했어요.");
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} aria-busy={busy} noValidate>
      <div className={styles.field}>
        <label htmlFor="access-gate-password">입장 비밀번호</label>
        <input
          id="access-gate-password"
          name="password"
          type="password"
          autoComplete="off"
          placeholder="전달받은 비밀번호"
          required
          maxLength={128}
          autoFocus
        />
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button className={styles.submit} type="submit" disabled={busy}>
        <LockKeyhole size={17} aria-hidden />
        {busy ? "확인하는 중이에요" : "해몽 시작하기"}
        <ArrowRight size={17} aria-hidden />
      </button>
    </form>
  );
}
