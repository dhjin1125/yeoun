import { z } from "zod";
import { observedDreamText, unquotedText } from "../dream-evidence";
import type { ComposedReading } from "../symbolic-output";
import { symbolicFreeSchema } from "./schemas";

const evidenceRefSchema = z.object({ startId: z.string().min(1).max(16), endId: z.string().min(1).max(16) }).strict();
export const symbolicFreeByIdSchema = symbolicFreeSchema.extend({
  symbols: z.array(symbolicFreeSchema.shape.symbols.element.omit({ name: true, evidence: true }).extend({ evidenceRef: evidenceRefSchema }).strict()).max(4),
  integratedReading: symbolicFreeSchema.shape.integratedReading.unwrap().omit({ evidenceQuotes: true }).extend({
    evidenceRefs: z.array(evidenceRefSchema).min(1).max(6)
  }).strict().nullable()
}).strict();
export type FreeReadingById = z.infer<typeof symbolicFreeByIdSchema>;
export type EvidenceToken = { id: string; text: string; start: number; end: number };
type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type InvalidEvidenceRef = { field: "symbols" | "integratedReading"; index: number };

export const freeEvidenceRepairSchema = z.object({
  replacements: z.array(z.object({ field: z.enum(["symbols", "integratedReading"]), index: z.number().int().min(0).max(5), evidenceRef: evidenceRefSchema }).strict()).min(1).max(10)
}).strict();

export const FREE_EVIDENCE_INSTRUCTION = `
근거 출력 계약: evidenceCatalog는 프로그램이 원문 어절에 붙인 번호다. symbols에서는 name/evidence 대신 evidenceRef={startId,endId}, integratedReading에서는 evidenceQuotes 대신 evidenceRefs를 반환한다. 한 어절이면 두 ID가 같다. 원문을 다시 적거나 ID를 만들지 않는다. 시작부터 끝까지 연속된 원문 범위를 선택한다. 상징 근거는 100자 이내, 통합 근거는 140자 이내이며, 인용된 대사·정정으로 폐기된 장면을 넘나들지 않는다. 상징마다 실제로 설명하는 대상·행동이 담긴 짧은 범위를 고른다. 근거 ID는 사용자에게 보일 제목·본문·질문에 넣지 않는다. 이 출력 계약과 제공된 JSON Schema가 이전 인용 필드 지침보다 우선한다.
`.trim();

/** Offsets refer to the original string; quoted speech is masked without shifting it. */
export function buildFreeEvidenceCatalog(source: string): EvidenceToken[] {
  const active = observedDreamText(source);
  return [...unquotedText(source).matchAll(/[^\s.!?。！？]+/gu)]
    .filter(match => active.includes(match[0]))
    .flatMap(match => {
      // A long unspaced input must still have selectable ranges below the
      // quote limit. Split on code points so surrogate pairs stay intact.
      const spans: Omit<EvidenceToken, "id">[] = [];
      let start = match.index;
      let text = "";
      for (const character of match[0]) {
        if (text.length + character.length > 60) {
          spans.push({ text, start, end: start + text.length });
          start += text.length;
          text = "";
        }
        text += character;
      }
      if (text) spans.push({ text, start, end: start + text.length });
      return spans;
    })
    .map((span, index) => ({ id: `E${index + 1}`, ...span }));
}

function sourceQuote(ref: EvidenceRef, catalog: EvidenceToken[], source: string, maxLength: number) {
  const start = catalog.find(token => token.id === ref.startId);
  const end = catalog.find(token => token.id === ref.endId);
  if (!start || !end || start.start > end.start) return null;
  const quote = source.slice(start.start, end.end);
  if (!quote || quote.length > maxLength || !observedDreamText(source).includes(quote)
    || unquotedText(source).slice(start.start, end.end) !== quote) return null;
  return quote;
}

export function invalidFreeEvidenceRefs(reading: FreeReadingById, catalog: EvidenceToken[], source: string): InvalidEvidenceRef[] {
  return [
    ...reading.symbols.flatMap((symbol, index) => sourceQuote(symbol.evidenceRef, catalog, source, 100) ? [] : [{ field: "symbols" as const, index }]),
    ...(reading.integratedReading?.evidenceRefs.flatMap((ref, index) => {
      const quote = sourceQuote(ref, catalog, source, 140);
      return quote && quote.length >= 2 ? [] : [{ field: "integratedReading" as const, index }];
    }) ?? [])
  ];
}

/** Only invalid selections can change. Headings and prose never come from the repair. */
export function repairFreeEvidenceRefs(reading: FreeReadingById, repair: z.infer<typeof freeEvidenceRepairSchema>, catalog: EvidenceToken[], source: string): FreeReadingById {
  const invalid = invalidFreeEvidenceRefs(reading, catalog, source);
  const key = (item: InvalidEvidenceRef) => `${item.field}:${item.index}`;
  const expected = new Set(invalid.map(key));
  const replacements = freeEvidenceRepairSchema.parse(repair).replacements;
  if (replacements.length !== expected.size || new Set(replacements.map(key)).size !== expected.size
    || replacements.some(item => !expected.has(key(item)))) throw new Error("AI_SYMBOL_INVALID_EVIDENCE_REPAIR");
  const result = structuredClone(reading);
  for (const item of replacements) {
    if (item.field === "symbols") result.symbols[item.index].evidenceRef = item.evidenceRef;
    else result.integratedReading!.evidenceRefs[item.index] = item.evidenceRef;
  }
  if (invalidFreeEvidenceRefs(result, catalog, source).length) throw new Error("AI_SYMBOL_INVALID_EVIDENCE_REPAIR");
  return result;
}

export function hydrateFreeEvidence(reading: FreeReadingById, catalog: EvidenceToken[], source: string): ComposedReading {
  if (invalidFreeEvidenceRefs(reading, catalog, source).length) throw new Error("AI_SYMBOL_INVALID_EVIDENCE_REF");
  return {
    symbols: reading.symbols.map(({ evidenceRef, ...symbol }) => {
      const evidence = sourceQuote(evidenceRef, catalog, source, 100)!;
      // name is internal to the legacy validators; the authored title is displayed.
      const name = Array.from(evidence).slice(0, 20).join("");
      return { ...symbol, name, evidence };
    }),
    integratedReading: reading.integratedReading ? {
      title: reading.integratedReading.title,
      paragraphs: reading.integratedReading.paragraphs,
      evidenceQuotes: [...new Set(reading.integratedReading.evidenceRefs.map(ref => sourceQuote(ref, catalog, source, 140)!))]
    } : null,
    nextQuestion: reading.nextQuestion
  };
}
