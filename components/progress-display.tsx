"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { OperationProgress } from "@/lib/progress";

const activityLabels = {
  starting: "해석 준비 중",
  connected: "해석 준비 중",
  responding: "해석 작성 중",
  finalizing: "해석 마무리 중"
} as const;

const readingStageLabels: Record<string, string> = {
  request_validated: "내용을 확인하고 있어요.",
  dream_analyzed: "꿈을 읽고 있어요.",
  reading_saved: "꿈을 풀어보고 있어요.",
  free_reading_ready: "무료 풀이가 준비됐어요.",
  detailed_generation_started: "상세 해몽을 준비하고 있어요.",
  followup_saved: "답변이 준비됐어요.",
  ai_request_prepared: "꿈의 장면과 궁금한 점을 함께 정리하고 있어요.",
  ai_provider_started: "이 꿈에 맞는 상세 풀이를 준비하고 있어요.",
  ai_provider_session_started: "이 꿈에 맞는 상세 풀이를 준비하고 있어요.",
  ai_model_started: "장면의 순서와 감정의 변화를 읽고 있어요.",
  ai_response_received: "장면별 풀이를 읽기 편하게 정리하고 있어요.",
  ai_provider_completed: "완성된 풀이를 확인하고 있어요.",
  ai_response_validated: "완성된 풀이를 확인하고 있어요.",
  ai_quality_checked: "이제 상세 해몽을 보여드릴게요.",
  ai_fallback_prepared: "꿈에서 확인할 수 있는 내용으로 풀이를 정리하고 있어요."
};

function elapsedLabel(totalSeconds: number) {
  if (totalSeconds < 60) return `${totalSeconds}초`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}분 ${seconds}초` : `${minutes}분`;
}

export function ProgressDisplay({
  progress,
  compact = false,
  showNote = true
}: {
  progress: OperationProgress;
  compact?: boolean;
  showNote?: boolean;
}) {
  const style = { "--operation-progress": progress.percent / 100 } as CSSProperties;
  const active = Boolean(progress.activityState);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsedSeconds(0);
      return;
    }
    const parsedStart = progress.activityStartedAt ? Date.parse(progress.activityStartedAt) : Number.NaN;
    const startedAt = Number.isFinite(parsedStart) ? parsedStart : Date.now();
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)));
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(interval);
  }, [active, progress.activityStartedAt]);

  const className = [
    "operation-progress",
    compact ? "operation-progress--compact" : "",
    active ? "operation-progress--active" : ""
  ].filter(Boolean).join(" ");
  const activityText = progress.activityState
    ? `${activityLabels[progress.activityState]} · ${elapsedLabel(elapsedSeconds)}`
    : progress.percent === 100 ? "완료" : "진행 중";
  const label = readingStageLabels[progress.stage] ?? progress.label;
  const ariaText = `${progress.percent}% · ${label}${active ? ` · ${elapsedLabel(elapsedSeconds)} 경과` : ""}`;

  return (
    <div className={className}>
      <div className="operation-progress-head">
        <span>{activityText}</span>
        <strong>{progress.percent}<small>%</small></strong>
      </div>
      <div
        className="operation-progress-track"
        role="progressbar"
        aria-label="작업 진행률"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        aria-valuetext={ariaText}
      >
        <span className="operation-progress-fill" style={style} />
      </div>
      <p className="operation-progress-label" aria-live="polite" aria-atomic="true">{label}</p>
      {showNote ? (
        <p className="operation-progress-note">
          {elapsedSeconds >= 45
            ? "조금 더 시간이 필요해요. 잠시만 기다려 주세요."
            : "잠시만 기다려 주세요."}
        </p>
      ) : null}
    </div>
  );
}
