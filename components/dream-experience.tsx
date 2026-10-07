"use client";

import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  LockKeyhole,
  MessageCircle,
  Phone,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState
} from "react";
import type {
  AssistantTurnPayload,
  ClarificationKind,
  Emotion,
  OrderProduct,
  PaidPreview as PaidPreviewItem,
  PreparedPaidPreview,
  PublicPaidCompositionV3,
  PublicConversationTurn,
  PublicFreeReadingV3,
  PublicReading,
  SafetyNotice,
  UserTurnPayload
} from "@/lib/types";
import {
  INTERPRETATION_FOCUS_OPTIONS,
  type InterpretationFocus
} from "@/lib/interpretation-focus";
import { EMOTIONS } from "@/lib/types";
import { previewMasks } from "@/lib/preview-mask";
import { formatSymbolTitle } from "@/lib/symbolic-title";
import { formatFreeSymbolicAnswer } from "@/lib/symbolic-copy";
import { buildOrderRequestPayload } from "@/lib/order-request";
import { initialProgress, type OperationProgress } from "@/lib/progress";
import { ProgressRequestError, requestProgressJson } from "@/lib/progress-client";
import { normalizeNodeOffReviewPayload } from "@/lib/nodeoff-review";
import { BrandLink, DreamMark } from "./brand";
import journalInputStyles from "./journal-dream-intake.module.css";
import { ProgressDisplay } from "./progress-display";
import { useReadingTransition } from "./reading-transition-provider";
import { ReviewAccountNav } from "./review-account-nav";
import { ReadingSteps } from "./reading-steps";
import { FreeDetailForm } from "./free-detail-form";
import type { DreamEntry } from "@/lib/dream-entry";
import type { DreamTestExample } from "@/lib/dream-test-example-types";

type ApiErrorPayload = { error?: { code?: string; message?: string } };

type TossPayment = {
  requestPayment(input: {
    method: "CARD";
    amount: { currency: "KRW"; value: number };
    orderId: string;
    orderName: string;
    customerName: string;
    successUrl: string;
    failUrl: string;
  }): Promise<void>;
};

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => { payment(input: { customerKey: string }): TossPayment };
  }
}

const MIN_DREAM_LENGTH = 1;
const MAX_DREAM_LENGTH = 2_000;
const MAX_MESSAGE_LENGTH = 1_200;
function withImmediateScroll(action: () => void) {
  const previousScrollBehavior = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = "auto";
  try {
    action();
  } finally {
    document.documentElement.style.scrollBehavior = previousScrollBehavior;
  }
}

function scrollToTopImmediately() {
  withImmediateScroll(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  });
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store"
  });
  const body = (await response.json()) as T & ApiErrorPayload;
  if (!response.ok) throw new Error(body.error?.message ?? "잠시 후 다시 시도해 주세요.");
  return normalizeNodeOffReviewPayload(body);
}

function track(event: string, readingId?: string, context?: Record<string, string>) {
  const body = JSON.stringify({ event, readingId: readingId ?? null, context });
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
    return;
  }
  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true
  });
}

function restoreToken(restoreUrl: string) {
  try {
    return new URL(restoreUrl).searchParams.get("token") ?? undefined;
  } catch {
    return undefined;
  }
}

function readingRoute(reading: PublicReading) {
  const pathname = `/reading/${encodeURIComponent(reading.id)}`;
  const token = restoreToken(reading.restoreUrl);
  return token ? `${pathname}?token=${encodeURIComponent(token)}` : pathname;
}

function isUserPayload(content: PublicConversationTurn["content"]): content is UserTurnPayload {
  return typeof content === "object" && content !== null && "text" in content;
}

function isSafetyNotice(content: PublicConversationTurn["content"]): content is SafetyNotice {
  return typeof content === "object" && content !== null && "resources" in content && "blocksInterpretation" in content;
}

function isAssistantPayload(content: PublicConversationTurn["content"]): content is AssistantTurnPayload {
  return typeof content === "object" && content !== null && "directAnswer" in content && "sections" in content;
}

function isFreeV3(content: PublicConversationTurn["content"]): content is PublicFreeReadingV3 {
  return typeof content === "object" && content !== null && "freeCompositionVersion" in content &&
    content.freeCompositionVersion === 3 && "primarySection" in content;
}

function isPaidV3(content: PublicConversationTurn["content"]): content is PublicPaidCompositionV3 {
  return typeof content === "object" && content !== null && "paidCompositionVersion" in content &&
    content.paidCompositionVersion === 3 && "newPerspectives" in content;
}

function formatTurnDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul"
  }).format(new Date(value));
}

function AppHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className={compact ? "app-header app-header--compact" : "app-header"}>
      <BrandLink />
      <div className="header-tools">
        <div className="header-note"><span>기억난 꿈에서 시작하는 풀이</span></div>
        <ReviewAccountNav />
      </div>
    </header>
  );
}

function LoadingReading({
  progress,
  title = "꿈의 장면을 차분히 정리하고 있어요"
}: {
  progress: OperationProgress;
  title?: string;
}) {
  const sheetRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      withImmediateScroll(() => sheetRef.current?.scrollIntoView({ block: "center" }));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <section ref={sheetRef} className="loading-sheet" aria-busy="true">
      <p className="utility-label">꿈을 읽는 중</p>
      <h2>{title}</h2>
      <ProgressDisplay progress={progress} />
    </section>
  );
}

