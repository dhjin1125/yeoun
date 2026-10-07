import { z } from "zod";
import type { AssistantTurnPayload } from "../types";

export const PAID_PIPELINE_VERSION = "grounded-recovery-v1";
export const paidTargetSchema = z.enum(["directAnswer", "directAnswerTitle", "section:0", "section:1", "section:2", "section:3", "interpretationChanges", "suggestedQuestions", "evidenceQuotes", "referenceIds"]);
export const groundedPaidReviewSchema = z.object({
  approved: z.boolean(),
  headlineAnswered: z.boolean(),
  correctionApplied: z.boolean(),
  addsValueBeyondFree: z.boolean(),
  offerCoverage: z.array(z.object({ key: z.enum(["traditional", "psychology", "pattern", "action"]), fulfilled: z.boolean() })).length(4),
  findings: z.array(z.object({
    kind: z.enum(["fact_conflict", "unsupported_fact", "missing_content", "repetition", "unanswered_question", "correction_missing", "source_mismatch", "local_rule"]),
    target: paidTargetSchema,
    quote: z.string().max(1400).nullable(),
    basis: z.enum(["contradicts_source", "not_in_sources", "delivery_requirement", "local_rule"]),
    evidence: z.array(z.object({ sourceId: z.string(), quote: z.string().min(1).max(700) })).max(4),
    explanation: z.string().min(8).max(600),
    requiredChange: z.string().min(8).max(600)
  })).max(10)
});
export type GroundedPaidReview = z.infer<typeof groundedPaidReviewSchema>;
export type PaidFinding = GroundedPaidReview["findings"][number];
export type PaidEvidence = { id: string; kind: string; text: string };
export type PaidPipelineState = {
  version: typeof PAID_PIPELINE_VERSION;
  stage: "draft" | "review" | "repair" | "accepted";
  report: AssistantTurnPayload | null;
  review: GroundedPaidReview | null;
  findings: PaidFinding[];
  repairs: number;
  reviewCorrections: number;
  reviewProblems: string[];
  localError: string | null;
};
export type PaidPipelinePersistence = {
  state?: PaidPipelineState | null;
  save(state: PaidPipelineState): Promise<void>;
  record?(payload: Record<string, unknown>): Promise<void>;
};

export class PaidPipelineError extends Error {
  constructor(public readonly code: string, public readonly retryable = false) {
    super(code);
    this.name = "PaidPipelineError";
  }
}

export function paidField(report: AssistantTurnPayload, target: string): unknown {
  if (target.startsWith("section:")) return report.sections[Number(target.slice(8))];
  if (target === "referenceIds") return (report as AssistantTurnPayload & {referenceIds?: string[]}).referenceIds ?? (report.sources ?? []).map(source => source.id);
  return report[target as keyof AssistantTurnPayload];
}

function fieldText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(fieldText).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(fieldText).join("\n");
  return "";
}
const normalized = (value: string) => value.replace(/\s+/gu, " ").trim();

function normalizePaidReview(review: GroundedPaidReview): GroundedPaidReview {
  const findings = review.findings.filter(finding => finding.kind !== "repetition");
  const coverageComplete = review.offerCoverage.length === 4 && ["traditional", "psychology", "pattern", "action"]
    .every(key => review.offerCoverage.some(item => item.key === key && item.fulfilled));
  const approved = findings.length === 0 && coverageComplete && review.headlineAnswered && review.correctionApplied && review.addsValueBeyondFree;
  return { ...review, approved, findings };
}

/** Validate citations and decision consistency, never infer semantic truth from keywords. */
export function paidReviewProblems(review: GroundedPaidReview, report: AssistantTurnPayload, evidence: PaidEvidence[]) {
  const errors: string[] = [];
  const coverage = new Map(review.offerCoverage.map(item => [item.key, item.fulfilled]));
  const complete = coverage.size === 4 && ["traditional", "psychology", "pattern", "action"].every(key => coverage.get(key as "traditional") === true);
  // Repetition is an editorial preference. It cannot prevent delivery when
  // factual, safety, answer, correction, and paid-coverage requirements pass.
  const blockingFindings = review.findings.filter(finding => finding.kind !== "repetition");
  const expectedApproval = blockingFindings.length === 0 && complete && review.headlineAnswered && review.correctionApplied && review.addsValueBeyondFree;
  const styleOnlyRejection = review.findings.length > 0 && blockingFindings.length === 0 && expectedApproval && !review.approved;
  if (review.approved !== expectedApproval && !styleOnlyRejection) errors.push("approval_and_findings_disagree");
  if ((!complete || !review.headlineAnswered || !review.correctionApplied || !review.addsValueBeyondFree) && !blockingFindings.length) errors.push("rejection_needs_localized_findings");
  if (coverage.size !== 4) errors.push("duplicate_or_missing_coverage");
  if (!review.headlineAnswered && !blockingFindings.some(f => f.kind === "unanswered_question")) errors.push("headline_needs_finding");
  if (!review.correctionApplied && !blockingFindings.some(f => f.kind === "correction_missing")) errors.push("correction_needs_finding");
  for (const [index, f] of blockingFindings.entries()) {
    const text = fieldText(paidField(report, f.target));
    if (f.quote && !normalized(text).includes(normalized(f.quote))) errors.push(`finding:${index}:quote_not_in_target`);
    if (!f.quote?.trim() && !["missing_content", "correction_missing"].includes(f.kind)) errors.push(`finding:${index}:quote_required`);
    if (f.basis === "contradicts_source" && !f.evidence.length) errors.push(`finding:${index}:source_required`);
    for (const citation of f.evidence) {
      const source = evidence.find(item => item.id === citation.sourceId);
      if (!source || !normalized(source.text).includes(normalized(citation.quote))) errors.push(`finding:${index}:source_quote_invalid`);
    }
    if (["fact_conflict", "unsupported_fact"].includes(f.kind) && !["contradicts_source", "not_in_sources"].includes(f.basis)) errors.push(`finding:${index}:factual_basis_required`);
  }
  review.offerCoverage.forEach((item, index) => {
    if (!item.fulfilled && !blockingFindings.some(f => f.target === `section:${["traditional", "psychology", "pattern", "action"].indexOf(item.key)}`)) errors.push(`coverage:${index}:finding_required`);
  });
  return errors;
}

