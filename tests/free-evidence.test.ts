import { describe, expect, it } from "vitest";
import { buildFreeEvidenceCatalog, hydrateFreeEvidence, invalidFreeEvidenceRefs, repairFreeEvidenceRefs, symbolicFreeByIdSchema, type FreeReadingById } from "@/lib/ai/free-evidence";
import { symbolicOutputError } from "@/lib/symbolic-output";
import { observedDreamText } from "@/lib/dream-evidence";

const source = "친구와 오래된 역에 있었어요. 파란 기차를 기다렸어요";
const ref = { startId: "E1", endId: "E4" };
const draft: FreeReadingById = {
  symbols: [{ evidenceRef: ref, title: "역에서 기다리는 장면", meaning: "오래된 역에서 기다리는 모습은 익숙한 자리에서 다음 변화를 기다리는 마음과 연결해 볼 수 있어요.", referenceIds: [] }],
  integratedReading: { title: "기다림이 이어지는 이유", paragraphs: ["친구와 함께 기다리는 장면은 혼자 움직이기보다 함께 다음 단계를 준비하는 마음으로 읽어볼 수 있어요."], evidenceRefs: [{ startId: "E5", endId: "E7" }] },
  nextQuestion: null
};

describe("server-owned source evidence", () => {
  it("restores original Korean spans, punctuation and emoji without rewriting prose", () => {
    const catalog = buildFreeEvidenceCatalog(source);
    const result = hydrateFreeEvidence(draft, catalog, source);
    expect(result.symbols[0].evidence).toBe("친구와 오래된 역에 있었어요");
    expect(result.integratedReading?.evidenceQuotes).toEqual(["파란 기차를 기다렸어요"]);
    expect(result.symbols[0].meaning).toBe(draft.symbols[0].meaning);
    const unicode = "🌙🚉 역에서\t친구와 기다렸어요";
    const tokens = buildFreeEvidenceCatalog(unicode);
    expect(tokens.every(t => unicode.slice(t.start, t.end) === t.text)).toBe(true);
  });
  it("excludes quoted speech and superseded scenes, while retaining literal correction evidence", () => {
    const corrected = '아빠가 나왔어요. 아니 사실 동생이 나왔어요. 친구가 "내가 날아왔어"라고 말했어요';
    const catalog = buildFreeEvidenceCatalog(corrected);
    expect(catalog.some(t => t.text.includes("아빠"))).toBe(false);
    expect(catalog.some(t => t.text.includes("날아왔어"))).toBe(false);
    expect(catalog.some(t => t.text === "동생이")).toBe(true);
    expect(catalog.every(t => observedDreamText(corrected).includes(t.text))).toBe(true);
  });
  it("rejects unknown, reversed and overlong ranges", () => {
    for (const evidenceRef of [{ startId: "E99", endId: "E99" }, { startId: "E4", endId: "E1" }]) {
      const bad = { ...draft, symbols: [{ ...draft.symbols[0], evidenceRef }] };
      expect(invalidFreeEvidenceRefs(bad, buildFreeEvidenceCatalog(source), source)).toEqual([{ field: "symbols", index: 0 }]);
      expect(() => hydrateFreeEvidence(bad, buildFreeEvidenceCatalog(source), source)).toThrow("AI_SYMBOL_INVALID_EVIDENCE_REF");
    }
    const longSource = "가".repeat(101);
    const bad = { ...draft, integratedReading: null, symbols: [{ ...draft.symbols[0], evidenceRef: { startId: "E1", endId: "E2" } }] };
    expect(invalidFreeEvidenceRefs(bad, buildFreeEvidenceCatalog(longSource), longSource)).toHaveLength(1);
    bad.symbols[0].evidenceRef.endId = "E1";
    expect(hydrateFreeEvidence(bad, buildFreeEvidenceCatalog(longSource), longSource).symbols[0].evidence).toHaveLength(60);
  });
  it("repairs only invalid selections and refuses changes to valid selections or prose", () => {
    const catalog = buildFreeEvidenceCatalog(source);
    const bad = structuredClone(draft);
    bad.symbols[0].evidenceRef = { startId: "bad", endId: "bad" };
    const replacement = { field: "symbols" as const, index: 0, evidenceRef: ref };
    expect(repairFreeEvidenceRefs(bad, { replacements: [replacement] }, catalog, source)).toEqual(draft);
    expect(bad.symbols[0].evidenceRef.startId).toBe("bad");
    for (const replacements of [[], [replacement, replacement], [{ ...replacement, field: "integratedReading" as const }], [{ ...replacement, evidenceRef: { startId: "bad", endId: "bad" } }]]) {
      expect(() => repairFreeEvidenceRefs(bad, { replacements }, catalog, source)).toThrow();
    }
  });
  it("still checks later action-role violations when style is deferred to review", () => {
    const symbols = [
      { name: "친구", evidence: "친구", title: "같은 제목", meaning: "친구와 시간을 보내는 모습은 익숙한 관계를 떠올리게 해요." },
      { name: "때렸어요", evidence: "때렸어요", title: "같은 제목", meaning: "공격받는 모습은 위협을 느끼는 상황과 연결해볼 수 있어요." }
    ];
    expect(symbolicOutputError(symbols, "친구를 때렸어요", [], false, true)).toBe("AI_SYMBOL_REVERSED_ACTION");
  });
  it("does not allow model-authored quotation fields in the new wire format", () => {
    expect(symbolicFreeByIdSchema.safeParse(draft).success).toBe(true);
    expect(symbolicFreeByIdSchema.safeParse({ ...draft, symbols: [{ ...draft.symbols[0], evidence: "made up" }] }).success).toBe(false);
  });
});
