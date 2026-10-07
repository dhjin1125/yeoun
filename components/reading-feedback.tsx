"use client";

import { useRef, useState } from "react";
import styles from "./reading-feedback.module.css";

type Rating = "helpful" | "not_helpful";

export function ReadingFeedback({ kind, turnId, onRate }: {
  kind: string;
  turnId: string;
  onRate: (context: Record<string, string>) => void;
}) {
  const [helpful, setHelpful] = useState<Rating | null>(null);
  const [resolved, setResolved] = useState<Rating | null>(null);
  const [showReasons, setShowReasons] = useState(false);
  const recorded = useRef(new Set<string>());
  function rate(dimension: "helpfulness" | "question_resolved", rating: Rating, reason?: string) {
    if (recorded.current.has(dimension)) return;
    recorded.current.add(dimension);
    if (dimension === "helpfulness") setHelpful(rating);
    else setResolved(rating);
    onRate({ dimension, rating, turnId, step: kind, ...(reason ? { reason } : {}) });
  }
  const reasons = [
    ["misread", "내용을 잘못 읽었어요"],
    ["generic", "내 꿈과 연결이 약해요"],
    ...(kind === "detailed" ? [["no_paid_value", "무료와 차이가 없어요"]] : []),
    ["awkward", "문장이 이상해요"]
  ];
  return (
    <div className={styles.feedback} aria-label="답변 평가">
      <div className={styles.row} role="group" aria-label="도움 여부">
        <span aria-live="polite">{helpful ? "의견을 남겨주셔서 고마워요." : "이 답변이 도움이 됐나요?"}</span>
        {!helpful ? <div className={styles.actions}>
          <button type="button" onClick={() => rate("helpfulness", "helpful")}>도움됐어요</button>
          <button type="button" aria-expanded={showReasons} onClick={() => setShowReasons(current => !current)}>아쉬워요</button>
        </div> : null}
      </div>
      {!helpful && showReasons ? <div className={styles.reasons} role="group" aria-label="아쉬운 이유">
        {reasons.map(([reason, label]) => <button type="button" key={reason} onClick={() => rate("helpfulness", "not_helpful", reason)}>{label}</button>)}
      </div> : null}
      {kind === "free" || kind === "detailed" ? <div className={styles.row} role="group" aria-label="궁금증 해결 여부">
        <span aria-live="polite">{resolved ? "궁금증에 대한 의견도 고마워요." : "궁금했던 점이 풀렸나요?"}</span>
        {!resolved ? <div className={styles.actions}>
          <button type="button" onClick={() => rate("question_resolved", "helpful")}>풀렸어요</button>
          <button type="button" onClick={() => rate("question_resolved", "not_helpful")}>아직 궁금해요</button>
        </div> : null}
      </div> : null}
    </div>
  );
}
