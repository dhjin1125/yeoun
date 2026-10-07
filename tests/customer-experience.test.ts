import { afterEach, describe, expect, it, vi } from "vitest";
import { dreamEntryHref, resolveDreamEntry } from "@/lib/dream-entry";
import { asksForOutcomeBoundary } from "@/lib/customer-question";
import { buildConsultationOffer, buildConsultationPlan } from "@/lib/consultation";
import { analyzeDreamContextLocally } from "@/lib/local-engine";
import { symbolFirstReadingError, type ComposedReading } from "@/lib/symbolic-output";
import { formatFreeSymbolicAnswer } from "@/lib/symbolic-copy";
import { analyticsSchema, createReadingSchema } from "@/lib/validation";
import { generateFreeAssistant } from "@/lib/ai";
import { generateWithLocalCodex } from "@/lib/ai/codex-local";

vi.mock("@/lib/ai/codex-local", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/ai/codex-local")>(),
  localCodexConfigured: () => true,
  generateWithLocalCodex: vi.fn()
}));
afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const dream = "꿈에서 자전거를 타고 다리를 건넜어요. 도착해서 마음이 편안했어요.";
const reading: ComposedReading = {
  symbols: [{ name: "자전거", evidence: "자전거를 타고", title: "내 힘으로 건너는 장면", referenceIds: [],
    meaning: "이 꿈만으로 앞으로의 일을 예측할 수는 없어요. 자전거는 자신의 힘과 속도로 이동하는 수단이에요. 다리를 건너 편안해진 장면은 한 구간을 지나며 얻은 여유로 읽어볼 수 있어요." }],
  integratedReading: { title: "건너간 뒤에 남은 편안함", paragraphs: ["스스로 자전거를 움직여 다리를 건넌 행동과 도착한 뒤의 편안함이 이어져요. 직접 움직여 한 구간을 지난 경험에 중심을 두어 읽어볼 수 있어요."], evidenceQuotes: ["자전거를 타고 다리를 건넜어요"] },
  nextQuestion: null
};

