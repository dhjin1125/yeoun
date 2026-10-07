export type PreviewMask = { start: number; end: number };

const psychologicalConcept = /(?:익숙한\s+|낯선\s+|직접적인\s+|억눌린\s+|해소되지\s*못한\s+|정리되지\s*않은\s+|현재의\s+|과거의\s+|꿈속\s+)*(?:관계\s*기억|관계의\s*(?:변화|거리|긴장)|인정받고\s*싶은\s*마음|가까워지고\s*싶은\s*마음|잃고\s*싶지\s*않은\s*마음|마음에\s*걸리게\s*한\s*이유|친밀함|친밀감|가까움|짜릿함|자극|욕구|욕망|그리움|미련|외로움|불안감|불안|두려움|긴장감|긴장|압박감|부담감|부담|안도감|안정감|안정|위로|애착|질투|죄책감|후회|상실감|통제감|통제|회피|기대감|기대|망설임|호기심|소속감|인정\s*욕구|보상\s*심리|경계심|감정|심리|마음|기억|대비)/g;
const interpretation = /읽|볼\s*수|해석|상징|뜻|의미|표현|나타|더해|불러|떠올|연결|반영|겹|대비|가능성|이유|계기|보여|만들|이어|연관|관련|드러|가까움|친밀/;

/** Phrase rules plus psychological concepts; not a semantic model. */
export function previewMasks(paragraph: string): PreviewMask[] {
  const candidates: (PreviewMask & { priority: number })[] = [];
  const sentences = [...paragraph.matchAll(/[^.!?\n]+[.!?]?/g)];
  let wholeSentenceCandidate = false;
  for (const sentence of sentences) {
    const text = sentence[0];
    // Never conceal qualifications, negation, or instructions as a teaser.
    if (/단정|뜻하지|의미하지|상징하지|아니|없|보장|결제|안내|주의|도움|위험|(?:읽|해석|볼|의미|상징).{0,8}않/.test(text)) continue;
    const sentenceStart = sentence.index!;
    const add = (start: number, end: number, priority: number) => {
      if (!candidates.some(item => start < item.end && end > item.start)) candidates.push({ start, end, priority });
    };
    const patterns = [
      // Keep temporal/connective framing and the conditional verb visible.
      /(?:^|,|(?:또는|혹은)\s+)\s*(?:최근\s+|요즘\s+)?(?<phrase>[^,]+?[을를])\s+(?:들었거나|들었다면|접했다면|접했거나|보았다면|봤다면)/g,
      // A topic introduces an interpretive noun phrase; preserve the predicate.
      /(?:은|는|라서|어서|보다)\s+(?<phrase>[^,]+?(?:으로|로))\s+(?:읽|볼\s*수|해석)/g,
      /(?:은|는)\s+(?<phrase>[^,]+?[을를])\s+(?:뜻|상징|의미)/g,
    ];
    for (const [patternIndex, pattern] of patterns.entries()) {
      for (const match of text.matchAll(pattern)) {
        const phrase = match.groups!.phrase;
        // Reject oversized/complex clauses rather than cutting them to fit.
        if (phrase.trim().split(/\s+/).length < 2 || phrase.trim().split(/\s+/).length > 14) continue;
        if (/했|했고|있었|합니다|있어요|하지만|그러나|단순히|그저/.test(phrase)) continue;
        const start = sentence.index! + match.index! + match[0].indexOf(phrase);
        const end = start + phrase.length;
        add(start, end, patternIndex === 0 ? 100 : 80);
      }
    }
    // The former predicate-only rules missed entire paragraphs about intimacy,
    // emotional memory and contrast. Cover their psychological nucleus directly.
    if (interpretation.test(text)) {
      const concepts = [...text.matchAll(psychologicalConcept)];
      for (const concept of concepts) {
        const start = sentenceStart + concept.index!;
        add(start, start + concept[0].length, 70);
      }
      // If the interpretation has no separable concept, hide one complete
      // interpretive sentence only when another sentence remains readable.
      if (!concepts.length && !candidates.some(item => item.start >= sentenceStart && item.start < sentenceStart + text.length)
        && /이유|계기|반영|드러|의미|심리/.test(text) && sentences.length > 1 && !wholeSentenceCandidate) {
        const start = sentenceStart + text.length - text.trimStart().length;
        add(start, sentenceStart + text.trimEnd().length, 60);
        wholeSentenceCandidate = true;
      }
    }
  }
  return candidates.sort((a, b) => b.priority - a.priority || a.start - b.start).slice(0, 2)
    .sort((a, b) => a.start - b.start).map(({ start, end }) => ({ start, end }));
}
