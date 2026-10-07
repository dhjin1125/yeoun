import type { DreamContext } from "./types";

/** A requested boundary belongs in the opening answer, never in every paragraph. */
export function asksForOutcomeBoundary(context: Pick<DreamContext, "selectedFocus" | "userQuestions">) {
  if (context.selectedFocus === "good_or_bad" || context.selectedFocus === "relationship") return true;
  return (context.userQuestions ?? []).some(question =>
    /예고|예지|징조|길몽|흉몽|좋은\s*꿈|나쁜\s*꿈|나쁜\s*일|불길|실제로|상대.*마음|속마음|외도|바람|미련|(?:앞으로|현실).*(?:사고|죽|질병|임신|당첨|돈|재물|이별)|(?:사고|임신|당첨|돈|재물|이별).*(?:생길|일어날|하게\s*될)/.test(question)
  );
}
