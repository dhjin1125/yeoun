import { hasUnsafeClaim } from "./safety";
import { observedDreamText } from "./dream-evidence";
import { resolveSourceQuote } from "./evidence-quote";
import { referenceMatchesSymbol, type CulturalReference } from "./cultural-references";

type SymbolMeaning = { name: string; evidence: string; title: string; meaning: string; referenceIds?: string[] };
export type ComposedReading = {
  symbols: SymbolMeaning[];
  integratedReading: { title: string; paragraphs: string[]; evidenceQuotes: string[] } | null;
  nextQuestion: string | null;
};
export type SymbolicGroundingIssue = {
  field: "symbols.name" | "symbols.evidence" | "integratedReading.evidenceQuotes";
  index: number;
  reason: "quote_format" | "quote_not_found" | "name_outside_evidence" | "inactive_evidence";
  action: "normalized" | "repair_required";
  quoteLength: number;
};

/** Normalize evidence only. Preserve the authored headings, prose and composition. */
export function prepareSymbolicEvidence(reading: ComposedReading, source: string) {
  const issues: SymbolicGroundingIssue[] = [];
  const active = observedDreamText(source);
  const resolve = (quote: string, allowed: string, field: SymbolicGroundingIssue["field"], index: number) => {
    const resolved = resolveSourceQuote(quote, [allowed]);
    if (resolved !== quote) issues.push({
      field, index, quoteLength: quote.length,
      reason: resolved !== null ? "quote_format" : field === "symbols.name" && resolveSourceQuote(quote, [source]) !== null
        ? "name_outside_evidence" : field === "integratedReading.evidenceQuotes" && resolveSourceQuote(quote, [source]) !== null
        ? "inactive_evidence" : "quote_not_found",
      action: resolved !== null ? "normalized" : "repair_required"
    });
    return resolved ?? quote;
  };
  const prepared: ComposedReading = {
    ...reading,
    symbols: reading.symbols.map((symbol, index) => {
      const evidence = resolve(symbol.evidence, source, "symbols.evidence", index);
      const name = resolve(symbol.name, evidence, "symbols.name", index);
      if (source.includes(name) && !active.includes(name)) issues.push({
        field:"symbols.name",index,quoteLength:name.length,reason:"inactive_evidence",action:"repair_required"
      });
      return { ...symbol, name, evidence };
    }),
    integratedReading: reading.integratedReading ? {
      ...reading.integratedReading,
      evidenceQuotes: reading.integratedReading.evidenceQuotes.map((quote, index) => resolve(quote, active, "integratedReading.evidenceQuotes", index))
    } : null
  };
  return { reading: prepared, issues };
}
const TRADITION = /전통(?:적|적인|\s*해몽|\s*해석)|예부터|동양에서는|민속|문화적/;
const EMOTION_REPLACES_SYMBOL = /(?:상징|장소|대상)[^.!?\n]{0,30}보다[^.!?\n]{0,35}(?:감정|기분|태도|행복)[^.!?\n]{0,20}(?:더\s*크게|더\s*중요|중심)|(?:상징|대상)[^.!?\n]{0,15}(?:상관없이|중요하지)/;
const DISCLAIMER = /(?:예고|예측)하지(?:는|도)?\s*않|(?:단정|확정|판단|예측|예고)할\s*수(?:는|도|가)?\s*없|실제로\s*일어난다는\s*뜻(?:은|이)?\s*아니/;

const GENERIC = /감정|변화|흐름|경계|상황|관계|마음|가능성/g;
const FILLER = /^(?:감정|변화|흐름|경계|상황|관계|마음|가능성|상징|의미|나타|보여|표현|읽|있|없|어떤|여러|통해|대한|대해|떠올|같은|이런|그런|하나|새로운|새롭게|살펴|느낄|느끼|기도|하는|되는|있어요|있습니다|해요)/;

function bodyTerms(symbol: SymbolMeaning) {
  let body = symbol.meaning;
  const labels = [symbol.name, ...symbol.title.replace(/의 상징|장면/g, "").split(/\s+/)].filter(Boolean);
  for (const label of labels) body = body.replaceAll(label, "");
  return (body.match(/[가-힣]{2,}/g) ?? []).filter(word => !FILLER.test(word));
}

function proseGrams(symbol: SymbolMeaning) {
  const text = symbol.meaning.replaceAll(symbol.name, "").replace(/[^가-힣]/g, "");
  return new Set(Array.from({length: Math.max(0,text.length-2)},(_,i)=>text.slice(i,i+3)));
}

