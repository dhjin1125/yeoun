export const INTERPRETATION_FOCUS_VALUES = [
  "overall",
  "relationship",
  "recent_context",
  "repetition",
  "good_or_bad"
] as const;

export type InterpretationFocus = (typeof INTERPRETATION_FOCUS_VALUES)[number];

export const INTERPRETATION_FOCUS_OPTIONS: Array<{
  value: InterpretationFocus;
  label: string;
  question: string;
}> = [
  { value: "overall", label: "전체 의미", question: "이 꿈의 전체 의미" },
  {
    value: "relationship",
    label: "관계·상대 마음",
    question: "관계와 상대의 마음을 꿈으로 어디까지 볼 수 있는지"
  },
  {
    value: "recent_context",
    label: "최근 사건의 영향",
    question: "최근 사건이나 감정이 꿈에 영향을 줬는지"
  },
  {
    value: "repetition",
    label: "반복되는 이유",
    question: "이 꿈이 반복되거나 오래 남는 이유"
  },
  {
    value: "good_or_bad",
    label: "좋은 꿈·나쁜 꿈?",
    question: "좋은 꿈인지 나쁜 꿈인지"
  }
];

export function interpretationQuestionForFocus(focus: InterpretationFocus | null | undefined) {
  return INTERPRETATION_FOCUS_OPTIONS.find((option) => option.value === focus)?.question ?? null;
}

export function interpretationLabelForFocus(focus: InterpretationFocus | null | undefined) {
  return INTERPRETATION_FOCUS_OPTIONS.find((option) => option.value === focus)?.label ?? null;
}
