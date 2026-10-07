import { getDreamTopic } from "./seo-topics";

export const DREAM_ENTRY_SOURCES = ["home", "search", "threads", "instagram"] as const;
export type DreamEntrySource = (typeof DREAM_ENTRY_SOURCES)[number];
export type DreamEntry = { source: DreamEntrySource; topic: { slug: string; title: string } | null };

export function resolveDreamEntry(params: { source?: string | string[]; topic?: string | string[] }): DreamEntry {
  const source = DREAM_ENTRY_SOURCES.find(value => value === params.source) ?? "home";
  const topic = typeof params.topic === "string" ? getDreamTopic(params.topic) : null;
  return { source, topic: topic ? { slug: topic.slug, title: topic.title } : null };
}

export function dreamEntryHref(source: DreamEntrySource, topic?: string) {
  const params = new URLSearchParams({ source });
  if (topic && getDreamTopic(topic)) params.set("topic", topic);
  return `/?${params.toString()}#dream-input`;
}

export function dreamTopicQuestion(slug: string, title: string) {
  const questions: Record<string, string> = {
    snake: "뱀을 피했나요, 편안하게 바라봤나요?",
    death: "죽는 꿈, 나쁜 일이 생긴다는 뜻일까요?",
    teeth: "이빨이 빠진 꿈이 마음에 걸리나요?",
    money: "돈을 얻었나요, 잃어버렸나요?",
    poop: "좋은 꿈이라는데, 내 장면도 그럴까요?",
    ancestor: "꿈에서 만난 조상, 어떤 느낌이 남았나요?",
    "ex-lover": "전 연인이 나온 꿈, 아직 마음이 남은 걸까요?",
    chased: "쫓기다가 도망쳤나요, 돌아서서 마주했나요?"
  };
  return questions[slug] ?? `${title}, 어떤 장면이 마음에 남았나요?`;
}