function DreamIntake({ entry, onComplete, testExamples }: { entry: DreamEntry; onComplete: (reading: PublicReading) => void; testExamples: DreamTestExample[] }) {
  const { recallDraft, rememberDraft } = useReadingTransition();
  const [dream, setDream] = useState(() => recallDraft()?.dream ?? "");
  const [emotion, setEmotion] = useState<Emotion | null>(() => recallDraft()?.emotion ?? null);
  const [focus, setFocus] = useState<InterpretationFocus | null>(() => recallDraft()?.focus ?? null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(() => initialProgress("서버에 꿈을 안전하게 전달하는 중이에요"));
  const [error, setError] = useState("");
  const composing = useRef(false);
  const dreamInputRef = useRef<HTMLTextAreaElement>(null);
  const trackedStart = useRef(false);
  const hintId = useId();
  const focusHintId = useId();
  const errorId = useId();
  const count = dream.trim().length;

  useEffect(() => { rememberDraft({ dream, emotion, focus }); }, [dream, emotion, focus, rememberDraft]);

  function handleDreamChange(value: string) {
    setDream(value);
    setError("");
    if (!trackedStart.current && value.length > 0) {
      trackedStart.current = true;
      track("input_started", undefined, { source: entry.source, ...(entry.topic ? { topic: entry.topic.slug } : {}) });
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (composing.current) return;
    if (count < MIN_DREAM_LENGTH) {
      setError("기억나는 장면이나 느낌을 적어주세요.");
      return;
    }
    setProgress(initialProgress("서버에 꿈을 안전하게 전달하는 중이에요"));
    setLoading(true);
    setError("");
    try {
      const response = await requestProgressJson<{ reading: PublicReading }>(
        "/api/readings",
        {
          method: "POST",
          body: JSON.stringify({ dream, emotion, focus, source: entry.source, ...(entry.topic ? { topic: entry.topic.slug } : {}) })
        },
        setProgress
      );
      onComplete(response.reading);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "해몽을 시작하지 못했어요.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <LoadingReading progress={progress} />;

  return (
    <form className={journalInputStyles.form} id="dream-input" onSubmit={submit} noValidate>
      <div className={journalInputStyles.taskSurface}>
        <div className={journalInputStyles.composerHeading}>
          <label htmlFor="dream-text">꿈 이야기</label>
        </div>

        <textarea
          ref={dreamInputRef}
          id="dream-text"
          name="dream"
          value={dream}
          onChange={(event) => handleDreamChange(event.target.value)}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          minLength={MIN_DREAM_LENGTH}
          maxLength={MAX_DREAM_LENGTH}
          placeholder={"기억나는 장면부터 적어주세요.\n어떤 뜻이 궁금한지도 함께 적어주시면 먼저 풀어드려요."}
          aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`}
          aria-invalid={Boolean(error)}
        />

        <div className={journalInputStyles.composerMeta}>
          <span id={hintId}>
            {count > 0 && count < MIN_DREAM_LENGTH
              ? `${MIN_DREAM_LENGTH - count}자만 더 적으면 시작할 수 있어요.`
              : count >= MIN_DREAM_LENGTH ? "좋아요. 이 내용으로 해석을 시작할 수 있어요." : "짧게 적어도 괜찮아요. 나중에 더 보탤 수 있어요."}
          </span>
          <span aria-live="polite">
            {dream.length.toLocaleString("ko-KR")} / {MAX_DREAM_LENGTH.toLocaleString("ko-KR")}
          </span>
        </div>

        {process.env.NODE_ENV === "development" && testExamples.length > 0 ? (
          <div className={journalInputStyles.testExamples} aria-label="테스트용 꿈 예시">
            <p>테스트 꿈 예시 · 하나를 누르면 입력창에 바로 들어가요.</p>
            <div className={journalInputStyles.testExampleList}>
              {testExamples.map((example) => (
                <div className={journalInputStyles.testExampleItem} key={example.id}>
                  <button
                    type="button"
                    onClick={() => {
                      handleDreamChange(example.dream);
                      window.requestAnimationFrame(() => {
                        dreamInputRef.current?.focus();
                        dreamInputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
                      });
                    }}
                  >
                    {example.label} 입력하기
                  </button>
                  {example.source ? example.source.url ? (
                    <a href={example.source.url} target="_blank" rel="noreferrer">{example.source.label}</a>
                  ) : <span>{example.source.label}</span> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <details className={journalInputStyles.helpers}>
        <summary>
          <span>
            <strong>특히 궁금한 점이 있나요?</strong>
            <small>{[INTERPRETATION_FOCUS_OPTIONS.find((option) => option.value === focus)?.label, emotion].filter(Boolean).join(" · ") || "궁금한 점과 남은 기분을 고르면 반영해요 · 선택"}</small>
          </span>
        </summary>

        <div className={journalInputStyles.helperBody}>
          <div className={journalInputStyles.helperGrid}>
            <fieldset aria-describedby={focusHintId}>
              <legend>이 꿈에서 특히 궁금한 점이 있나요?<span>선택</span></legend>
              <p className={journalInputStyles.helperHint} id={focusHintId}>
                궁금한 점부터 답하고, 꿈속 장면을 바탕으로 이유를 풀어드려요. 고르지 않아도 괜찮아요.
              </p>
              <div className={journalInputStyles.choiceList}>
                {INTERPRETATION_FOCUS_OPTIONS.map((option) => (
                  <button
                    className={focus === option.value ? journalInputStyles.choiceSelected : journalInputStyles.choice}
                    type="button"
                    aria-pressed={focus === option.value}
                    key={option.value}
                    onClick={() => {
                      const next = focus === option.value ? null : option.value;
                      setFocus(next);
                      setError("");
                      if (next) track("focus_selected", undefined, { source: entry.source, focus: next, ...(entry.topic ? { topic: entry.topic.slug } : {}) });
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>꿈에서 깬 뒤 어떤 기분이 남았나요?<span>선택</span></legend>
              <div className={journalInputStyles.choiceList}>
                {EMOTIONS.map((item) => (
                  <button
                    className={emotion === item ? journalInputStyles.choiceSelected : journalInputStyles.choice}
                    type="button"
                    aria-pressed={emotion === item}
                    key={item}
                    onClick={() => {
                      setEmotion((current) => (current === item ? null : item));
                      setError("");
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </div>
      </details>

      {error ? <p className={journalInputStyles.formError} id={errorId} role="alert">{error}</p> : null}

      <div className={journalInputStyles.actionRow}>
        <button className={journalInputStyles.submitButton} type="submit" disabled={count < MIN_DREAM_LENGTH}>
          내 꿈 무료로 풀어보기 <ArrowRight size={17} aria-hidden="true" />
        </button>
        <p>
          가입 없이 꿈의 핵심 뜻과 이유를 읽어보세요.
          <span>상세 해몽 + 질문 2회는 원할 때만 990원</span>
        </p>
      </div>
    </form>
  );
}

const CLARIFICATION_GUIDANCE: Record<ClarificationKind, string> = {
  scene: "꿈을 다시 정리할 필요 없어요. 장면·소리·표정처럼 지금 떠오르는 조각 하나면 충분해요.",
  emotion: "감정 이름을 정확히 붙이지 않아도 괜찮아요. 깨고 난 뒤 남은 느낌을 그대로 옮겨주세요.",
  relationship: "누구인지 확정하지 않아도 괜찮아요. 그 사람에게서 받은 인상만 적어도 충분해요.",
  recent_context: "꿈과 억지로 연결하지 않아도 괜찮아요. 요즘 마음에 걸리는 일이 있다면 한 줄이면 충분해요.",
  dreamer: "이름이나 개인정보는 필요 없어요. 누가 꾼 꿈인지 관계만 가볍게 알려주세요."
};

function ClarificationCard({
  reading,
  token,
  onComplete,
  showHeader = true
}: {
  reading: PublicReading;
  token?: string;
  onComplete: (reading: PublicReading) => void;
  showHeader?: boolean;
}) {
  const question = reading.currentQuestion;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(() => initialProgress("추가한 내용을 서버에 전달하는 중이에요"));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!question) return;
    const focusTimer = window.setTimeout(() => {
      headingRef.current?.focus({ preventScroll: true });
      scrollToTopImmediately();
    }, 120);
    return () => window.clearTimeout(focusTimer);
  }, [question]);

  if (!question) return null;
  const currentQuestion = question;
  const admissionQuestion = currentQuestion.id.startsWith("admission-");
  const guidance = CLARIFICATION_GUIDANCE[currentQuestion.kind];

  async function answer(skipped: boolean) {
    const value = custom.trim();
    if (!skipped && !value) {
      setError(admissionQuestion ? "꿈에서 있었던 장면을 한 줄만 적어주세요." : "한 줄을 적거나 아래의 ‘이 내용만으로 무료 해석 보기’를 눌러주세요.");
      return;
    }
    setProgress(initialProgress("추가한 내용을 서버에 전달하는 중이에요"));
    setLoading(true);
    setError("");
    try {
      const response = await requestProgressJson<{ reading: PublicReading }>(
        `/api/readings/${encodeURIComponent(reading.id)}/clarifications`,
        {
          method: "POST",
          body: JSON.stringify({
            questionId: currentQuestion.id,
            answer: skipped ? null : value,
            skipped,
            restoreToken: token
          })
        },
        setProgress
      );
      onComplete(response.reading);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "답을 이어가지 못했어요.");
      setLoading(false);
    }
  }

  if (loading) return <div className="standalone-loader"><LoadingReading progress={progress} title="추가한 맥락까지 이어 읽고 있어요" /></div>;

  return (
    <div className="clarification-page">
      {showHeader ? <AppHeader compact /> : null}
      <section className="clarification-card" aria-labelledby="clarification-title">
        <ReadingSteps current={2} />
        <div className="clarification-kicker">
          <p className="utility-label">한 가지만 더 알면 도움이 돼요</p>
          <span>{admissionQuestion ? "기억나는 장면 하나면 충분해요" : "선택사항 · 답하지 않아도 해석을 볼 수 있어요"}</span>
        </div>
        <h1 id="clarification-title" ref={headingRef} tabIndex={-1}>{currentQuestion.prompt}</h1>
        <p className="clarification-description" id="clarification-description">{guidance}</p>
        <label className="clarification-compose" htmlFor="clarification-note">
          <span>떠오르는 한 줄 {!admissionQuestion ? <small>선택사항</small> : null}</span>
          <textarea
            id="clarification-note"
            value={custom}
            maxLength={240}
            rows={4}
            placeholder={currentQuestion.placeholder}
            aria-describedby="clarification-description clarification-field-note"
            onChange={(event) => { setCustom(event.target.value); setError(""); }}
          />
          <small className="clarification-field-note" id="clarification-field-note">
            <span>문장이어도, 단어 몇 개여도 괜찮아요.</span>
            <span aria-live="polite">{custom.length}/240</span>
          </small>
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="clarification-actions">
          <button className="primary-button" type="button" disabled={!custom.trim()} onClick={() => void answer(false)}>
            반영해서 무료 해석 보기 <ArrowRight size={18} />
          </button>
          {admissionQuestion
            ? <Link className="text-button" href="/#dream-input">꿈 다시 적기</Link>
            : <button className="text-button" type="button" onClick={() => void answer(true)}>이 내용만으로 무료 해석 보기</button>}
        </div>
      </section>
    </div>
  );
}

function CopyButton({ text, label = "문장 복사" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button className="copy-button" type="button" onClick={() => void copy()}>
      {copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "복사했어요" : label}
    </button>
  );
}

function SafetyRecord({ notice, turnId }: { notice: SafetyNotice; turnId: string }) {
  return (
    <article id={`turn-${turnId}`} className="timeline-entry timeline-entry--safety" tabIndex={-1}>
      <div className="timeline-index"><span aria-hidden="true">!</span><small>안전 안내</small></div>
      <div className="timeline-content safety-record">
        <p className="record-kicker">해몽보다 먼저 확인할 내용</p>
        <h2>{notice.title}</h2>
        <p>{notice.message}</p>
        <div className="safety-resources">
          {notice.resources.map((resource) => (
            <a href={`tel:${resource.phone}`} key={`${resource.label}-${resource.phone}`}>
              <Phone size={16} aria-hidden="true" />
              <span>{resource.label}</span><strong>{resource.phone}</strong>
            </a>
          ))}
        </div>
        <p className="safety-footnote">이 안내는 결제 여부와 관계없이 언제나 볼 수 있어요.</p>
      </div>
    </article>
  );
}

function isMissingFreeMeaning(turn: PublicConversationTurn) {
  return turn.kind === "free" && isAssistantPayload(turn.content) && (
    turn.content.freeReadingMode === "needs_detail" ||
    turn.content.directAnswer.includes("꿈이 또렷하지 않아도 괜찮아요. 지금 떠오르는 장면이나 느낌 하나부터 시작해 볼까요?")
  );
}

function ReadingBody({ paragraphs, locked = false }: { paragraphs: string[]; locked?: boolean }) {
  return <>{paragraphs.map((paragraph, index) => {
    const masks = locked ? previewMasks(paragraph) : [];
    const content: ReactNode[] = [];
    let cursor = 0;
    for (const mask of masks) {
      content.push(paragraph.slice(cursor, mask.start));
      content.push(<span key={mask.start}><span className="reading-inline-veil" aria-hidden="true">{paragraph.slice(mask.start, mask.end)}</span><span className="sr-only">[전체 풀이에서 읽을 수 있는 부분]</span></span>);
      cursor = mask.end;
    }
    content.push(paragraph.slice(cursor));
    return <p key={index}>{content}</p>;
  })}</>;
}

function AssistantRecord({ turn, locked = false }: { turn: PublicConversationTurn; locked?: boolean }) {
  if (isFreeV3(turn.content)) {
    const reading = turn.content;
    return <article id={`turn-${turn.id}`} className={`timeline-entry timeline-entry--${turn.kind}`} tabIndex={-1}>
      <div className="timeline-content assistant-record">
        <div className="record-heading"><div><p className="record-kicker">핵심부터 읽는 무료 풀이</p><h2>무료 첫 해석</h2></div><time dateTime={turn.createdAt}>{formatTurnDate(turn.createdAt)}</time></div>
        <section className="direct-answer"><div className="direct-answer-heading"><h3>{reading.title}</h3></div></section>
        <div className="answer-sections">
          {[reading.primarySection, reading.secondarySection].map((section, index) => <section id={`turn-${turn.id}-section-${index}`} key={section.heading} tabIndex={-1}>
            <div className="answer-section-copy"><h3>{section.heading}</h3><ReadingBody paragraphs={section.paragraphs} locked={locked} /></div>
          </section>)}
        </div>
      </div>
    </article>;
  }
  if (isPaidV3(turn.content)) {
    const reading = turn.content;
    const sections = [
      { heading: "무료 해석에서 이어서", paragraphs: [reading.bridge] },
      ...reading.newPerspectives.map(item => ({ heading: item.heading, paragraphs: item.paragraphs })),
      { heading: "장면을 함께 보면", paragraphs: reading.relationshipSynthesis },
      ...(reading.alternativeReading ? [{ heading: "다른 방향에서 보면", paragraphs: [reading.alternativeReading.paragraph] }] : []),
      { heading: "꿈 전체를 묶으면", paragraphs: [reading.finalIntegration] }
    ];
    return <article id={`turn-${turn.id}`} className={`timeline-entry timeline-entry--${turn.kind}`} tabIndex={-1}>
      <div className="timeline-content assistant-record">
        <div className="record-heading"><div><p className="record-kicker">장면 관계를 연결한 상세 풀이</p><h2>상세 해몽</h2></div><time dateTime={turn.createdAt}>{formatTurnDate(turn.createdAt)}</time></div>
        <div className="answer-sections">{sections.map((section, index) => <section id={`turn-${turn.id}-section-${index}`} key={`${section.heading}-${index}`} tabIndex={-1}>
          <div className="answer-section-copy"><h3>{section.heading}</h3>{section.paragraphs.map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}</div>
        </section>)}</div>
      </div>
    </article>;
  }
  if (!isAssistantPayload(turn.content) || isMissingFreeMeaning(turn)) return null;
  const answer = turn.kind === "free" ? formatFreeSymbolicAnswer(turn.content) : turn.content;
  const title = turn.kind === "free" ? "무료 첫 해석" : turn.kind === "detailed" ? "꿈의 핵심" : "질문에 대한 답";

  return (
    <article id={`turn-${turn.id}`} className={`timeline-entry timeline-entry--${turn.kind}`} tabIndex={-1}>
      <div className="timeline-content assistant-record">
        <div className="record-heading">
          <div><h2>{title}</h2></div>
          <time dateTime={turn.createdAt}>{formatTurnDate(turn.createdAt)}</time>
        </div>

        <section className="direct-answer">
          <div className="direct-answer-heading"><h3>{formatSymbolTitle(answer.directAnswerTitle ?? "먼저 답하면")}</h3></div>
          <ReadingBody paragraphs={[answer.directAnswer]} locked={locked} />
        </section>

        {answer.interpretationChanges ? (
          <section className="interpretation-change" aria-label="새 정보로 달라진 해석">
            <div><span>새로 알게 된 점</span><p>{answer.interpretationChanges.newlyLearned}</p></div>
            <div><span>그래서 달라지는 해석</span><p>{answer.interpretationChanges.revisedInterpretation}</p></div>
          </section>
        ) : null}

        {answer.sections.length > 0 ? <ReadingSections turnId={turn.id} sections={answer.sections} locked={locked} /> : null}

        {answer.readingQuestion ? <p className="reading-question">{answer.readingQuestion}</p> : null}

        {answer.sources?.length ? (
          <details className="reading-references">
            <summary>상징 풀이에 참고한 자료</summary>
            <ul>{answer.sources.map(source => (
              <li key={source.id}><span>{source.symbol} · </span><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>
            ))}</ul>
          </details>
        ) : null}

        {answer.shareableSentences.length > 0 ? (
          <section className="shareable-record">
            <div><p className="record-kicker">그대로 전해도 되는 문장</p><h3>길게 설명하지 않고 이렇게 말해보세요</h3></div>
            {answer.shareableSentences.map((sentence, index) => (
              <div className="shareable-sentence" key={index}>
                <p>{sentence}</p><CopyButton text={sentence} />
              </div>
            ))}
          </section>
        ) : null}

      </div>
    </article>
  );
}

function ReadingSections({ turnId, sections, locked = false }: {
  turnId: string;
  sections: AssistantTurnPayload["sections"];
  locked?: boolean;
}) {
  return <div className="answer-sections">{sections.map((section, index) => (
    <section id={`turn-${turnId}-section-${index}`} key={`${section.title}-${index}`} tabIndex={-1}>
      <div className="answer-section-copy">
        <h3>{formatSymbolTitle(section.title)}</h3>
        <ReadingBody paragraphs={section.paragraphs} locked={locked} />
      </div>
    </section>
  ))}</div>;
}

function UserRecord({ turn, questionNumber }: { turn: PublicConversationTurn; questionNumber?: number }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  if (!isUserPayload(turn.content)) return null;
  const isDream = turn.kind === "dream";
  const title = questionNumber ? `질문 ${questionNumber}` : isDream ? "기억한 꿈" : turn.content.intent === "reaction" ? "추가 대화" : turn.content.intent === "correction" ? "정정한 사실" : "내가 덧붙인 말";
  const canCollapse = !questionNumber && turn.content.text.replace(/\s+/g, " ").trim().length > 64;
  return (
    <article id={`turn-${turn.id}`} className="timeline-entry timeline-entry--user" tabIndex={-1}>
      <div className="timeline-index"><span aria-hidden="true">{isDream ? "꿈" : "나"}</span><small>{isDream ? "처음 기록" : "내 이야기"}</small></div>
      <div className="timeline-content user-record">
        <div className="user-record-heading">
          <div className="user-record-label">
            <p className="record-kicker">{turn.content.label ?? (isDream ? "처음 들려준 꿈" : "이어진 질문")}</p>
            <h2>{title}</h2>
          </div>
          <div className="user-record-meta">
            <time dateTime={turn.createdAt}>{formatTurnDate(turn.createdAt)}</time>
            {canCollapse ? (
              <button
                type="button"
                aria-controls={contentId}
                aria-expanded={expanded}
                aria-label={`${title} ${expanded ? "접기" : "전체 내용 보기"}`}
                onClick={() => setExpanded((current) => !current)}
              >
                {expanded ? "접기" : "전체 보기"}<span aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
        <p id={contentId} className={expanded || !canCollapse ? "user-record-text is-expanded" : "user-record-text"}>{turn.content.text}</p>
      </div>
    </article>
  );
}

function ConsultationTimeline({ reading, children, conversation }: { reading: PublicReading; children?: ReactNode; conversation?: ReactNode }) {
  const sourceTurns = reading.timeline.filter((turn) => turn.kind === "dream" || turn.kind === "clarification");
  const paid = reading.entitlement.fullReadingPurchased;
  const lockFreeReading = !paid && Boolean(reading.paidOffer) && reading.canPurchaseFullReading && !reading.safetyNotice?.blocksInterpretation;
  const answerTurns = reading.timeline.filter((turn) => !sourceTurns.includes(turn) && !(paid && turn.kind === "free"));
  const conversationTurns = paid ? answerTurns.filter((turn) => turn.kind !== "detailed" && turn.kind !== "safety") : [];
  const readingTurns = answerTurns.filter((turn) => !conversationTurns.includes(turn));
  const exchanges: { id: string; question?: PublicConversationTurn; number?: number; answers: PublicConversationTurn[] }[] = [];
  let questionNumber = 0;
  for (const turn of conversationTurns) {
    if (turn.role === "user") {
      exchanges.push({ id: turn.id, question: turn, number: ++questionNumber, answers: [] });
    } else {
      if (!exchanges.length) exchanges.push({ id: turn.id, answers: [] });
      exchanges[exchanges.length - 1].answers.push(turn);
    }
  }
  function renderTurn(turn: PublicConversationTurn) {
    if (turn.kind === "safety" && isSafetyNotice(turn.content)) return <SafetyRecord key={turn.id} turnId={turn.id} notice={turn.content} />;
    if (turn.role === "user") return <UserRecord key={turn.id} turn={turn} />;
    return <AssistantRecord key={turn.id} turn={turn} locked={lockFreeReading && turn.kind === "free"} />;
  }
  return <section className="consultation-timeline" aria-label="꿈 상담 기록">
    {readingTurns.map(renderTurn)}
    {children}
    {conversation || conversationTurns.length ? <section className="reading-conversation" id="reading-conversation" aria-labelledby="reading-conversation-title">
      <header className="reading-conversation-heading">
        <p>나의 추가 질문</p>
        <h2 id="reading-conversation-title">내 꿈에 대해 더 물어보기</h2>
        <p>마음에 남은 장면이나 내 상황과 연결해 이야기해보세요.</p>
      </header>
      <div className="reading-conversation-history">{exchanges.map((exchange) => (
        <section className="question-answer-card" key={exchange.id} aria-label={exchange.number ? `질문 ${exchange.number}과 답변` : "추가 답변"}>
          {exchange.question ? <UserRecord turn={exchange.question} questionNumber={exchange.number} /> : null}
          <div className="question-answer-body">{exchange.answers.map(renderTurn)}</div>
        </section>
      ))}</div>
      {conversation}
    </section> : null}
    {sourceTurns.length > 0 ? <details className="reading-source">
      <summary>내가 기록한 꿈 <ChevronDown size={16} aria-hidden="true" /></summary>
      <div>{sourceTurns.map((turn) => <UserRecord key={turn.id} turn={turn} />)}</div>
    </details> : null}
  </section>;
}

function PaidPreview({
  reading,
  token,
  purchaseLoginRequired,
  editing,
  onCheckout,
  onViewed
}: {
  reading: PublicReading;
  token?: string;
  purchaseLoginRequired: boolean;
  editing: boolean;
  onCheckout: () => void;
  onViewed: () => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const viewedRef = useRef(false);
  const [prepared, setPrepared] = useState<PreparedPaidPreview | null>(null);
  const [preparing, setPreparing] = useState(false);
  const preparingRef = useRef(false);
  const [previewError, setPreviewError] = useState("");
  const offer = reading.paidOffer;
  const isMockCheckout = reading.checkoutMode === "mock";
  const canStartCheckout = reading.canPurchaseFullReading;
  const previewRequired = offer?.promiseVersion !== "paid-offer-v2" && canStartCheckout;

  useEffect(() => { setPrepared(null); setPreviewError(""); }, [reading.id, offer?.promiseSha256]);

  async function preparePreview() {
    if (preparingRef.current || !previewRequired) return;
    preparingRef.current = true;
    setPreparing(true);
    setPreviewError("");
    try {
      const result = await requestJson<{ preview: PreparedPaidPreview }>(`/api/readings/${encodeURIComponent(reading.id)}/paid-preview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restoreToken: token })
      });
      setPrepared(result.preview);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "미리보기를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally { preparingRef.current = false; setPreparing(false); }
  }

  useEffect(() => {
    if (previewRequired) void preparePreview();
    // The preview is immutable for a given reading and promise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading.id, offer?.promiseSha256, previewRequired]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || viewedRef.current) return;
    if (!("IntersectionObserver" in window)) {
      viewedRef.current = true;
      onViewed();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || viewedRef.current) return;
        viewedRef.current = true;
        onViewed();
        observer.disconnect();
      },
      { threshold: 0.35 }
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [onViewed]);

  if (reading.entitlement.fullReadingPurchased || reading.safetyNotice?.blocksInterpretation || !offer) return null;
  return (
    <section
      ref={sectionRef}
      id="detailed-preview"
      className={`deep-reading-offer deep-reading-offer--continuation deep-reading-offer--${offer.riskClass}`}
      aria-labelledby="deep-reading-title"
    >
      {!previewRequired ? <div className="offer-heading">
        <div className="offer-heading-meta">
          <p className="record-kicker">상세 해몽</p>
        </div>
        <h2 id="deep-reading-title">{offer.headline}</h2>
        <p className="offer-bridge">{offer.bridge}</p>
      </div> : null}
      {previewRequired ? (
        <div className="prepared-reading-preview">
          <p className="record-kicker">상세 해몽 미리보기</p>
          <h2 id="deep-reading-title">{prepared?.title ?? "이 꿈의 상세 풀이"}</h2>
          {prepared ? <>
            <ReadingBody paragraphs={[prepared.lead]} locked />
            <section className="prepared-reading-section prepared-reading-locked">
              <h3>{prepared.opening.title}</h3>
              <ReadingBody paragraphs={prepared.opening.paragraphs} locked />
            </section>
            {prepared.lockedSections.map((section, index) => <section className="prepared-reading-section prepared-reading-locked" key={index}>
              <h3>{section.title}</h3>
              <div className="prepared-reading-veil" aria-hidden="true"><span /><span /><span /></div>
              <p className="sr-only">결제 후 {section.paragraphCount}개 문단을 읽을 수 있어요.</p>
            </section>)}
            <p className="prepared-reading-note"><LockKeyhole size={14} /> 가린 내용은 결제 후 이 결과 그대로 열려요.</p>
          </> : preparing ? <p role="status">상세 해몽을 작성하고 검수하고 있어요…</p> : null}
          {previewError ? <p className="form-error" role="alert">{previewError}</p> : null}
          {previewError ? <button type="button" onClick={() => void preparePreview()} disabled={preparing || editing}>다시 준비하기</button> : null}
        </div>
      ) : null}
      <div className="offer-action">
        <div>
          <strong>{offer.promiseVersion === "paid-offer-v2" ? offer.checkoutTitle : "이 풀이의 전체 내용 열기"}</strong>
          <span>{offer.promiseVersion === "paid-offer-v2" ? offer.checkoutSummary : "상세 해몽 + 질문 2회"}</span>
        </div>
        {offer.promiseVersion !== "paid-offer-v2" ? <p className="offer-followup-note">결제 후 이 풀이에서 추가 질문 2회를 이용할 수 있어요.</p> : null}
        {canStartCheckout ? <>
          {isMockCheckout ? <p className="offer-checkout-mode"><ShieldCheck size={13} aria-hidden="true" />테스트 결제 · 실제 청구 없음</p> : null}
          <button className="primary-button" type="button" disabled={editing || (previewRequired && !prepared)} onClick={onCheckout}>
            {isMockCheckout ? "전체 풀이 열기 · 테스트" : "전체 풀이 열기 · 990원"} <ArrowRight size={18} />
          </button>
          <p className="offer-purchase-note">{isMockCheckout ? "카드 입력 없이 유료 기능을 체험할 수 있어요." : "990원 한 번 결제 · 정기결제 없음"}</p>
          {purchaseLoginRequired && !isMockCheckout ? <p className="offer-purchase-note">로그인 후 결제로 이어져요.</p> : null}
          {editing ? <p className="offer-next-step">추가할 내용을 반영하거나 입력을 닫으면 이어갈 수 있어요.</p> : null}
        </> : <p className="offer-unavailable">현재는 결제 기능을 준비 중이에요. 무료 첫 해석은 그대로 볼 수 있습니다.</p>}
      </div>
    </section>
  );
}

