import { Suspense } from "react";
import { PaymentSuccess } from "@/components/payment-return";

export default function PaymentSuccessPage() {
  return <Suspense fallback={null}><PaymentSuccess /></Suspense>;
}
