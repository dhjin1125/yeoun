"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AccessGateForm } from "@/components/access-gate-form";

type GateStatus = "checking" | "locked" | "open" | "error";

export function NodeOffReviewEntryGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<GateStatus>("checking");

  const checkGate = useCallback(async () => {
    setStatus("checking");
    try {
      const response = await fetch("/api/access", { cache: "no-store" });
      const result = (await response.json()) as { required?: boolean; passed?: boolean };
      if (!response.ok) throw new Error("입장 상태를 확인하지 못했어요.");
      setStatus(!result.required || result.passed ? "open" : "locked");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void checkGate();
  }, [checkGate]);

  if (status === "open") return children;
  if (status === "locked") return <AccessGateForm onUnlocked={() => setStatus("open")} />;
  if (status === "error") {
    return (
      <section className="entry-gate-status" aria-live="polite">
        <p role="alert">입장 상태를 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.</p>
        <button className="secondary-button" type="button" onClick={() => void checkGate()}>다시 확인</button>
      </section>
    );
  }
  return <p className="entry-gate-status" role="status" aria-live="polite">입장 상태를 확인하고 있어요.</p>;
}