describe("consulting recommendations in the existing dream flow", () => {
  it("keeps direct-entry context without inventing dream text, feelings or a focus", () => {
    expect(resolveDreamEntry({ source: "threads", topic: "snake" })).toEqual({ source: "threads", topic: { slug: "snake", title: "뱀 꿈" } });
    const url = new URL(dreamEntryHref("search", "death"), "https://dream.test");
    expect(url.hash).toBe("#dream-input");
    expect(url.searchParams.get("topic")).toBe("death");
    expect([...url.searchParams.keys()]).toEqual(["source", "topic"]);
  });
  it("ignores unknown or repeated entry parameters instead of reflecting arbitrary text", () => {
    expect(resolveDreamEntry({ source: "javascript:alert(1)", topic: "private-free-text" })).toEqual({ source: "home", topic: null });
    expect(resolveDreamEntry({ source: ["search", "threads"], topic: ["snake"] })).toEqual({ source: "home", topic: null });
    expect(dreamEntryHref("instagram", "unknown-topic")).toBe("/?source=instagram#dream-input");
  });
  it("keeps old intake requests valid and only accepts known campaign labels", () => {
    expect(createReadingSchema.parse({ dream })).toEqual({ dream });
    expect(createReadingSchema.parse({ dream, source: "search", topic: "snake" }).source).toBe("search");
    expect(createReadingSchema.safeParse({ dream, source: "user-written-text" }).success).toBe(false);
    expect(createReadingSchema.safeParse({ dream, topic: "private-free-text" }).success).toBe(false);
  });
  it("distinguishes an explicit outcome concern from general curiosity", () => {
    expect(asksForOutcomeBoundary({ selectedFocus: "good_or_bad", userQuestions: [] })).toBe(true);
    expect(asksForOutcomeBoundary({ selectedFocus: null, userQuestions: ["나쁜 일이 생길까요?"] })).toBe(true);
    expect(asksForOutcomeBoundary({ selectedFocus: "overall", userQuestions: ["무슨 의미인가요?"] })).toBe(false);
    expect(asksForOutcomeBoundary({ selectedFocus: "overall", userQuestions: ["돈의 상징은 무엇인가요?"] })).toBe(false);
  });
  it("accepts a requested boundary only at the start of the first symbol", () => {
    const answer = structuredClone(reading);
    expect(symbolFirstReadingError(answer, dream, [])).toBe("AI_SYMBOL_DISCLAIMER");
    expect(symbolFirstReadingError(answer, dream, [], true)).toBeNull();
    answer.symbols[0].meaning += " 미래를 단정할 수는 없어요.";
    expect(symbolFirstReadingError(answer, dream, [], true)).toBe("AI_SYMBOL_DISCLAIMER");
  });
  it("does not allow repeated boundaries in the integrated reading", () => {
    const answer = structuredClone(reading);
    answer.integratedReading!.paragraphs[0] += " 앞으로의 일을 판단할 수는 없어요.";
    expect(symbolFirstReadingError(answer, dream, [], true)).toBe("AI_SYMBOL_DISCLAIMER");
  });
  it("still rejects an unsafe certainty or an invented scene when answering a concern", () => {
    const answer = structuredClone(reading);
    answer.symbols[0].meaning = "이 꿈은 반드시 사고가 난다는 뜻이에요. 자전거가 위험한 상황을 가리키는 모습으로 나타났어요.";
    expect(symbolFirstReadingError(answer, dream, [], true)).toBe("AI_SYMBOL_UNSAFE_CLAIM");
    answer.symbols[0].evidence = "자동차를 타고";
    expect(symbolFirstReadingError(answer, dream, [], true)).toBe("AI_SYMBOL_UNGROUNDED");
  });
  it("carries the selected question into generation and preserves the approved opening for display", async () => {
    vi.stubEnv("APP_PROFILE", "local-ai");
    const answer = structuredClone(reading);
    answer.symbols[0].meaning = "현실의 사건을 예고하지는 않아요. 자전거는 자신의 힘과 속도로 이동하는 수단이에요. 다리를 건너 편안해진 장면은 한 구간을 지나며 얻은 여유로 읽어볼 수 있어요.";
    vi.mocked(generateWithLocalCodex).mockImplementation(async request => request.schemaName === "free_semantic_review"
      ? {severity:"pass",confidence:"high",verdict:"pass",reasonCodes:[],reason:"통과"} : answer);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const context = analyzeDreamContextLocally(dream, null, "good_or_bad").context;
    const result = await generateFreeAssistant(context, "synthetic-consulting-check", dream);
    const input = JSON.parse(vi.mocked(generateWithLocalCodex).mock.calls[0][0].inputJson);
    expect(input.readingContext.evidence.selectedFocusQuestion).toBe("좋은 꿈인지 나쁜 꿈인지");
    expect(result.directAnswer).toBe(answer.symbols[0].meaning);
    expect(formatFreeSymbolicAnswer(result).directAnswer).toBe(answer.symbols[0].meaning);
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(2);
  });
  it("uses actual scene excerpts in paid previews without turning labels into facts", () => {
    const context = analyzeDreamContextLocally(dream, null).context;
    const plan = buildConsultationPlan(context);
    plan.keyElements = [{ label: "승진을 예고하는 장면", evidence: "자전거를 타고" }, { label: "가족과 대화", evidence: "가족과 대화했어요" }, { label: "건너가는 행동", evidence: "다리를 건넜어요" }];
    const offer = buildConsultationOffer(context, plan);
    expect(offer.cards[0].title).toContain("자전거를 타고");
    expect(offer.cards[0].title).toContain("다리를 건넜어요");
    expect(JSON.stringify(offer)).not.toMatch(/승진|가족과 대화/);
    expect(offer.cards).toHaveLength(4);
    expect(offer.cards.map(card => card.key)).toEqual(["traditional", "psychology", "pattern", "action"]);
    expect(offer.cards[0].firstSentence).not.toContain("앞뒤");
  });
  it("keeps the four paid offer cards stable while grounding reality scope separately", () => {
    const context = analyzeDreamContextLocally(dream, null).context;
    const plan = buildConsultationPlan(context);
    plan.sectionTopics.push("reality");
    expect(buildConsultationOffer(context, plan).cards.map(card => card.key)).toEqual(["traditional", "psychology", "pattern", "action"]);
    context.realityContexts = ["현실에서는 이사를 준비해요"];
    expect(buildConsultationOffer(context, plan).cards.map(card => card.key)).toEqual(["traditional", "psychology", "pattern", "action"]);
  });
  it("stores question resolution separately from helpfulness without adding dream content to analytics", () => {
    const input = { event: "answer_rated", readingId: "synthetic-reading", context: { dimension: "question_resolved", rating: "not_helpful", turnId: "synthetic-turn", step: "free", dream: "private text is not analytics" } };
    const parsed = analyticsSchema.parse(input);
    expect(parsed.context).toEqual({ dimension: "question_resolved", rating: "not_helpful", turnId: "synthetic-turn", step: "free" });
    expect(analyticsSchema.safeParse({ ...input, context: { dimension: "free-form-private-text", rating: "helpful" } }).success).toBe(false);
    expect(analyticsSchema.parse({ event: "answer_rated", context: { rating: "helpful" } }).context).toEqual({ rating: "helpful" });
  });
});
