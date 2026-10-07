import { AlertCircle, ArrowRight } from "lucide-react";
import Link from "next/link";

export default async function PaymentFailPage({ searchParams }: { searchParams: Promise<{ code?: string; readingId?: string }> }) {
  const { code, readingId } = await searchParams;
  const canceled = code === "PAY_PROCESS_CANCELED";
  const returnUrl = readingId && /^[a-zA-Z0-9_-]{8,80}$/.test(readingId)
    ? `/reading/${encodeURIComponent(readingId)}`
    : "/";
  return (
    <main id="main-content" className="payment-return-card">
      <AlertCircle size={32} />
      <p className="utility-label">결제가 완료되지 않았어요</p>
      <h1>{canceled ? "결제를 취소했어요" : "결제를 완료하지 못했어요"}</h1>
      <p>{canceled ? "과금된 금액은 없습니다. 이전 결과로 돌아가 다시 선택할 수 있어요." : "결제수단을 확인한 뒤 다시 시도해 주세요. 승인되지 않은 결제는 과금되지 않습니다."}</p>
      <Link className="primary-button" href={returnUrl}>{readingId ? "이전 결과로 돌아가기" : "처음으로 돌아가기"} <ArrowRight size={17} /></Link>
    </main>
  );
}
