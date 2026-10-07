import { describe, expect, it } from "vitest";
import { extractSymbols } from "@/lib/symbols";
import { analyzeDreamContextLocally, applyClarificationsToContext, freeDetailGuidance } from "@/lib/local-engine";
import { classifySafetyRoute } from "@/lib/safety";

describe("product rule regressions", () => {
  it.each([
    ["꿈에서 친구를 계속 때렸어요", "dream_only"],
    ["꿈에서 친구가 나를 때렸어요", "dream_only"],
    ["친구가 꿈에 나왔어요. 지금 나는 죽고 싶어요", "immediate_self"],
    ["꿈에서 친구를 때렸어요. 지금 죽고 싶어요", "immediate_self"],
    ["친구가 지금 죽고 싶다고 했어요", "third_party"],
    ["꿈에서 친구가 나왔어요. 현실에서 그 친구가 자해하고 있어요", "third_party"]
  ])("keeps dream violence and current personal danger distinct: %s", (text, route) => {
    expect(classifySafetyRoute(text)).toBe(route);
  });
  it.each(["방법이 생각났어", "돈까스를 먹었어", "불안해서 돌아봤어"])("does not extract symbols from unrelated word fragments: %s", (text) => {
    expect(extractSymbols(text).filter(s => s.key !== "scene")).toEqual([]);
  });
  it("keeps symbols in the order the user described them", () => {
    expect(extractSymbols("집에 있다가 뱀이 나왔어").map(s=>s.key)).toEqual(["house", "snake"]);
  });
  it("does not interpret an explicitly absent symbol", () => {
    expect(extractSymbols("뱀은 안 나왔고 집이 나왔어요").map(s=>s.key)).toEqual(["house"]);
  });
  it.each(["계산했어요", "이상했어요", "아이스크림을 먹었어요"])("does not invent people or places from syllables: %s", (dream) => {
    const {context} = analyzeDreamContextLocally(dream, null);
    expect(context.places).toEqual([]); expect(context.people).toEqual([]);
  });
  it("separates explicit waking facts from dreamed symbols and actions", () => {
    const {context}=analyzeDreamContextLocally("요즘 집에서 뱀 영상을 봤어요. 꿈에서는 엘리베이터를 타고 올라갔어요.", null);
    expect(context.symbols.map(s=>s.key)).not.toContain("snake");
    expect(context.places).not.toContain("집");
    expect(context.realityContexts.join(" ")).toContain("뱀 영상");
  });
  it("does not misclassify a recently dreamed scene as waking context", () => {
    const {context}=analyzeDreamContextLocally("최근 꿈에서 뱀이 나와서 무서웠어요", null);
    expect(context.symbols.map(s=>s.key)).toContain("snake");
    expect(context.realityContexts).toEqual([]);
  });
  it("does not replace a stated real event with a later question", () => {
    const {context}=analyzeDreamContextLocally("꿈에서 뱀이 나왔어요. 최근에 친구가 폭언을 들었다는 이야기를 들었어요. 이 꿈이 다른 사람을 원한다는 뜻일까요? 전할 말도 알고 싶어요.",null);
    expect(context.realityContexts).toHaveLength(1);
    expect(context.realityContexts[0]).toContain("폭언");
  });
  it("splits mixed dream and reality details without losing either", () => {
    const original=analyzeDreamContextLocally("뱀이 나왔어", null).context;
    const context=applyClarificationsToContext(original,[{questionId:"audit",kind:"scene",answer:"꿈에서는 무서웠어요. 참고로 요즘 회사 시험을 앞두고 있어요.",skipped:false}]);
    expect(context.symbols.map(s=>s.key)).not.toContain("school");
    expect(context.realityContexts.join(" ")).toContain("회사 시험");
  });
  it("does not turn a negated fear into fear", () => {
    const {context}=analyzeDreamContextLocally("뱀이 나왔지만 무섭지 않았어요", null);
    expect(context.emotions).not.toContain("두려움");
  });
  it("respects a negated colloquial feeling", () => {
    expect(analyzeDreamContextLocally("뱀이 나왔는데 안 무서웠어요", null).context.emotions).not.toContain("두려움");
  });
  it("does not ask the user how it felt to watch their own action", () => {
    const guidance=freeDetailGuidance(analyzeDreamContextLocally("계속 쫓기면서 도망쳤어", null).context);
    expect(guidance.question).not.toContain("쫓김을 봤을 때");
  });
  it.each(["내가 누군가를 때렸어요", "누군가에게 맞았어요", "엘리베이터가 올라갔어요"])("recognizes a concrete action for the detail gate: %s", (dream) => {
    expect(freeDetailGuidance(analyzeDreamContextLocally(dream,null).context).ready).toBe(true);
  });
});
