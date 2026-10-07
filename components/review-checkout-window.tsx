"use client";

import { Check, CreditCard, LockKeyhole } from "lucide-react";
import Link from "next/link";

export function ReviewCheckoutWindow({ productName, businessName }: { productName: string; businessName: string }) {
  return (
    <main id="main-content" className="review-checkout-window">
      <header><span><LockKeyhole size={16} />안전한 결제</span><small>결제 정보 확인</small></header>
      <section>
        <div className="review-checkout-merchant"><span>판매자</span><strong>{businessName}</strong></div>
        <h1>{productName}</h1>
        <p className="review-checkout-amount"><span>최종 결제금액</span><strong>990원</strong></p>
      </section>
      <section className="review-payment-methods" aria-label="결제수단">
        <h2>결제수단</h2>
        <button className="is-selected" type="button"><CreditCard size={20} /><span>신용·체크카드</span><Check size={17} /></button>
      </section>
      <aside><strong>현재 실제 결제는 진행되지 않습니다.</strong><p>정식 결제 기능이 연결되면 이 위치에서 결제수단을 입력할 수 있습니다. 지금은 카드번호나 결제 비밀번호를 입력받지 않습니다.</p></aside>
      <button className="review-payment-disabled" type="button" disabled>990원 결제 준비 중</button>
      <button className="review-window-close" type="button" onClick={() => window.close()}>창 닫기</button>
      <footer>
        <span>{businessName}</span>
        <nav aria-label="결제 정책">
          <Link href="/terms" target="_blank">이용약관</Link>
          <Link href="/privacy" target="_blank">개인정보처리방침</Link>
          <Link href="/refund" target="_blank">환불정책</Link>
        </nav>
      </footer>
    </main>
  );
}
