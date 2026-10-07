import type { z } from "zod";
import type { consultationPlanSchema } from "./schemas";
import { resolveSourceQuote } from "../evidence-quote";

export type FactCheckPlan = z.infer<typeof consultationPlanSchema>;
export type FactCheckIssue = {
  field: "facts" | "keyElements" | "supportedTopics";
  index: number;
  topic?: FactCheckPlan["supportedTopics"][number]["topic"];
  reason: "quote_format" | "outside_allowed_sources" | "quote_not_found";
  action: "normalized" | "omitted" | "reclassified_as_reality" | "repair_required";
  quoteLength: number;
};

export function checkFactPlan(plan: FactCheckPlan, sources: {
  dream: string[];
  reality: string[];
  original: string[];
  /** Only explicitly scoped, active waking evidence; never the whole original. */
  explicitReality?: string[];
}) {
  const issues: FactCheckIssue[] = [];
  const realityDuplicates = new Set(plan.supportedTopics.filter(item => item.topic === "reality")
    .map(item => resolveSourceQuote(item.evidence, sources.reality) !== null
      ? resolveSourceQuote(item.evidence, sources.explicitReality ?? []) : null)
    .filter((quote): quote is string => quote !== null));
  // Keep at least one grounded dream fact. Do not turn an all-waking/invented
  // plan into a ready dream plan by deleting its core evidence.
  const hasDreamFact = plan.facts.some(quote => resolveSourceQuote(quote, sources.dream) !== null);
  const reclassified = new Set<number>();
  const resolve = (quote: string, field: FactCheckIssue["field"], index: number, topic?: FactCheckIssue["topic"]) => {
    const allowed = topic === "reality" ? sources.reality : sources.dream;
    const resolved = resolveSourceQuote(quote, allowed);
    const wakingQuote = field === "facts" && resolved === null && hasDreamFact
      ? resolveSourceQuote(quote, sources.explicitReality ?? []) : null;
    const duplicateReality = wakingQuote !== null && realityDuplicates.has(wakingQuote);
    if (duplicateReality) reclassified.add(index);
    if (resolved !== quote) {
      issues.push({
        field, index, ...(topic ? { topic } : {}), quoteLength: quote.length,
        reason: resolved !== null ? "quote_format"
          : resolveSourceQuote(quote, sources.original) !== null ? "outside_allowed_sources" : "quote_not_found",
        action: resolved !== null ? "normalized" : duplicateReality ? "reclassified_as_reality"
          : field === "supportedTopics" ? "omitted" : "repair_required"
      });
    }
    return resolved;
  };
  const checked: FactCheckPlan = {
    ...plan,
    facts: plan.facts.flatMap((quote, index) => {
      const resolved = resolve(quote, "facts", index);
      return reclassified.has(index) ? [] : [resolved ?? quote];
    }),
    keyElements: plan.keyElements.map((item, index) => ({
      ...item, evidence: resolve(item.evidence, "keyElements", index) ?? item.evidence
    })),
    // Topics only select optional report sections. An unsupported topic is
    // removed entirely; its quote is never promoted into accepted evidence.
    supportedTopics: plan.supportedTopics.flatMap((item, index) => {
      const evidence = resolve(item.evidence, "supportedTopics", index, item.topic);
      return evidence === null ? [] : [{ ...item, evidence }];
    })
  };
  const blocking = issues.find(issue => issue.action === "repair_required");
  return {
    plan: checked,
    issues,
    errorCode: blocking ? `AI_FACT_CHECK_UNGROUNDED_${blocking.field === "facts" ? "FACT" : "ELEMENT"}` : null
  };
}

type FactCheckOutcome = "accepted" | "adjusted" | "repair_requested" | "rejected" | "provider_error";

/** Explicit metadata allowlist: never log input, generated prose or provider errors. */
export function logFactCheck(input: {
  requestId: string;
  attempt: number;
  outcome: FactCheckOutcome;
  startedAt: number;
  attemptStartedAt: number;
  issues: FactCheckIssue[];
  errorCode?: string | null;
  repairSkipped?: "latency_budget" | "attempt_limit";
  acceptedFactCount?: number;
  acceptedElementCount?: number;
  acceptedTopicCount?: number;
  disposition?: string;
}) {
  try {
    console.info(JSON.stringify({
      event: "dream_fact_check",
      version: 1,
      timestamp: new Date().toISOString(),
      requestId: input.requestId,
      attempt: input.attempt,
      outcome: input.outcome,
      ...(input.disposition ? { disposition: input.disposition } : {}),
      durationMs: Date.now() - input.startedAt,
      attemptDurationMs: Date.now() - input.attemptStartedAt,
      errorCode: input.errorCode ?? null,
      repairSkipped: input.repairSkipped ?? null,
      acceptedFactCount: input.acceptedFactCount ?? 0,
      acceptedElementCount: input.acceptedElementCount ?? 0,
      acceptedTopicCount: input.acceptedTopicCount ?? 0,
      issues: input.issues.map(issue => ({
        field: issue.field, index: issue.index, topic: issue.topic,
        reason: issue.reason, action: issue.action, quoteLength: issue.quoteLength
      }))
    }));
  } catch {
    // Diagnostics must not turn an otherwise valid reading into a failed request.
  }
}
