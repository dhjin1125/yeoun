"use client";

import { AlertCircle, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { initialProgress } from "@/lib/progress";
import { checkoutReturnPath } from "@/lib/checkout-return";
import { requestProgressJson } from "@/lib/progress-client";
import { DreamMark } from "./brand";
import { ProgressDisplay } from "./progress-display";

export function PaymentSuccess() {
  const params = useSearchParams();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const isFollowupPack = params.get("product") === "followup_pack_2";
  const readingId = params.get("readingId");
  const [returnUrl, setReturnUrl] = useState(() => checkoutReturnPath(null, readingId));
  const providerFailed = Boolean(params.get("code"));
  const [progress, setProgress] = useState(() => initialProgress("결제 승인 정보를 서버에 전달하는 중이에요"));

  useEffect(() => {
    setError("");
    try {
      setReturnUrl(checkoutReturnPath(sessionStorage.getItem(`yeoun:checkout:return:${params.get("orderId")}`), params.get("readingId")));
    } catch { /* Storage can be disabled; keep the same-browser fallback. */ }
    if (params.get("code")) {
      setError("결제를 완료하지 않았어요. 무료 풀이로 돌아가 다시 진행할 수 있어요.");
      return;
    }
    const paymentKey = params.get("paymentId") ?? params.get("paymentKey");
    const orderId = params.get("orderId");
    const amount = Number(params.get("amount"));
    if (!paymentKey || !orderId || !Number.isSafeInteger(amount)) {
      setError("결제 승인 정보가 올바르지 않아요.");
      return;
    }
    let active = true;
    setProgress(initialProgress("결제 승인 정보를 서버에 전달하는 중이에요"));
    requestProgressJson<{ reading: { restoreUrl: string } }>(
      "/api/payments/confirm",
      {
        method: "POST",
        body: JSON.stringify({ paymentKey, orderId, amount })
      },
      (update) => { if (active) setProgress(update); }
    )
      .then((body) => {
        if (!active) return;
        window.location.replace(body.reading.restoreUrl);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "결제를 승인하지 못했어요."); });
    return () => { active = false; };
  }, [params, attempt]);

  if (error) {
    return (
      <main id="main-content" className="payment-return-card">
        <AlertCircle size={32} />
        <p className="utility-label">{providerFailed ? "꿈과 무료 풀이는 그대로예요" : "결제 확인이 필요해요"}</p>
        <h1>{providerFailed ? "결제를 완료하지 않았어요" : "결제 내역을 다시 확인할게요"}</h1>
        <p>{error}</p>
        {!providerFailed ? <>
          <p>이미 승인했다면 다시 결제할 필요 없어요.</p>
          <button className="primary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>결제 확인 다시 시도</button>
        </> : null}
        <Link className={providerFailed ? "primary-button" : "secondary-button"} href={returnUrl}>내 꿈으로 돌아가기 <ArrowRight size={17} /></Link>
      </main>
    );
  }
  return (
    <main id="main-content" className="payment-return-card" aria-busy="true">
      <DreamMark size={58} />
      <p className="utility-label">결제 내역을 확인하고 있어요</p>
      <h1>{isFollowupPack ? "질문 2회를 더 열고 있어요" : "상세 해몽을 열고 있어요"}</h1>
      <ProgressDisplay progress={progress} />
      <p>{isFollowupPack ? "같은 상담 기록으로 곧 돌아갈게요." : "상세 답변이 완성될 때까지 창을 닫지 말아주세요."}</p>
    </main>
  );
}
