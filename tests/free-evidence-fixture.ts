import { buildFreeEvidenceCatalog, type FreeReadingById } from "@/lib/ai/free-evidence";
import { splitDreamEvidence } from "@/lib/dream-evidence";
import { resolveSourceQuote } from "@/lib/evidence-quote";
import type { ComposedReading } from "@/lib/symbolic-output";

/** Migrate authored fixtures to the provider's ID contract, without teaching
 * production code to accept model-written quotes. */
export function byIdFixture(reading: ComposedReading, original: string): FreeReadingById {
  const source = splitDreamEvidence(original).dreamText;
  const catalog = buildFreeEvidenceCatalog(source);
  const ref = (quote: string, max: number) => {
    const literal = resolveSourceQuote(quote, [source]);
    const start = literal === null ? -1 : source.indexOf(literal);
    const selected = start < 0 ? [] : catalog.filter(t => t.end > start && t.start < start + literal!.length);
    const first = selected[0];
    const last = selected.filter(t => first && t.end - first.start <= max).at(-1);
    return { startId: first?.id ?? "INVALID", endId: last?.id ?? "INVALID" };
  };
  return {
    symbols: reading.symbols.map(({ name: _name, evidence, ...s }) => ({ ...s, referenceIds: s.referenceIds ?? [], evidenceRef: ref(evidence, 100) })),
    integratedReading: reading.integratedReading ? {
      title: reading.integratedReading.title, paragraphs: reading.integratedReading.paragraphs,
      evidenceRefs: reading.integratedReading.evidenceQuotes.map(quote => ref(quote, 140))
    } : null,
    nextQuestion: reading.nextQuestion
  };
}
