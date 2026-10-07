"use client";

import { useEffect, useRef, useState } from "react";
import { DreamMark } from "./brand";
import { DreamArchiveStage } from "./dream-archive-stage";

const INTRO_SESSION_KEY = "yeoun:intro:v2";
type IntroPhase = "boot" | "open" | "departing" | "skipping";

function isForcedIntro() {
  const requested = new URL(window.location.href).searchParams.get("intro");
  return requested === "1" || requested === "archive" || requested === "cosmic";
}

function shouldBypassIntro() {
  const url = new URL(window.location.href);
  return url.searchParams.get("deleted") === "1" || url.hash === "#dream-input";
}

function rememberIntro() {
  try {
    window.sessionStorage.setItem(INTRO_SESSION_KEY, "seen");
  } catch {
    // The experience remains usable when private browsing rejects storage.
  }
}

function hasSeenIntro() {
  try {
    return window.sessionStorage.getItem(INTRO_SESSION_KEY) === "seen";
  } catch {
    return false;
  }
}

function removeReplayQuery() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("intro")) return;
  url.searchParams.delete("intro");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function HomeIntroOverlay() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const enterButtonRef = useRef<HTMLButtonElement>(null);
  const exitTimerRef = useRef<number | null>(null);
  const previousOverflowRef = useRef("");
  const [phase, setPhase] = useState<IntroPhase>("boot");
  const [rendered, setRendered] = useState(true);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if ((!isForcedIntro() && hasSeenIntro()) || shouldBypassIntro()) {
      if (dialog.open) dialog.close();
      setRendered(false);
      return;
    }

    if (dialog.open) dialog.close();
    dialog.showModal();
    const frame = window.requestAnimationFrame(() => setPhase("open"));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (phase !== "open") return;
    const frame = window.requestAnimationFrame(() => enterButtonRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [phase]);

  useEffect(() => {
    if (!rendered) return;
    previousOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("cosmic-entry-active");

    return () => {
      document.body.style.overflow = previousOverflowRef.current;
      document.body.classList.remove("cosmic-entry-active");
      if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
    };
  }, [rendered]);

  function finish(kind: "enter" | "skip") {
    if (phase !== "open") return;
    rememberIntro();
    removeReplayQuery();

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nextPhase = kind === "skip" || reducedMotion ? "skipping" : "departing";
    const duration = nextPhase === "departing" ? 1_320 : reducedMotion ? 0 : 180;
    setPhase(nextPhase);

    exitTimerRef.current = window.setTimeout(() => {
      const dialog = dialogRef.current;
      if (dialog?.open) dialog.close();
      setRendered(false);
      if (kind === "enter") {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        });
      }
    }, duration);
  }

  if (!rendered) return null;

  return (
    <dialog
      ref={dialogRef}
      className={`home-intro-dialog home-intro-dialog--${phase}`}
      aria-labelledby="home-intro-title"
      aria-describedby="home-intro-description"
      aria-busy={phase === "boot"}
      onCancel={(event) => {
        event.preventDefault();
        finish("skip");
      }}
    >
      <DreamArchiveStage phase={phase} />
      <header className="home-intro-header">
        <div className="home-intro-brand" aria-label="여운 꿈 관측 기록">
          <DreamMark size={39} />
          <span><strong>여운</strong></span>
        </div>
        <button className="home-intro-skip" type="button" onClick={() => finish("skip")} disabled={phase !== "open"}>
          <span>인트로 건너뛰기</span><i aria-hidden="true" />
        </button>
      </header>
      <div className="home-intro-copy">
        <p className="home-intro-kicker"><span aria-hidden="true" />가입 없이 첫 해석 무료</p>
        <h2 id="home-intro-title">마음에 남은 그 꿈,<br /><em>어떤 뜻일까요?</em></h2>
        <p id="home-intro-description">꿈속 상징과 당신이 겪은 장면을 함께 풀어드려요. 기억나는 만큼 적고, 궁금했던 뜻부터 읽어보세요.</p>
        <button
          ref={enterButtonRef}
          className="home-intro-enter"
          type="button"
          onClick={() => finish("enter")}
          disabled={phase !== "open"}
        >
          <span>내 꿈 무료로 풀어보기</span>
          <i aria-hidden="true" />
        </button>
      </div>
    </dialog>
  );
}