export type PaidPipelineAdapter = {
  evidence: PaidEvidence[];
  draft(): Promise<AssistantTurnPayload>;
  repair(report: AssistantTurnPayload, findings: PaidFinding[]): Promise<AssistantTurnPayload>;
  review(report: AssistantTurnPayload, state: PaidPipelineState): Promise<GroundedPaidReview>;
  normalize(report: AssistantTurnPayload): AssistantTurnPayload;
  localError(report: AssistantTurnPayload): string | null;
  localFindings?(report: AssistantTurnPayload, error: string): PaidFinding[];
  localTargets?(report: AssistantTurnPayload, error: string): string[];
};

export async function runPaidPipeline(adapter: PaidPipelineAdapter, persistence: PaidPipelinePersistence) {
  const state: PaidPipelineState = persistence.state ? structuredClone(persistence.state) : {
    version: PAID_PIPELINE_VERSION, stage: "draft", report: null, review: null,
    findings: [], repairs: 0, reviewCorrections: 0, reviewProblems: [], localError: null
  };
  if (state.version !== PAID_PIPELINE_VERSION) throw new PaidPipelineError("PAID_CHECKPOINT_VERSION");
  if (state.review) state.review = normalizePaidReview(state.review);
  const save = () => persistence.save(structuredClone(state));
  for (;;) {
    if (state.stage === "accepted") {
      if (!state.report || !state.review || !state.review.approved || adapter.localError(state.report) || paidReviewProblems(state.review, state.report, adapter.evidence).length) throw new PaidPipelineError("PAID_CHECKPOINT_INVALID");
      return state.report;
    }
    if (state.stage === "draft") {
      state.report = adapter.normalize(await adapter.draft());
      state.stage = "review";
      await save();
    }
    if (!state.report) throw new PaidPipelineError("PAID_CHECKPOINT_INVALID");
    if (state.stage === "repair") {
      if (state.repairs >= 3) throw new PaidPipelineError("PAID_REPAIR_EXHAUSTED");
      const previous = state.report;
      const revised = adapter.normalize(await adapter.repair(previous, state.findings));
      // The adapter must preserve all untargeted fields; independently verify it here.
      const targets = new Set(state.findings.map(f => f.target));
      for (const target of paidTargetSchema.options) {
        if (!targets.has(target) && JSON.stringify(paidField(previous, target)) !== JSON.stringify(paidField(revised, target))) throw new PaidPipelineError("PAID_PATCH_OUTSIDE_TARGET");
      }
      state.repairs += 1;
      state.report = revised;
      state.stage = "review";
      state.reviewCorrections = 0;
      state.reviewProblems = [];
      await save();
    }
    state.localError = adapter.localError(state.report);
    const review = normalizePaidReview(await adapter.review(state.report, state));
    // Concrete code diagnostics are repair instructions, not a request for the
    // reviewer to guess why its approval was rejected. Still re-review the patch.
    const localFindings = state.localError ? adapter.localFindings?.(state.report, state.localError) ?? [] : [];
    const findings = [...review.findings, ...localFindings.filter(local =>
      !review.findings.some(f => f.target === local.target && f.quote === local.quote))];
    const problems = paidReviewProblems(review, state.report, adapter.evidence);
    if (localFindings.length) problems.push(...paidReviewProblems({ ...review, approved: false, findings }, state.report, adapter.evidence));
    if (review.approved && state.localError && !localFindings.length) problems.push(`local_rule_unresolved:${state.localError}`);
    if (state.localError) for (const target of adapter.localTargets?.(state.report, state.localError) ?? []) {
      if (!findings.some(finding => finding.target === target)) problems.push(`local_rule_target_required:${target}`);
    }
    state.review = review;
    state.reviewProblems = problems;
    if (problems.length) {
      state.reviewCorrections += 1;
      await save();
      if (state.reviewCorrections >= 2) throw new PaidPipelineError("PAID_REVIEW_EVIDENCE_INVALID");
      continue; // Ask the reviewer to fix its evidence, not the writer to guess.
    }
    state.findings = findings;
    state.stage = review.approved && !state.localError ? "accepted" : "repair";
    await save();
  }
}
