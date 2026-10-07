import type { Metadata } from "next";
import { PolicyPage, type PolicySection } from "@/components/policy-page";
import { businessInfo } from "@/lib/business-info";

export const metadata: Metadata = { title: "환불정책" };

function refundSections(): PolicySection[] {
  const business = businessInfo();
  return [
  { id: "trial", title: "1. 결제 전 확인", body: <><p>사용자는 결제 전에 완결된 무료 핵심 해석과 유료 상세의 섹션명·개인화 첫 문장을 확인할 수 있습니다. 결제 화면에서는 상세 해몽+질문 2회 또는 추가 질문 2회의 상품 범위, 990원 단건 가격, 자동결제가 없다는 점, 콘텐츠 생성 시작 시점을 따로 알립니다.</p></> },
  { id: "full", title: "2. 전액 환불", body: <><p>다음 경우 확인 후 결제수단으로 전액 환불합니다.</p><ul><li>결제됐지만 재시도 뒤에도 상세 해몽 또는 구매한 질문 이용권이 제공되지 않은 경우</li><li>동일 주문이 중복 승인된 경우</li><li>기술 오류로 본문이 비어 있거나 정상적으로 읽을 수 없는 경우</li><li>서버가 복구할 수 없는 콘텐츠 생성 실패를 확인한 경우</li></ul></> },
  { id: "withdrawal", title: "3. 청약철회 안내", body: <><p>개인 입력을 바탕으로 즉시 만들어지는 디지털 콘텐츠는 사용자의 사전 동의 아래 제공이 시작된 뒤 관련 법령에 따라 청약철회가 제한될 수 있습니다. 다만 표시·광고와 다른 제공, 미제공, 중복결제, 기술 오류에 대한 권리는 제한하지 않습니다.</p></> },
  { id: "request", title: "4. 요청 방법과 처리", body: <><p>결제 주문번호와 오류 상황을 고객지원 이메일 {business.email}로 알려주면 결제 기록과 제공 상태를 확인합니다. 접수 내용을 확인한 뒤 처리 일정과 결과를 같은 연락 수단으로 안내합니다.</p></> }
  ];
}

export default function RefundPage() {
  return <PolicyPage title="환불정책" description="미제공·중복결제·기술 오류는 분명하게 환불하고, 맞춤형 콘텐츠의 시작 시점은 결제 전에 따로 알립니다." sections={refundSections()} />;
}
