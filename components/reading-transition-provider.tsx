"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef
} from "react";
import type { Emotion, PublicReading } from "@/lib/types";
import type { InterpretationFocus } from "@/lib/interpretation-focus";

type DreamDraft = { dream: string; emotion: Emotion | null; focus: InterpretationFocus | null };

type ReadingTransitionCache = {
  recall: (id: string) => PublicReading | null;
  remember: (reading: PublicReading) => void;
  stage: (reading: PublicReading) => void;
  recallDraft: () => DreamDraft | null;
  rememberDraft: (draft: DreamDraft | null) => void;
};

const ReadingTransitionContext = createContext<ReadingTransitionCache | null>(null);
const TRANSITION_STORAGE_KEY = "yeoun:reading-transition:v1";
const TRANSITION_TTL_MS = 600_000;

type StoredReadingTransition = {
  expiresAt: number;
  reading: PublicReading;
};

function removeStoredTransition() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(TRANSITION_STORAGE_KEY);
  } catch {
    // A server restore remains available when private browsing rejects storage.
  }
}

function consumeStoredTransition(id: string) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(TRANSITION_STORAGE_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(TRANSITION_STORAGE_KEY);
    const stored = JSON.parse(raw) as StoredReadingTransition;
    if (stored.expiresAt < Date.now() || stored.reading?.id !== id) return null;
    return stored.reading;
  } catch {
    removeStoredTransition();
    return null;
  }
}

export function ReadingTransitionProvider({ children }: { children: ReactNode }) {
  const currentReading = useRef<PublicReading | null>(null);
  const draft = useRef<DreamDraft | null>(null);
  const recallDraft = useCallback(() => draft.current, []);
  const rememberDraft = useCallback((next: DreamDraft | null) => { draft.current = next; }, []);
  const recall = useCallback((id: string) => {
    if (currentReading.current?.id === id) {
      removeStoredTransition();
      return currentReading.current;
    }
    const stored = consumeStoredTransition(id);
    if (stored) currentReading.current = stored;
    return stored;
  }, []);
  const remember = useCallback((reading: PublicReading) => {
    currentReading.current = reading;
  }, []);
  const stage = useCallback((reading: PublicReading) => {
    currentReading.current = reading;
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        TRANSITION_STORAGE_KEY,
        JSON.stringify({ expiresAt: Date.now() + TRANSITION_TTL_MS, reading })
      );
      window.setTimeout(removeStoredTransition, TRANSITION_TTL_MS);
    } catch {
      // The route can still use server restore when storage is unavailable.
    }
  }, []);
  const value = useMemo(
    () => ({ recall, remember, stage, recallDraft, rememberDraft }),
    [recall, remember, stage, recallDraft, rememberDraft]
  );

  return (
    <ReadingTransitionContext.Provider value={value}>
      {children}
    </ReadingTransitionContext.Provider>
  );
}

export function useReadingTransition() {
  const value = useContext(ReadingTransitionContext);
  if (!value) throw new Error("ReadingTransitionProvider is missing");
  return value;
}
