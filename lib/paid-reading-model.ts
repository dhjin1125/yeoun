/** Shared contract for the paid writer, reviewer, validator and result navigation. */
export const PAID_READING_MODEL = "editorial_depth_v2" as const;

export const PAID_READING_LIMITS = {
  targetMinCharacters: 1_500,
  targetMaxCharacters: 2_200,
  // Sparse dreams may be shorter. Depth is reviewed semantically, never padded.
  minCharacters: 350,
  maxCharacters: 2_800,
  directSentences: 3,
  sectionParagraphs: 4,
  paragraphSentences: 4,
  paragraphCharacters: 700
} as const;

export const PAID_READING_SECTIONS = [
  { key: "traditional", title: "이 장면들이 이어지는 이유", shortTitle: "장면의 연결" },
  { key: "psychology", title: "장면에서 살펴볼 속마음", shortTitle: "살펴볼 마음" },
  { key: "pattern", title: "최근 이런 일이 계기가 됐을 수 있어요", shortTitle: "최근의 계기" },
  { key: "action", title: "나에게 더 맞는 풀이를 구별하려면", shortTitle: "풀이 비교" }
] as const;

/**
 * A conditional example's antecedent is not a claimed life event. Keep the
 * consequent and EVERY later sentence in deterministic grounding checks.
 * The independent reviewer still receives the entire, unmodified paragraph.
 */
export function assertedPartOfContextExample(paragraph: string) {
  return paragraph.replace(/^[^.!?。！？\n]{1,240}?(?:다면|라면|경우에는)\s*[,，]\s*/u, "");
}
