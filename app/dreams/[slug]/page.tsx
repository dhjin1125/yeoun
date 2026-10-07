import type { Metadata } from "next";
import { ArrowRight, BookOpen, Feather, Info } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandLink } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";
import { DREAM_TOPICS, getDreamTopic } from "@/lib/seo-topics";
import { dreamEntryHref, dreamTopicQuestion } from "@/lib/dream-entry";

export function generateStaticParams() {
  return DREAM_TOPICS.map((topic) => ({ slug: topic.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const topic = getDreamTopic((await params).slug);
  if (!topic) return {};
  return {
    title: `${topic.title} 해몽 — 장면과 감정별 의미`,
    description: `${dreamTopicQuestion(topic.slug, topic.title)} 상징의 의미와 실제 장면을 함께 살펴보고, 내 꿈의 첫 해석을 가입 없이 무료로 받아보세요.`,
    alternates: { canonical: `/dreams/${topic.slug}` },
    openGraph: { title: `${topic.title} 해몽`, description: topic.summary, type: "article" }
  };
}

export default async function DreamTopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const topic = getDreamTopic((await params).slug);
  if (!topic) notFound();
  const related = DREAM_TOPICS.filter((item) => item.slug !== topic.slug).slice(0, 4);
  const entryHref = dreamEntryHref("search", topic.slug);
  const entryQuestion = dreamTopicQuestion(topic.slug, topic.title);
  const faq = [
    { question: `${topic.title}은 좋은 꿈인가요, 나쁜 꿈인가요?`, answer: `${topic.summary} 한 가지 상징만으로 길흉을 고정하기보다 꿈속 행동과 깨어난 뒤의 감정을 함께 보는 편이 좋습니다.` },
    { question: `${topic.title}이 실제 일을 예고하나요?`, answer: "꿈은 실제 사고, 죽음, 임신, 재물 같은 미래 사건을 확정하는 근거가 아닙니다. 최근 경험과 감정을 돌아보는 문화적·상징적 참고로만 사용하세요." },
    { question: "같은 꿈인데 왜 풀이가 다른가요?", answer: `같은 상징도 내가 한 행동과 당시의 기분에 따라 다르게 읽을 수 있어요. ${topic.emotionGuide}` },
    { question: "내 꿈도 무료로 해석받을 수 있나요?", answer: "가입 없이 기억나는 장면을 적으면 핵심 뜻과 이유를 무료로 읽을 수 있어요. 장면의 연결과 다른 풀이의 가능성까지 궁금하면 상세 해몽과 질문 2회를 원할 때만 990원에 이용할 수 있어요." }
  ];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } }))
  };

  return (
    <>
      <main id="main-content" className="topic-page">
        <header className="topic-header"><BrandLink /><Link href={entryHref}>내 꿈 무료로 풀어보기 <ArrowRight size={15} /></Link></header>
        <article>
          <div className="topic-hero">
            <div><p className="utility-label">{topic.title} 해몽</p><h1>{entryQuestion}</h1><p>{topic.summary}</p><Link className="primary-button topic-entry-button" href={entryHref}>내 꿈 무료로 풀어보기 <ArrowRight size={17} /></Link><p className="topic-entry-note">가입 없이 핵심 뜻과 이유부터 읽어보세요.</p></div>
          </div>
          <div className="topic-intro-grid">
            <section><BookOpen size={21} /><p className="utility-label">장면의 맥락</p><h2>먼저 확인할 것</h2><p>{topic.title}도 누가 무엇을 했고, 어떻게 끝났는지에 따라 다르게 읽힐 수 있어요. 기억나지 않거나 적지 않은 부분을 꿈의 특징으로 채워 넣지는 않아요.</p></section>
            <section><Feather size={21} /><p className="utility-label">심리적 가능성</p><h2>심리적으로는</h2><p>{topic.psychological}</p></section>
          </div>
          <section className="topic-situations"><p className="utility-label">장면에 따라</p><h2>같은 {topic.title}도 이렇게 달라져요</h2><div>{topic.situations.map((situation, index) => <article key={situation.label}><span>0{index + 1}</span><h3>{situation.label}</h3><p>{situation.meaning}</p></article>)}</div></section>
          <section className="topic-emotion"><div><p className="utility-label">감정에 따라</p><h2>상징과 함께 남은 기분도 살펴봐요</h2><p>{topic.emotionGuide}</p></div></section>
          <section className="topic-caution"><Info size={22} /><div><h2>내 꿈에 맞는 읽기</h2><p>이 페이지는 상징을 살펴보는 출발점이에요. 내 꿈의 장면과 감정을 알려주면 어떤 해석이 더 잘 맞는지 함께 살펴볼 수 있어요.</p></div></section>
          <section className="topic-faq"><p className="utility-label">많이 묻는 이야기</p><h2>자주 묻는 질문</h2>{faq.map((item) => <details key={item.question}><summary>{item.question}<span>+</span></summary><p>{item.answer}</p></details>)}</section>
          <section className="topic-cta"><p className="utility-label">내 꿈에 맞는 풀이</p><h2>꿈속 상징과 당신의 장면을 함께 풀어봐요.</h2><p>기억나는 만큼만 적어주세요. 궁금했던 뜻과 그 이유를 먼저 풀어드려요. 상세 해몽과 질문 2회는 원할 때만 990원이에요.</p><Link className="primary-button" href={entryHref}>내 꿈 무료로 풀어보기 <ArrowRight size={17} /></Link></section>
          <nav className="related-topics" aria-label="관련 꿈 해몽"><p className="utility-label">다른 꿈 상징</p><div>{related.map((item) => <Link href={`/dreams/${item.slug}`} key={item.slug}>{item.title}<ArrowRight size={14} /></Link>)}</div></nav>
        </article>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      </main>
      <SiteFooter />
    </>
  );
}
