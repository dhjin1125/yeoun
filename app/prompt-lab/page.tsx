import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JournalPageShell } from "@/components/journal-page-shell";
import { AccessGateForm } from "@/components/access-gate-form";
import { PromptLab } from "@/components/prompt-lab";
import { accessGatePassed } from "@/lib/access-gate";
import { promptLabAvailable } from "@/lib/prompt-lab";
import { PAID_READING_PROMPT } from "@/lib/ai/prompts";
import { localCodexConfigured, localCodexModelLabel } from "@/lib/ai/codex-local";
import { effectiveAiMode } from "@/lib/app-profile";
import { promptLabArchive } from "@/lib/prompt-lab-archive";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {title:"프롬프트 실험실 · 여운",robots:{index:false,follow:false}};

export default async function PromptLabPage() {
  if (!promptLabAvailable()) notFound();
  const model = localCodexConfigured() ? localCodexModelLabel("detailed") : effectiveAiMode() === "openai" ? process.env.OPENAI_PAID_MODEL ?? "gpt-5.4-mini" : "AI 연결 없음";
  const archive=await promptLabArchive.list().catch(()=>[]);
  const initialNextExperimentId=Math.max(0,...archive.flatMap(item=>[item.experimentId??0,...item.runIds]))+1;
  return <JournalPageShell>{await accessGatePassed() ? <PromptLab initialInstructions={PAID_READING_PROMPT} model={model} initialNextExperimentId={initialNextExperimentId} /> : <AccessGateForm />}</JournalPageShell>;
}
