import { accessGateEnabled, accessGatePassed } from "@/lib/access-gate";
import { aiGenerationDisabled } from "@/lib/app-profile";
import { AccessGateForm } from "@/components/access-gate-form";
import { DreamExperience } from "@/components/dream-experience";
import { HomeIntroOverlay } from "@/components/home-intro-overlay";
import { NodeOffReviewEntryGate } from "@/components/nodeoff-review-entry-gate";
import { JournalPageShell } from "@/components/journal-page-shell";
import { resolveDreamEntry } from "@/lib/dream-entry";
import { readLocalDreamTestExamples } from "@/lib/dream-test-examples";
import { nodeOffReviewSiteEnabled } from "@/lib/nodeoff-review";
import type { Metadata } from "next";

export const metadata: Metadata = { alternates: { canonical: "/" } };

// The access gate must be evaluated per request: when its env vars are absent
// at build time the early return never touches cookies(), so the page would be
// prerendered statically and the gate form would never appear at runtime.
export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ source?: string | string[]; topic?: string | string[] }> }) {
  const gated = accessGateEnabled() && !(await accessGatePassed());
  const nodeOffReviewSite = nodeOffReviewSiteEnabled();
  const entry = resolveDreamEntry(await searchParams);
  const dreamTestExamples = await readLocalDreamTestExamples();
  if (aiGenerationDisabled()) return (
    <JournalPageShell>
      <section className="ai-pause-notice" aria-labelledby="ai-pause-title">
        <p className="record-kicker">서비스 안내</p>
        <h1 id="ai-pause-title">새 꿈 해몽을 잠시 쉬고 있어요</h1>
        <p>현재 새 해몽과 상세 결제를 받지 않습니다. 이미 받은 결과는 기존 보관 링크에서 계속 볼 수 있어요.</p>
      </section>
    </JournalPageShell>
  );
  return (
    <>
      <HomeIntroOverlay />
      <JournalPageShell>
        {nodeOffReviewSite ? (
          <NodeOffReviewEntryGate><DreamExperience entry={entry} testExamples={dreamTestExamples} /></NodeOffReviewEntryGate>
        ) : gated ? <AccessGateForm /> : <DreamExperience entry={entry} testExamples={dreamTestExamples} />}
      </JournalPageShell>
    </>
  );
}
