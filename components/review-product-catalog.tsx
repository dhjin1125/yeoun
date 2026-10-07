"use client";

import { ArrowRight, Check, LockKeyhole, MessageCircleMore, ReceiptText, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { OrderProduct } from "@/lib/types";

const PRODUCTS: Array<{
  id: OrderProduct;
  number: string;
  eyebrow: string;
  title: string;
  description: string;
  includes: string[];
}> = [
  {
    id: "full_reading",
    number: "01",
    eyebrow: "첫 구매 상품",
    title: "상세 해몽 + 질문 2회",
    description: "핵심 사실을 확인한 뒤, 답변을 반영한 통합 해석과 이 해석을 고른 이유를 읽을 수 있어요.",
    includes: ["확인한 사실을 반영한 상세 풀이", "심화 질문 2회", "사실 정정·생성 오류 수정 포함"]
  },
  {
    id: "followup_pack_2",
    number: "02",
    eyebrow: "추가 상품",
    title: "후속 질문 2회 추가",
    description: "기본 질문 두 번을 모두 사용한 뒤, 같은 꿈의 상담 맥락을 이어 질문 두 번을 더 엽니다.",
    includes: ["같은 꿈의 상담 맥락 유지", "후속 질문 2회", "꿈 한 건당 한 번만 구매"]
  }
];

export function ReviewProductCatalog({
  accountLabel,
  loginRequired
}: {
  accountLabel: string | null;
  loginRequired: boolean;
}) {
  const [selected, setSelected] = useState<(typeof PRODUCTS)[number] | null>(null);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [popupError, setPopupError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!selected) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelected(null);
        setPolicyAccepted(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", handleKey);
    };
  }, [selected]);

  function openCheckout() {
    if (!selected || !policyAccepted) return;
    setPopupError("");
    const popup = window.open(
      `/checkout/payment?product=${encodeURIComponent(selected.id)}`,
      "yeoun-checkout-payment",
      "popup=yes,width=520,height=760,resizable=yes,scrollbars=yes"
    );
    if (!popup) {
      setPopupError("브라우저에서 팝업을 허용한 뒤 다시 눌러주세요.");
      return;
    }
    popup.focus();
  }

  return (
    <>
      <section className="review-product-hero">
        <div>
          <p className="utility-label">상품 안내</p>
          <h1>필요한 만큼만,<br />한 번씩 결제합니다.</h1>
          <p>모든 상품은 990원 단건 결제이며 구독이나 자동결제가 없습니다.</p>
        </div>
        {loginRequired && accountLabel ? (
          <aside aria-label="현재 로그인 계정"><span>로그인 계정</span><strong>{accountLabel}</strong><small>로그인됨</small></aside>
        ) : null}
      </section>

      <section className="review-product-grid" aria-label="여운 상품 선택">
        {PRODUCTS.map((product) => (
          <article key={product.id}>
            <div className="review-product-number"><span>{product.number}</span><small>{product.eyebrow}</small></div>
            <div className="review-product-icon" aria-hidden="true">
              {product.id === "full_reading" ? <ReceiptText size={24} /> : <MessageCircleMore size={24} />}
            </div>
            <h2>{product.title}</h2>
            <p>{product.description}</p>
            <ul>{product.includes.map((item) => <li key={item}><Check size={15} />{item}</li>)}</ul>
            <div className="review-product-action">
              <strong><span>₩</span>990</strong>
              <button type="button" onClick={() => { setSelected(product); setPolicyAccepted(false); setPopupError(""); }}>
                이 상품 선택 <ArrowRight size={17} />
              </button>
            </div>
          </article>
        ))}
      </section>

      <section className="review-payment-route" aria-label="결제 진행 순서">
        <p className="utility-label">결제 흐름</p>
        <ol>
          {loginRequired ? <li><span>1</span><div><strong>로그인</strong><p>서버에서 계정을 확인합니다.</p></div></li> : null}
          <li><span>{loginRequired ? "2" : "1"}</span><div><strong>상품 선택</strong><p>구성과 최종 금액을 확인합니다.</p></div></li>
          <li><span>{loginRequired ? "3" : "2"}</span><div><strong>결제창 팝업</strong><p>PG 결제창으로 이동하는 별도 창을 엽니다.</p></div></li>
        </ol>
        <p>현재 결제창은 기능 확인 단계이며 카드정보를 입력받거나 금액을 청구하지 않습니다.</p>
      </section>

      {selected ? (
        <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSelected(null); setPolicyAccepted(false); } }}>
          <section className="review-order-sheet" role="dialog" aria-modal="true" aria-labelledby="review-order-title">
            <button ref={closeRef} className="sheet-close" type="button" onClick={() => { setSelected(null); setPolicyAccepted(false); }} aria-label="상품 확인 닫기"><X size={20} /></button>
            <p className="utility-label">주문 내용을 확인해 주세요</p>
            <h2 id="review-order-title">{selected.title}</h2>
            <dl>
              <div><dt>상품 금액</dt><dd>990원</dd></div>
              <div><dt>할인</dt><dd>0원</dd></div>
              <div><dt>최종 결제금액</dt><dd><strong>990원</strong></dd></div>
            </dl>
            <div className="review-order-notice"><LockKeyhole size={17} /><p>다음 버튼은 별도의 결제창 팝업을 엽니다. 이 화면에서는 실제 승인이나 과금이 발생하지 않습니다.</p></div>
            <label className="consent-check review-order-consent">
              <input type="checkbox" checked={policyAccepted} onChange={(event) => { setPolicyAccepted(event.target.checked); setPopupError(""); }} />
              <span aria-hidden="true"><Check size={13} /></span>
              <em>
                <Link href="/terms" target="_blank">이용약관</Link>과 <Link href="/refund" target="_blank">환불정책</Link>을 확인했으며, 결제 후 맞춤형 디지털 콘텐츠 제공이 즉시 시작되는 것에 동의합니다. <Link href="/privacy" target="_blank">개인정보처리방침</Link>
              </em>
            </label>
            {popupError ? <p className="form-error" role="alert">{popupError}</p> : null}
            <button className="primary-button primary-button--wide" type="button" onClick={openCheckout} disabled={!policyAccepted}>
              결제창 팝업 열기 <ArrowRight size={18} />
            </button>
            <p className="checkout-footnote">상품 선택 → 주문 확인 → 결제창 팝업</p>
          </section>
        </div>
      ) : null}

      <div className="review-product-bottom-nav"><Link href="/">꿈 해몽 화면으로 돌아가기</Link></div>
    </>
  );
}
