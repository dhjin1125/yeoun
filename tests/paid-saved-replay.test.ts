/** Offline replay of a private, already generated production report. Never calls a model. */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { detailedQualityError, paidSceneRuleFindings, normalizePaidParagraphs } from "@/lib/ai";
const archive = process.env.PAID_SAVED_REPLAY;
it.skipIf(!archive)("rechecks the preserved production report without changing its text", () => {
  const saved = JSON.parse(readFileSync(archive!, "utf8"));
  const request = saved.events.find((e: {stage:string}) => e.stage === "request_context").details;
  const state = saved.events.filter((e: {stage:string}) => ["review","repair"].includes(e.stage)).at(-1).details;
  const before = JSON.stringify(state.report);
  const extra = [request.userContent.selectedEmotion, ...request.userContent.clarificationContext.filter((a: {skipped:boolean;answer:string}) => !a.skipped && a.answer).map((a:{answer:string})=>a.answer)].filter(Boolean).join("\n");
  const error = detailedQualityError(state.report,request.paidOffer,request.userContent.originalDream,request.dreamContext,extra);
  expect(error).toBeNull();
  expect(paidSceneRuleFindings(state.report,request.paidOffer,[request.userContent.originalDream,extra].join(" "))).toEqual([]);
  expect(JSON.stringify(state.report)).toBe(before);
  const normalized=normalizePaidParagraphs(state.report);
  expect(normalized.sections.map(s=>s.paragraphs.join(" "))).toEqual(state.report.sections.map((s:{paragraphs:string[]})=>s.paragraphs.join(" ")));
});