function CheckoutSheet({
  reading,
  token,
  product,
  selectedCard,
  onClose,
  onPaid
}: {
  reading: PublicReading;
  token?: string;
  product: OrderProduct;
  selectedCard?: PaidPreviewItem | null;
  onClose: () => void;
  onPaid: (reading: PublicReading) => void;
}) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(() => initialProgress("주문 정보를 서버에 전달하는 중이에요"));
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const busyRef = useRef(busy);
  const closeHandlerRef = useRef(onClose);
  busyRef.current = busy;
  closeHandlerRef.current = onClose;
  const isPack = product === "followup_pack_2";
  const isMockCheckout = reading.checkoutMode === "mock";
  const needsDetail = !isPack && reading.freeDetailGuidance?.ready === false;

  useEffect(() => {
    const previous = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) closeHandlerRef.current();
      if (event.key !== "Tab") return;
      const controls = Array.from(sheetRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
      ) ?? []).filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first) { event.preventDefault(); sheetRef.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  async function pay() {
    if (busy || needsDetail) return;
    if (!consent) {
      setError("맞춤형 콘텐츠 생성 시작 안내를 확인해 주세요.");
      return;
    }
    setProgress(initialProgress("주문 정보를 서버에 전달하는 중이에요"));
    setBusy(true);
    setError("");
    try {
      const purchasePromise = !isPack ? reading.paidOffer : null;
      if (!isPack && !purchasePromise) throw new Error("결제 정보를 새로 불러와 주세요.");
      const response = await requestJson<{
        order: {
          orderId: string;
          amount: number;
          product: OrderProduct;
          orderName: string;
          customerKey: string;
          mode: "mock" | "toss" | "portone";
          clientKey: string | null;
          portone: { storeId: string; channelKey: string } | null;
        };
      }>("/api/orders", {
        method: "POST",
        body: JSON.stringify(buildOrderRequestPayload({
          readingId: reading.id,
          product,
          restoreToken: token,
          promise: purchasePromise
        }))
      });
      const { order } = response;
      setProgress({ stage: "order_created", percent: 8, label: "결제할 주문 정보를 준비했어요" });
      if (order.mode === "mock") {
        const confirmed = await requestProgressJson<{ reading: PublicReading }>(
          "/api/payments/confirm",
          {
            method: "POST",
            body: JSON.stringify({ paymentKey: `mock_${crypto.randomUUID()}`, orderId: order.orderId, amount: order.amount })
          },
          setProgress
        );
        onPaid(confirmed.reading);
        return;
      }
      if (order.mode === "portone") {
        if (!order.portone) throw new Error("결제 연결 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
        try {
          const restore = new URL(reading.restoreUrl);
          sessionStorage.setItem(`yeoun:checkout:return:${order.orderId}`, `${restore.pathname}${restore.search}`);
        } catch { /* The original browser session still supports normal returns. */ }
        const PortOne = await import("@portone/browser-sdk/v2");
        const successUrl = new URL("/checkout/success", window.location.origin);
        successUrl.search = new URLSearchParams({ orderId: order.orderId, amount: String(order.amount), product, readingId: reading.id }).toString();
        setProgress({ stage: "payment_window_opening", percent: 8, label: "안전한 카드 결제창으로 이동하고 있어요" });
        const result = await PortOne.requestPayment({
          ...order.portone,
          paymentId: order.orderId,
          orderName: order.orderName,
          totalAmount: order.amount,
          currency: "CURRENCY_KRW",
          payMethod: "CARD",
          customer: { customerId: order.customerKey },
          redirectUrl: successUrl.toString(),
          forceRedirect: true,
          noticeUrls: [`${window.location.origin}/api/payments/portone/webhook`]
        });
        if (result?.code) throw new Error(result.message || "결제를 완료하지 않았어요. 이 꿈에서 다시 진행할 수 있어요.");
        if (result?.paymentId) {
          successUrl.searchParams.set("paymentId", result.paymentId);
          window.location.assign(successUrl.toString());
        }
        return;
      }
      if (!order.clientKey || !window.TossPayments) {
        throw new Error("결제창을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
      const payment = window.TossPayments(order.clientKey).payment({ customerKey: order.customerKey });
      await payment.requestPayment({
        method: "CARD",
        amount: { currency: "KRW", value: order.amount },
        orderId: order.orderId,
        orderName: order.orderName,
        customerName: "여운 이용자",
        successUrl: `${window.location.origin}/checkout/success?product=${encodeURIComponent(product)}`,
        failUrl: `${window.location.origin}/checkout/fail?readingId=${encodeURIComponent(reading.id)}`
      });
    } catch (caught) {
      setProgress((current) => ({
        stage: "payment_result_recovery",
        percent: current.percent,
        label: "연결이 끊겼는지 결제·생성 상태를 다시 확인하고 있어요"
      }));
      const accessToken = token ?? restoreToken(reading.restoreUrl);
      const query = accessToken ? `?token=${encodeURIComponent(accessToken)}` : "";
      try {
        const recovered = await requestJson<{ reading: PublicReading }>(
          `/api/readings/${encodeURIComponent(reading.id)}${query}`
        );
        if (isPack ? recovered.reading.entitlement.extraPackPurchased : recovered.reading.entitlement.fullReadingPurchased) {
          onPaid(recovered.reading);
          return;
        }
      } catch {
        // Preserve the original payment/stream error when recovery is unavailable.
      }
      setError(caught instanceof Error ? caught.message : "결제를 시작하지 못했어요.");
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section ref={sheetRef} className="checkout-sheet" role="dialog" aria-modal="true" aria-labelledby="checkout-title" tabIndex={-1}>
        <button ref={closeRef} className="sheet-close" type="button" onClick={onClose} disabled={busy} aria-label="결제 요약 닫기"><X size={20} /></button>
        <div className="sheet-handle" aria-hidden="true" />
        <p className="utility-label">{isMockCheckout ? "테스트 결제" : "결제 전 확인"}</p>
        <div className="checkout-price-row">
          <div>
            <h2 id="checkout-title">{isPack ? "질문 2회 더 이어가기" : "상세 해몽 + 질문 2회"}</h2>
            <p>{isPack ? "이 꿈에서 두 번 더 이어서 물어볼 수 있어요." : "지금 읽은 꿈으로 이어가요. 다시 입력할 필요 없어요."}</p>
          </div>
          <strong><span>₩</span>990</strong>
        </div>
        <p className="checkout-purchase-note">{isMockCheckout ? "990원 상품을 실제 청구 없이 테스트해요." : "한 번 결제하는 상품이에요. 정기결제는 없어요."}</p>
        {needsDetail ? (
          <section className="free-detail checkout-detail" aria-labelledby="checkout-detail-title">
            <p className="free-detail-kicker">결제 전 확인</p>
            <h3 id="checkout-detail-title">{reading.freeDetailGuidance?.question}</h3>
            <p className="free-detail-hint">먼저 결과 화면의 확인 질문에 답해 주세요. 확인이 끝나기 전에는 결제하지 않아요.</p>
            <button className="secondary-button" type="button" onClick={onClose}>확인 질문으로 돌아가기</button>
          </section>
        ) : <>
        {!isPack && selectedCard ? (
          <div className="checkout-selected-question">
            <span>관심 있게 본 내용 · 전체 풀이에 포함돼요</span>
            <strong>{selectedCard.title}</strong>
          </div>
        ) : null}
        <ul className="checkout-includes">
          {isPack ? (
            <>
              <li><Check size={16} />현재 상담 맥락 그대로 이어지는 답변</li>
              <li><Check size={16} />새 정보에 따라 달라지는 해석 표시</li>
              <li><Check size={16} />한 꿈에서 총 4회까지만 질문</li>
            </>
          ) : (
            <>
              <li><Check size={16} />확인한 꿈의 사실과 답변을 반영한 통합 해석</li>
              <li><Check size={16} />이 해석을 고른 근거와 다른 읽기와의 차이</li>
              <li><Check size={16} />새 관점으로 더 묻는 심화 질문 2회</li>
            </>
          )}
        </ul>
        <label className="consent-check">
          <input type="checkbox" checked={consent} disabled={busy} onChange={(event) => { setConsent(event.target.checked); setError(""); }} />
          <span aria-hidden="true"><Check size={13} /></span>
          <em>
            맞춤형 디지털 콘텐츠 생성이 결제 즉시 시작되며, 제공이 시작된 뒤에는 청약철회가 제한될 수 있음을 확인했습니다.
            <Link href="/refund" target="_blank"> 환불 기준 보기</Link>
          </em>
        </label>
        {isMockCheckout ? (
          <p className="mock-payment-note"><ShieldCheck size={14} />카드 정보 입력이나 실제 청구 없이 진행돼요.</p>
        ) : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {busy ? <ProgressDisplay progress={progress} compact showNote={!isPack} /> : null}
        <button className="primary-button primary-button--wide" type="button" onClick={() => void pay()} disabled={busy || !consent}>
          {busy ? <>{progress.percent}% 처리 중</> : <>{isMockCheckout ? isPack ? "테스트 결제로 질문 2회 열기" : "테스트 결제로 상세 풀이 보기" : isPack ? "990원 결제하고 두 번 더 묻기" : "990원 결제하고 전체 풀이 보기"} <ArrowRight size={18} /></>}
        </button>
        <p className="checkout-footnote"><LockKeyhole size={13} /> 중복결제·미제공·기술 오류 전액 환불</p>
        </>}
      </section>
    </div>
  );
}

function latestSuggestedQuestions(reading: PublicReading) {
  for (let index = reading.timeline.length - 1; index >= 0; index -= 1) {
    const content = reading.timeline[index]?.content;
    if (content && isAssistantPayload(content) && content.suggestedQuestions.length > 0) return content.suggestedQuestions;
  }
  return ["현실의 일과 연결해줘", "관계에 대한 꿈인지 봐줘", "상대에게 전할 말을 써줘"];
}

function ConversationDock({
  reading,
  token,
  onUpdate,
  onBuyPack
}: {
  reading: PublicReading;
  token?: string;
  onUpdate: (reading: PublicReading) => void;
  onBuyPack: () => void;
}) {
  const { rememberDraft } = useReadingTransition();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(() => initialProgress("질문을 서버에 전달하는 중이에요"));
  const [error, setError] = useState("");
  const composing = useRef(false);
  const sendingRef = useRef(false);
  const pendingRequestRef = useRef<{ message: string; clientMessageId: string } | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestions = latestSuggestedQuestions(reading);
  const remaining = reading.entitlement.remainingQuestions;

  useEffect(() => {
    if (!cooldownUntil) return;
    const update = () => {
      const seconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownSeconds(seconds);
      if (!seconds) { setCooldownUntil(0); setError(""); }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const updateOffset = () => {
      const offset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      document.documentElement.style.setProperty("--keyboard-offset", `${offset}px`);
    };
    updateOffset();
    viewport?.addEventListener("resize", updateOffset);
    viewport?.addEventListener("scroll", updateOffset);
    return () => {
      viewport?.removeEventListener("resize", updateOffset);
      viewport?.removeEventListener("scroll", updateOffset);
      document.documentElement.style.removeProperty("--keyboard-offset");
    };
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`;
  }, [message]);

  async function send() {
    const trimmed = message.trim();
    if (sendingRef.current || cooldownUntil > Date.now()) return;
    if (trimmed.length < 2) {
      setError("질문을 두 글자 이상 적어주세요.");
      return;
    }
    sendingRef.current = true;
    if (pendingRequestRef.current?.message !== trimmed) {
      pendingRequestRef.current = { message: trimmed, clientMessageId: `msg_${crypto.randomUUID().replaceAll("-", "")}` };
    }
    setProgress(initialProgress("질문을 서버에 전달하는 중이에요"));
    setSending(true);
    setError("");
    try {
      const response = await requestProgressJson<{ reading: PublicReading }>(
        `/api/readings/${encodeURIComponent(reading.id)}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            clientMessageId: pendingRequestRef.current!.clientMessageId,
            message: trimmed,
            restoreToken: token
          })
        },
        setProgress
      );
      pendingRequestRef.current = null;
      setMessage("");
      onUpdate(response.reading);
    } catch (caught) {
      if (caught instanceof ProgressRequestError && caught.retryAfterSeconds) {
        setCooldownSeconds(caught.retryAfterSeconds);
        setCooldownUntil(Date.now() + caught.retryAfterSeconds * 1000);
      }
      setError(caught instanceof Error ? caught.message : "답을 완성하지 못했어요. 질문 횟수는 차감하지 않았어요.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || composing.current || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  }

  if (remaining === 0) {
    return (
      <aside className="conversation-dock conversation-dock--exhausted" aria-label="질문 이용 안내">
        <div className="dock-inner">
          {reading.entitlement.canPurchaseExtraPack ? (
            <>
              <div><p className="dock-label">남은 질문 0회 · 기본 질문을 모두 사용했어요</p><strong>더 궁금한 점이 있다면 질문을 이어갈 수 있어요.</strong></div>
              <button className="primary-button" type="button" onClick={onBuyPack}>질문 2회 더 이어가기 · 990원</button>
            </>
          ) : (
            <>
              <div><p className="dock-label">남은 질문 0회 · 이 꿈의 질문을 모두 사용했어요</p><strong>다음 이야기는 새 꿈으로 시작해주세요.</strong></div>
              <Link className="primary-button" href="/" onClick={() => rememberDraft(null)}>새 꿈으로 시작하기 <ArrowRight size={17} /></Link>
            </>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="conversation-dock" aria-label="후속 질문 입력">
      <div className="dock-inner dock-inner--composer">
        <div className="composer-topline">
          <span><MessageCircle size={15} />더 궁금한 점을 물어보세요 <small>남은 질문 {remaining}회</small></span>
          <span>{message.length.toLocaleString("ko-KR")} / {MAX_MESSAGE_LENGTH.toLocaleString("ko-KR")}</span>
        </div>
        {sending ? <ProgressDisplay progress={progress} compact showNote={false} /> : null}
        {suggestions.length > 0 ? <details className="composer-suggestions">
          <summary>어떤 질문을 할 수 있나요?</summary>
        <div className="suggestion-row" aria-label="추천 질문">
          {suggestions.slice(0, 3).map((suggestion) => (
            <button key={suggestion} type="button" disabled={sending} onClick={() => { setMessage(suggestion); setError(""); textareaRef.current?.focus(); }}>
              {suggestion}
            </button>
          ))}
        </div>
        </details> : null}
        <div className="composer-field">
          <label className="sr-only" htmlFor="conversation-message">꿈에 대해 이어서 질문하기</label>
          <textarea
            ref={textareaRef}
            id="conversation-message"
            disabled={sending}
            rows={1}
            maxLength={MAX_MESSAGE_LENGTH}
            value={message}
            placeholder="풀이에서 궁금했던 점을 적어주세요"
            onChange={(event) => { setMessage(event.target.value); setError(""); }}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={handleKeyDown}
            aria-invalid={Boolean(error)}
          />
          <button type="button" onClick={() => void send()} disabled={sending || cooldownSeconds > 0 || message.trim().length < 2} aria-label={sending ? `답변 생성 ${progress.percent}%` : cooldownSeconds > 0 ? `${cooldownSeconds}초 후 질문 보내기` : "질문 보내기"}>
            {sending ? <RefreshCw className="spin" size={17} /> : <Send size={17} />}<span>{sending ? "답변 중" : "보내기"}</span>
          </button>
        </div>
        {error ? <p className="dock-error" role="alert">{error}</p> : null}
        {cooldownSeconds > 0 ? <p className="dock-error" role="status">{cooldownSeconds}초 후 다시 보낼 수 있어요. 질문 횟수는 차감되지 않았어요.</p> : null}
      </div>
    </aside>
  );
}

function DetailStatus({
  reading,
  retrying,
  retryProgress,
  error,
  syncError,
  onRetry
}: {
  reading: PublicReading;
  retrying: boolean;
  retryProgress: OperationProgress;
  error: string;
  syncError: string;
  onRetry: () => void;
}) {
  if (!reading.entitlement.fullReadingPurchased || reading.detailGenerationStatus === "ready") return null;
  if (reading.detailGenerationStatus === "failed") {
    return (
      <section className="detail-status detail-status--failed">
        <p className="record-kicker">결제는 정상적으로 확인됐어요</p>
        <h2>{retrying ? "상세 풀이를 다시 작성하고 있어요" : "상세 해몽을 아직 완성하지 못했어요"}</h2>
        <p>{reading.paidRecovery?.status === "attention" ? reading.paidRecovery.message : reading.canRetryDetailedReading ? "결제 내역과 남은 질문은 그대로예요. 추가 비용 없이 다시 만들 수 있어요." : "결제 내역과 남은 질문은 그대로예요. 확인 질문에 답하면 추가 비용 없이 풀이를 완성할게요."}</p>
        {reading.paidRecovery?.status === "attention" ? <p>문의할 때 확인 번호 {reading.paidRecovery.reference}를 알려주세요.</p> : null}
        {syncError ? <p role="status">{syncError}</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {retrying ? <ProgressDisplay progress={retryProgress} compact /> : null}
        {reading.canRetryDetailedReading ? <button className="primary-button" type="button" onClick={onRetry} disabled={retrying}>
          {retrying ? <>{retryProgress.percent}% 다시 만드는 중</> : <><RefreshCw size={17} /> 상세 해몽 다시 만들기</>}
        </button> : null}
      </section>
    );
  }
  return (
    <section className="detail-status" aria-live="polite" aria-busy="true">
      <RefreshCw className="spin" size={20} /><div><p className="record-kicker">결제가 확인됐어요</p><h2>상세 해몽을 상담 기록에 잇고 있어요</h2>{reading.paidRecovery ? <p>{reading.paidRecovery.message}</p> : null}{syncError ? <p role="status">{syncError}</p> : null}</div>
    </section>
  );
}

function ResultController({
  initialReading,
  token,
  showHeader = true,
  purchaseLoginRequired = false,
  reviewSignedIn = false,
  resumeCheckout = false,
  previewKey,
  onReadingChange
}: {
  initialReading: PublicReading;
  token?: string;
  showHeader?: boolean;
  purchaseLoginRequired?: boolean;
  reviewSignedIn?: boolean;
  resumeCheckout?: boolean;
  previewKey?: string;
  onReadingChange?: (reading: PublicReading) => void;
}) {
  const { stage, rememberDraft } = useReadingTransition();
  const router = useRouter();
  const [supplementing, setSupplementing] = useState(false);
  const [reading, setReading] = useState(initialReading);
  const [checkoutProduct, setCheckoutProduct] = useState<OrderProduct | null>(
    resumeCheckout && initialReading.canPurchaseFullReading && (!purchaseLoginRequired || reviewSignedIn) ? "full_reading" : null
  );
  const [selectedOfferCard, setSelectedOfferCard] = useState<PaidPreviewItem | null>(
    initialReading.paidOffer?.cards.find((card) => card.key === previewKey) ?? null
  );
  const [retrying, setRetrying] = useState(false);
  const detailFailed = reading.detailGenerationStatus === "failed" && !retrying;
  const [retryProgress, setRetryProgress] = useState(() => initialProgress("재시도 요청을 서버에 전달하는 중이에요"));
  const [retryError, setRetryError] = useState("");
  const [paidSyncError, setPaidSyncError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const trackedTurns = useRef(new Set<string>());
  const paywallViewed = useRef(false);
  const previousTimelineLength = useRef(initialReading.timeline.length);
  const introRef = useRef<HTMLElement>(null);
  const effectiveToken = token ?? restoreToken(reading.restoreUrl);
  const needsPurchaseLogin = purchaseLoginRequired && !reviewSignedIn;
  const showDock =
    reading.entitlement.fullReadingPurchased &&
    reading.detailGenerationStatus === "ready" &&
    !reading.safetyNotice?.blocksInterpretation;

  useEffect(()=> {
    // Apply server revalidation to a cached first paint, without allowing a
    // slow earlier GET to replace a newer payment or correction response.
    setReading(current=> !current.recordRevision || (initialReading.recordRevision && initialReading.recordRevision >= current.recordRevision) ? initialReading : current);
  },[initialReading]);

  useEffect(() => {
    if (resumeCheckout) return;
    scrollToTopImmediately();
    introRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    onReadingChange?.(reading);
  }, [onReadingChange, reading]);

  useEffect(() => {
    for (const turn of reading.timeline) {
      if (trackedTurns.current.has(turn.id)) continue;
      trackedTurns.current.add(turn.id);
      if (turn.kind === "free") track("free_result_viewed", reading.id, { source: "timeline" });
      if (turn.kind === "detailed") {
        track("deep_reading_viewed", reading.id, { source: "timeline" });
        track("paid_result_viewed", reading.id, { source: "timeline" });
      }
      if (turn.kind === "followup" && turn.role === "kkumgyeol") track("conversation_reply_viewed", reading.id, { source: "timeline" });
      if (turn.kind === "safety") track("safety_route_shown", reading.id, { source: "timeline" });
    }
  }, [reading.id, reading.timeline]);

  useEffect(() => {
    if (reading.timeline.length > previousTimelineLength.current) {
      const added = reading.timeline.slice(previousTimelineLength.current);
      const target = added.find((turn) => turn.kind === "detailed") ?? added.at(-1);
      window.setTimeout(() => {
        const element = target ? document.getElementById(`turn-${target.id}`) : null;
        element?.scrollIntoView({ behavior: "smooth", block: "start" });
        element?.focus({ preventScroll: true });
      }, 80);
    }
    previousTimelineLength.current = reading.timeline.length;
  }, [reading.timeline.length]);

  useEffect(() => {
    if (!reading.entitlement.fullReadingPurchased || reading.detailGenerationStatus === "ready") return;
    let active = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      const query = effectiveToken ? `?token=${encodeURIComponent(effectiveToken)}` : "";
      try {
        const response = await requestJson<{ reading: PublicReading }>(`/api/readings/${encodeURIComponent(reading.id)}${query}`);
        if (active) { setReading(response.reading); setPaidSyncError(""); }
      } catch {
        if (active) setPaidSyncError("서버 연결이 잠시 끊겼어요. 화면이 다시 연결되면 구매한 풀이 상태를 자동으로 확인할게요.");
      } finally { inFlight = false; }
    };
    const intervalMs = reading.detailGenerationStatus === "generating" ? 5_000
      : reading.paidRecovery?.status === "attention" ? 15_000 : null;
    const poll = intervalMs ? window.setInterval(() => void refresh(), intervalMs) : null;
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    void refresh();
    return () => {
      active = false;
      if (poll) window.clearInterval(poll);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [effectiveToken, reading.detailGenerationStatus, reading.entitlement.fullReadingPurchased, reading.id, reading.paidRecovery?.status]);

  async function retryDetailed() {
    setRetryProgress(initialProgress("재시도 요청을 서버에 전달하는 중이에요"));
    setRetrying(true);
    setRetryError("");
    try {
      const response = await requestProgressJson<{ reading: PublicReading }>(
        `/api/readings/${encodeURIComponent(reading.id)}/retry`,
        {
          method: "POST",
          body: JSON.stringify({ restoreToken: effectiveToken })
        },
        setRetryProgress
      );
      setReading(response.reading);
    } catch (caught) {
      setRetryError(caught instanceof Error ? caught.message : "상세 해몽을 다시 만들지 못했어요.");
    } finally {
      setRetrying(false);
    }
  }

  async function deleteReading() {
    setDeleting(true);
    setDeleteError("");
    try {
      const query = effectiveToken ? `?token=${encodeURIComponent(effectiveToken)}` : "";
      const response = await fetch(`/api/readings/${encodeURIComponent(reading.id)}${query}`, { method: "DELETE", cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json()) as ApiErrorPayload;
        throw new Error(payload.error?.message ?? "결과를 삭제하지 못했어요.");
      }
      window.location.assign("/?deleted=1");
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "결과를 삭제하지 못했어요.");
      setDeleting(false);
    }
  }

  async function copyRecoveryLink() {
    try {
      await navigator.clipboard.writeText(reading.restoreUrl);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1_600);
    } catch {
      setLinkCopied(false);
    }
  }

  function checkoutRoute(next: PublicReading, card: PaidPreviewItem | null) {
    return `${readingRoute(next)}&checkout=full_reading${card ? `&preview=${encodeURIComponent(card.key)}` : ""}`;
  }

  function beginCheckout(product: OrderProduct, selectedCard: PaidPreviewItem | null = null) {
    if (needsPurchaseLogin && (product !== "full_reading" || reading.canPurchaseFullReading)) {
      stage(reading);
      const nextPath = product === "full_reading" ? checkoutRoute(reading, selectedCard) : `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/login?next=${encodeURIComponent(nextPath)}`);
      return;
    }
    setSelectedOfferCard(selectedCard);
    setCheckoutProduct(product);
  }

  return (
    <div className={showDock ? "consultation-page consultation-page--reading" : "consultation-page"}>
      {showHeader ? <AppHeader compact /> : null}
      <div className="consultation-shell">
        {!showDock && !reading.safetyNotice?.blocksInterpretation ? <ReadingSteps current={reading.entitlement.fullReadingPurchased ? 3 : 2} /> : null}
        <header ref={introRef} className={showDock ? "consultation-intro sr-only" : "consultation-intro"} tabIndex={-1}>
          <h1>{reading.safetyNotice?.blocksInterpretation ? "지금 필요한 이야기부터 할게요." : reading.entitlement.fullReadingPurchased ? reading.detailGenerationStatus === "ready" ? "꿈 풀이가 도착했어요" : detailFailed ? "상세 풀이를 완성하지 못했어요." : "꿈의 이야기를 풀고 있어요." : reading.timeline.some(isMissingFreeMeaning) ? "꿈에 무엇이 나왔나요?" : "기억난 장면의 첫 읽기"}</h1>
          <p>{reading.safetyNotice?.blocksInterpretation ? "말해준 내용을 바탕으로 먼저 확인할 안내예요." : reading.entitlement.fullReadingPurchased ? reading.detailGenerationStatus === "ready" ? "핵심부터 읽고, 궁금한 점은 아래에서 이어 물어보세요." : detailFailed ? "기다리게 해서 죄송해요. 아래에서 추가 결제 없이 다시 시도할 수 있어요." : "말해준 장면과 답변을 바탕으로 풀이를 작성하고 있어요." : reading.timeline.some(isMissingFreeMeaning) ? "사람, 동물, 물건, 장소 중 기억나는 것 하나만 적어주세요." : "각 상징이 어떤 의미로 읽히는지 살펴보세요."}</p>
        </header>
        <ConsultationTimeline reading={reading} conversation={showDock ? (
          <ConversationDock reading={reading} token={effectiveToken} onUpdate={setReading} onBuyPack={() => beginCheckout("followup_pack_2")} />
        ) : null}>
        <PaidPreview
          reading={reading}
          token={effectiveToken}
          purchaseLoginRequired={needsPurchaseLogin}
          editing={supplementing}
          onViewed={() => {
            if (paywallViewed.current || !reading.paidOffer) return;
            paywallViewed.current = true;
            track("paywall_viewed", reading.id, {
              source: "timeline",
              offerVariant: reading.paidOffer.variant,
              riskClass: reading.paidOffer.riskClass
            });
          }}
          onCheckout={() => {
            const offer = reading.paidOffer;
            track("paywall_clicked", reading.id, {
              source: "offer_cta",
              ...(offer ? { offerVariant: offer.variant, riskClass: offer.riskClass } : {}),
              cardKey: "offer_cta"
            });
            beginCheckout("full_reading");
          }}
        />
        {!reading.entitlement.fullReadingPurchased && !reading.canCorrectReading ? <FreeDetailForm reading={reading} token={effectiveToken} optional={Boolean(reading.paidOffer)} onEditingChange={setSupplementing} onUpdated={(next) => {
          stage(next); setReading(next); setSupplementing(false);
          router.replace(readingRoute(next));
        }} /> : null}
        </ConsultationTimeline>
        <DetailStatus
          reading={reading}
          retrying={retrying}
          retryProgress={retryProgress}
          error={retryError}
          syncError={paidSyncError}
          onRetry={() => void retryDetailed()}
        />

        <details className="reading-management"><summary>기록 보관 및 관리 <ChevronDown size={16} aria-hidden="true" /></summary><section className="record-tools" aria-label="상담 기록 관리">
          <div><p>기록 보관 기간</p><span>{reading.recoveryNotice ?? "보관 기간이 끝나면 복구 링크와 구매한 풀이에도 접근할 수 없어요."}</span></div>
          <button type="button" onClick={() => void copyRecoveryLink()}>{linkCopied ? <Check size={15} /> : <Copy size={15} />}{linkCopied ? "복사했어요" : "복구 링크 복사"}</button>
          <Link href="/" onClick={() => rememberDraft(null)}><RefreshCw size={15} />새 꿈 시작</Link>
          {!deleteConfirm ? (
            <button className="danger-text-button" type="button" onClick={() => setDeleteConfirm(true)}><Trash2 size={15} />기록 삭제</button>
          ) : (
            <div className="delete-confirm">
              <p>꿈 원문·답변·주문 기록을 모두 삭제하며 복구할 수 없어요.</p>
              <button type="button" onClick={() => void deleteReading()} disabled={deleting}>{deleting ? "삭제 중" : "영구 삭제"}</button>
              <button type="button" onClick={() => setDeleteConfirm(false)} disabled={deleting}>취소</button>
            </div>
          )}
          {deleteError ? <p className="form-error" role="alert">{deleteError}</p> : null}
        </section></details>
      </div>

      {checkoutProduct ? (
        <CheckoutSheet
          reading={reading}
          token={effectiveToken}
          product={checkoutProduct}
          selectedCard={checkoutProduct === "full_reading" ? selectedOfferCard : null}
          onClose={() => {
            setCheckoutProduct(null);
            setSelectedOfferCard(null);
            if (resumeCheckout) router.replace(readingRoute(reading), { scroll: false });
            window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".offer-action .primary-button")?.focus({ preventScroll: true }));
          }}
          onPaid={(next) => {
            const purchasedProduct = checkoutProduct;
            setReading(next);
            setCheckoutProduct(null);
            setSelectedOfferCard(null);
            if (resumeCheckout) router.replace(readingRoute(next), { scroll: false });
            if (purchasedProduct === "followup_pack_2") {
              window.setTimeout(() => document.getElementById("conversation-message")?.focus(), 80);
            }
          }}
        />
      ) : null}
    </div>
  );
}

export function DreamExperience({ entry = { source: "home", topic: null }, testExamples = [] }: { entry?: DreamEntry; testExamples?: DreamTestExample[] }) {
  const { stage } = useReadingTransition();
  const router = useRouter();

  return (
    <main className={journalInputStyles.main} id="main-content">
      <ReadingSteps current={1} />
      <section className={journalInputStyles.intro} aria-labelledby="dream-intake-title">
        <h1 id="dream-intake-title">{entry.topic ? `${entry.topic.title}, 어떤 장면이었나요?` : "무슨 꿈을 꾸셨나요?"}</h1>
        <p className={journalInputStyles.lead}>
          꿈속 상징과 당신이 겪은 장면을 함께 풀어드려요.<br />기억나는 만큼 적고, 궁금했던 뜻부터 읽어보세요.
        </p>
      </section>
      <DreamIntake
        entry={entry}
        testExamples={testExamples}
        onComplete={(reading) => {
          stage(reading);
          router.push(readingRoute(reading));
        }}
      />
      <details className={journalInputStyles.example}>
        <summary>같은 뱀 꿈도, 장면에 따라 어떻게 달라질까요?</summary>
        <p className={journalInputStyles.exampleNote}>풀이 방식을 보여주는 가상 예시예요.</p>
        <div className={journalInputStyles.exampleScenes}>
          <div><h2>뱀에게 쫓기며 달아났다면</h2><p>피하려는 행동과 쫓기는 기분을 단서로, 가까이 두기 어려운 대상이나 부담이라는 읽기를 살펴볼 수 있어요.</p></div>
          <div><h2>뱀을 편안하게 바라봤다면</h2><p>뱀을 살피는 행동과 편안함을 단서로, 낯선 대상에 대한 호기심이나 새로운 가능성이라는 읽기를 살펴볼 수 있어요.</p></div>
        </div>
        <p className={journalInputStyles.exampleNote}>상징의 뜻에 내가 한 행동과 남은 기분을 더해, 내 꿈에 맞는 이유를 설명해요.</p>
      </details>
    </main>
  );
}

export function ReadingExperience({
  id,
  token,
  purchaseLoginRequired = false,
  reviewSignedIn = false,
  resumeCheckout = false,
  previewKey
}: {
  id: string;
  token: string;
  purchaseLoginRequired?: boolean;
  reviewSignedIn?: boolean;
  resumeCheckout?: boolean;
  previewKey?: string;
}) {
  const { recall, remember, rememberDraft } = useReadingTransition();
  const [reading, setReadingState] = useState<PublicReading | null>(null);
  const [progress, setProgress] = useState(() => initialProgress("복구 링크를 서버에 확인하는 중이에요"));
  const [error, setError] = useState("");

  function setReading(next: PublicReading) {
    remember(next);
    setReadingState(next);
  }

  useEffect(() => {
    const cached = recall(id);
    if (cached) {
      setReadingState(cached);
    }
    let active = true;
    setProgress(initialProgress("복구 링크를 서버에 확인하는 중이에요"));
    requestProgressJson<{ reading: PublicReading }>(
      `/api/readings/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`,
      undefined,
      (update) => { if (active) setProgress(update); }
    )
      .then((response) => {
        if (!active) return;
        remember(response.reading);
        setReadingState(response.reading);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "결과를 불러오지 못했어요."); });
    return () => { active = false; };
  }, [id, recall, remember, token]);

  if (error) {
    return (
      <main id="main-content" className="recovery-error">
        <DreamMark size={54} />
        <p className="utility-label">복구할 수 없는 링크</p>
        <h1>{error}</h1>
        <p>비회원 기록은 7일간 보관하며, 기간이 지나면 구매한 풀이에도 접근할 수 없어요. 기록의 정확한 만료일은 결과 화면에서 확인할 수 있어요.</p>
        <Link className="primary-button" href="/" onClick={() => rememberDraft(null)}>새 꿈 풀어보기 <ArrowRight size={17} /></Link>
      </main>
    );
  }
  if (!reading) return <main id="main-content" className="standalone-loader"><LoadingReading progress={progress} title="보관해 둔 꿈의 결을 찾고 있어요" /></main>;
  if (reading.currentQuestion) {
    return (
      <main id="main-content">
        <ClarificationCard
          key={reading.currentQuestion.id}
          reading={reading}
          token={token}
          onComplete={setReading}
          showHeader={false}
        />
      </main>
    );
  }
  return (
    <main id="main-content">
      <ResultController
        key={reading.id}
        initialReading={reading}
        token={token}
        showHeader={false}
        purchaseLoginRequired={purchaseLoginRequired}
        reviewSignedIn={reviewSignedIn}
        resumeCheckout={resumeCheckout}
        previewKey={previewKey}
        onReadingChange={remember}
      />
    </main>
  );
}