export function symbolicOutputError(symbols: SymbolMeaning[], source: string, references: CulturalReference[] = [], answeringOutcomeQuestion = false, deferStyleToReview = false): string | null {
  const titles = new Set<string>();
  const active = observedDreamText(source);
  const prior: Set<string>[] = [];
  let formulaicEntries = 0;
  for (const [symbolIndex, symbol] of symbols.entries()) {
    if (!source.includes(symbol.name) || !source.includes(symbol.evidence) || !symbol.evidence.includes(symbol.name)) return "AI_SYMBOL_UNGROUNDED";
    if (!active.includes(symbol.name)) return "AI_SYMBOL_SUPERSEDED_OR_QUOTED";
    if (!deferStyleToReview && symbol.name.length > 2 && /(?:고|는데|면서|다가)$/.test(symbol.name) && symbol.title === `${symbol.name}의 상징`) return "AI_SYMBOL_FRAGMENT_TITLE";
    const hits = /때리|때렸/.test(symbol.evidence);
    const receives = /맞는|맞았|맞고/.test(symbol.evidence);
    if (hits && !receives && /공격받|폭행당/.test(symbol.meaning)) return "AI_SYMBOL_REVERSED_ACTION";
    if (hits && !receives && /맞는|맞음/.test(symbol.title)) return "AI_SYMBOL_REVERSED_ACTION";
    if (hits && !receives && /^(?:꿈에서\s*)?(?:(?:누군가|상대|다른 사람)에게\s*)?맞는\s*장면/.test(symbol.meaning)) return "AI_SYMBOL_REVERSED_ACTION";
    if (receives && !hits && /때리는|때림/.test(symbol.title)) return "AI_SYMBOL_REVERSED_ACTION";
    if (hasUnsafeClaim(symbol.meaning)) return "AI_SYMBOL_UNSAFE_CLAIM";
    const used = symbol.referenceIds ?? [];
    if (used.some(id => !references.some(reference => reference.id === id && referenceMatchesSymbol(reference, symbol.evidence)))) return "AI_SYMBOL_UNGROUNDED_SOURCE";
    if (TRADITION.test(symbol.meaning) && !used.length) return "AI_SYMBOL_UNSOURCED_TRADITION";
    if (EMOTION_REPLACES_SYMBOL.test(symbol.meaning)) return "AI_SYMBOL_EMOTION_REPLACEMENT";
    if (/전통적 관점에서는/.test(symbol.meaning) && /상징적(?:인)? 해석으로는|상징적으로는/.test(symbol.meaning)) {
      formulaicEntries += 1;
      if (!deferStyleToReview && formulaicEntries > 1) return "AI_SYMBOL_FORMULAIC";
    }
    if (!deferStyleToReview && (/상징적으로 나타내는 관점|단정하지 않는 해석/.test(symbol.meaning)
      || ((symbol.meaning.match(GENERIC)?.length ?? 0) >= 4 && new Set(bodyTerms(symbol)).size <= 2))) return "AI_SYMBOL_ABSTRACT";
    const grams = proseGrams(symbol);
    if (!deferStyleToReview && prior.some(other => grams.size > 15 && [...grams].filter(gram=>other.has(gram)).length / Math.min(grams.size, other.size) > 0.8)) return "AI_SYMBOL_REPETITIVE";
    const sentences = symbol.meaning.trim().split(/(?<=[.!?。！？])\s+/u);
    // Answer an explicit worry once, in the first sentence. Repeated or
    // unsolicited disclaimers still fail; all grounding/safety gates above remain.
    if (sentences.some((sentence, sentenceIndex) => DISCLAIMER.test(sentence)
      && !(answeringOutcomeQuestion && symbolIndex === 0 && sentenceIndex === 0))) return "AI_SYMBOL_DISCLAIMER";
    if (sentences.some(sentence => !/(?:요|죠|니다|다)[.!?。！？]?[”’"')\]]*$/u.test(sentence))) return "AI_SYMBOL_UNFINISHED";
    if (!deferStyleToReview && titles.has(symbol.title)) return "AI_SYMBOL_DUPLICATE";
    titles.add(symbol.title);
    prior.push(grams);
  }
  return null;
}

/** Source/structure gates share one path across familiar and uncatalogued dreams.
 * These checks are not a guarantee of semantic correctness or writing quality. */
export function symbolFirstReadingError(reading: ComposedReading, source: string, references: CulturalReference[], answeringOutcomeQuestion = false, deferStyleToReview = false) {
  const symbolError = symbolicOutputError(reading.symbols, source, references, answeringOutcomeQuestion, deferStyleToReview);
  if (symbolError || !reading.symbols.length) return symbolError;
  const integrated = reading.integratedReading;
  if (!integrated?.paragraphs.length) return "AI_SYMBOL_MISSING_INTEGRATION";
  const active = observedDreamText(source);
  if (!integrated.evidenceQuotes.length || integrated.evidenceQuotes.some(quote => !active.includes(quote))) return "AI_SYMBOL_UNGROUNDED_INTEGRATION";
  // Reviewed cultural meaning must not vanish into generic emotion copy.
  for (const symbol of reading.symbols) {
    const matchingReferences = references.filter(reference => referenceMatchesSymbol(reference, symbol.evidence));
    if (matchingReferences.length && !matchingReferences.some(reference =>
      symbol.referenceIds?.includes(reference.id) && reference.meaningTerms.some(term => symbol.meaning.includes(term)))) return "AI_SYMBOL_MISSING_BASE_MEANING";
  }
  const copy = [...reading.symbols.map(symbol => symbol.meaning), ...integrated.paragraphs].join("\n");
  const displayedCopy = [copy, ...reading.symbols.map(symbol => symbol.title), integrated.title, reading.nextQuestion ?? ""].join("\n");
  if (copy.length > 1400) return "AI_SYMBOL_TOO_LONG";
  if (EMOTION_REPLACES_SYMBOL.test(copy)) return "AI_SYMBOL_EMOTION_REPLACEMENT";
  if (hasUnsafeClaim(displayedCopy)) return "AI_SYMBOL_UNSAFE_CLAIM";
  if (/장면\s*장면|꿈에서의\s*꿈에서|아직 구체적이지 않은|culturalReferences|referenceIds|프롬프트/.test(displayedCopy)) return "AI_SYMBOL_INTERNAL_COPY";
  if (TRADITION.test(integrated.paragraphs.join(" ")) && !reading.symbols.some(symbol => symbol.referenceIds?.length)) return "AI_SYMBOL_UNSOURCED_TRADITION";
  if (integrated.paragraphs.some(paragraph => paragraph.trim().split(/(?<=[.!?。！？])\s+/u)
    .some(sentence => !/(?:요|죠|니다|다)[.!?。！？]?[”’"')\]]*$/u.test(sentence)))) return "AI_SYMBOL_UNFINISHED";
  if (DISCLAIMER.test(integrated.paragraphs.join(" "))) return "AI_SYMBOL_DISCLAIMER";
  return null;
}
