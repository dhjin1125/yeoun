"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Plus } from "lucide-react";
import type { PublicReading } from "@/lib/types";
import { requestProgressJson } from "@/lib/progress-client";
import { initialProgress } from "@/lib/progress";
import { ProgressDisplay } from "./progress-display";
import { normalizeNodeOffReviewPayload } from "@/lib/nodeoff-review";

export function FreeDetailForm({ reading, token, onUpdated, onEditingChange, optional = false }: {
  reading: PublicReading;
  token?: string;
  onUpdated: (reading: PublicReading) => void;
  onEditingChange: (editing: boolean) => void;
  optional?: boolean;
}) {
  const guidance = reading.freeDetailGuidance;
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(() => initialProgress("추가한 내용도 함께 읽고 있어요"));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const pendingRequest = useRef<{text:string;id:string} | null>(null);
  const id = useId();
  const correcting = Boolean(reading.canCorrectReading);
  if (!guidance || (!correcting && reading.status !== "free_ready")) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || composing.current || detail.trim().length < 2) return;
    setBusy(true); setError("");
    setProgress(initialProgress("추가한 내용도 함께 읽고 있어요"));
    try {
      if (pendingRequest.current?.text !== detail) pendingRequest.current = {text:detail,id:`fix_${crypto.randomUUID().replaceAll("-","")}`};
      const response = await requestProgressJson<{ reading: PublicReading }>(`/api/readings/${encodeURIComponent(reading.id)}/${correcting ? "messages" : "details"}`, {
        method: "POST", body: JSON.stringify(correcting ? {message:detail,clientMessageId:pendingRequest.current.id,restoreToken:token} : { detail, questionId:guidance?.questionId, restoreToken: token })
      }, setProgress);
      pendingRequest.current = null;
      onUpdated(response.reading);
      setOpen(false); setDetail(""); onEditingChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "다시 시도해 주세요. 적어둔 내용은 그대로 있어요.");
      if (correcting) {
        try {
          const accessToken=token ?? new URL(reading.restoreUrl).searchParams.get("token");
          const response=await fetch(`/api/readings/${encodeURIComponent(reading.id)}${accessToken ? `?token=${encodeURIComponent(accessToken)}` : ""}`,{cache:"no-store"});
          if (response.ok) onUpdated(normalizeNodeOffReviewPayload((await response.json()).reading));
        } catch { /* Keep the correction text and the original error available. */ }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`free-detail${optional ? " free-detail--optional" : ""}`} aria-label={optional ? correcting ? "구매한 풀이 정정" : "무료 풀이에 내용 추가" : undefined} aria-labelledby={optional && !open ? undefined : `${id}-heading`}>
      {!optional || open ? <>
      <p className="free-detail-kicker">{correcting ? "기본 사실 확인 · 풀이 수정" : guidance.ready ? "기록 보완" : "풀이를 바꾸는 확인 질문"}</p>
      <h2 id={`${id}-heading`}>{guidance.question}</h2>
      <p className="free-detail-hint">{correcting ? "기본 사실 확인, 오독 정정, 문장 오류 수정은 심화 질문 횟수에서 차감하지 않아요." : guidance.limited ? "기억나지 않는 부분을 만들어 채우지 않을게요. 지금은 상세 풀이 결제를 받지 않아요. 나중에 떠오르면 기록을 보완할 수 있어요." : guidance.reason ?? "실제로 기억난 내용만 적어주세요. 풀이에 반영할게요."}</p>
      </> : null}
      {!open ? (
        <button className={optional || guidance.ready ? "secondary-button" : "primary-button"} type="button" aria-expanded={false} aria-controls={`${id}-form`} onClick={() => {
          setOpen(true); onEditingChange(true); requestAnimationFrame(() => inputRef.current?.focus());
        }}><Plus size={16} aria-hidden="true" />{correcting ? "사실 정정·오류 수정" : guidance.questionId ? "확인 질문에 답하기" : "기억나는 내용 더 적기"}</button>
      ) : (
        <form id={`${id}-form`} onSubmit={submit} aria-busy={busy}>
          {guidance.options?.length ? <div className="consultation-options" aria-label="확인 질문 선택지">{guidance.options.map(option=><button type="button" key={option} aria-pressed={detail===option} disabled={busy} onClick={()=>setDetail(option)}>{option}</button>)}</div> : null}
          <label htmlFor={`${id}-detail`}>{correcting ? "정정하거나 수정할 내용" : "확인 질문 답변 또는 추가 내용"}</label>
          <textarea ref={inputRef} id={`${id}-detail`} value={detail} maxLength={600} readOnly={busy}
            placeholder={guidance.placeholder} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
            onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
            onChange={(event) => { setDetail(event.target.value); setError(""); }} />
          <span className="free-detail-count">{detail.length} / 600</span>
          {error ? <p id={`${id}-error`} role="alert" className="form-error">{error}</p> : null}
          {busy ? <ProgressDisplay progress={progress} compact /> : null}
          <div className="free-detail-actions">
            <button type="submit" className="primary-button" disabled={busy || detail.trim().length < 2}>
              {busy ? "내용 반영 중" : correcting ? "추가 비용 없이 반영하기" : "답변 반영하기"}<ArrowRight size={16} aria-hidden="true" />
            </button>
            <button type="button" className="text-button" disabled={busy} onClick={() => { setOpen(false); onEditingChange(false); }}>추가하지 않고 닫기</button>
          </div>
        </form>
      )}
    </section>
  );
}
