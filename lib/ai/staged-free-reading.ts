import { createHash } from "node:crypto";
import { hasUnsafeClaim } from "../safety";
import { stagedFreeReadingV3Schema } from "./schemas";
import type { StagedFreeReadingV3Content } from "../types";

const QUESTION_CTA = /(?:어떤\s*(?:다른\s*)?(?:의미|면|뜻)[^.!?？\n]{0,12}(?:까요|까)|함께\s*살펴보세요|전체\s*해몽(?:에서)?\s*확인|더\s*알아보세요|이어\s*확인해보세요|더\s*깊게\s*살펴보세요|결제하면|유료\s*해몽)/u;

export function normalizeStagedFreeEvidence(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

export function stagedFreeReadingV3VisibleBodyCharacterCount(value: unknown) {
  const parsed = stagedFreeReadingV3Schema.safeParse(value);
  if (!parsed.success) return 0;
  const paragraphs = [
    ...parsed.data.primarySection.paragraphs,
    ...parsed.data.secondarySection.paragraphs
  ];
  return Array.from(paragraphs.join("")).length;
}

function visibleText(reading: StagedFreeReadingV3Content) {
  return [
    reading.title,
    reading.primarySection.heading,
    ...reading.primarySection.paragraphs,
    reading.secondarySection.heading,
    ...reading.secondarySection.paragraphs
  ];
}

function sameCoverageAxis(
  left: StagedFreeReadingV3Content["coverage"]["primary"],
  right: StagedFreeReadingV3Content["coverage"]["secondary"]
) {
  const evidenceKey = (quotes: string[]) => quotes.map(normalizeStagedFreeEvidence).sort().join("\u0000");
  return normalizeStagedFreeEvidence(left.label) === normalizeStagedFreeEvidence(right.label)
    && evidenceKey(left.evidenceQuotes) === evidenceKey(right.evidenceQuotes);
}

export function stagedFreeReadingV3Error(candidate: unknown, source: string): string | null {
  const result = stagedFreeReadingV3Schema.safeParse(candidate);
  if (!result.success) return "AI_STAGED_FREE_V3_SCHEMA";
  const reading = result.data;
  const texts = visibleText(reading);
  if (texts.some(text => !text.trim())) return "AI_STAGED_FREE_V3_EMPTY_CONTENT";

  const distinctHeadings = new Set([
    reading.title,
    reading.primarySection.heading,
    reading.secondarySection.heading
  ].map(text => normalizeStagedFreeEvidence(text).toLocaleLowerCase()));
  if (distinctHeadings.size !== 3) return "AI_STAGED_FREE_V3_DUPLICATE_HEADING";
  if (texts.some(text => /[?？]/u.test(text) || QUESTION_CTA.test(text))) return "AI_STAGED_FREE_V3_CTA";

  const bodyCharacters = stagedFreeReadingV3VisibleBodyCharacterCount(reading);
  if (bodyCharacters < 350 || bodyCharacters > 550) return "AI_STAGED_FREE_V3_BODY_LENGTH";

  if (sameCoverageAxis(reading.coverage.primary, reading.coverage.secondary)) return "AI_STAGED_FREE_V3_DUPLICATE_COVERAGE";

  const normalizedSource = normalizeStagedFreeEvidence(source);
  const coverageItems = [
    reading.coverage.primary,
    reading.coverage.secondary,
    ...reading.coverage.reserved
  ];
  if (coverageItems.some(item => item.evidenceQuotes.some(quote => {
    const normalizedQuote = normalizeStagedFreeEvidence(quote);
    return !normalizedQuote || !normalizedSource.includes(normalizedQuote);
  }))) return "AI_STAGED_FREE_V3_UNGROUNDED_EVIDENCE";

  if (hasUnsafeClaim(texts.join("\n"))) return "AI_STAGED_FREE_V3_UNSAFE_CLAIM";
  return null;
}

export function sha256GenerationInstruction(instructionText: string) {
  return createHash("sha256").update(instructionText, "utf8").digest("hex");
}
