export function unquotedText(text: string) {
  return text.replace(/"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’/g, (quote, index: number) => {
    const body = quote.slice(1,-1);
    const tail = text.slice(index + quote.length);
    const speech = /^(?:이?라고|이?라는|라며|라면서|하고\s*(?:말|외|소리))/.test(tail)
      || /(?:나는|내가|저는|제가|[.!?]|했어|했대|싶어|왔어|라고)/.test(body);
    return speech ? " ".repeat(quote.length) : ` ${body} `;
  });
}

export function isDreamCorrection(text: string) {
  const outside = unquotedText(text).trim();
  return Boolean(splitDreamEvidence(outside).dreamText)
    && /^(?:아니[,，]?\s*(?:사실|정확히)|정정)|[가-힣](?:이|가)\s*아니라/.test(outside);
}

export function splitOutsideQuotes(text: string, pattern: RegExp, keepSeparator = false) {
  const parts: string[] = [];
  let start = 0;
  for (const match of unquotedText(text).matchAll(new RegExp(pattern.source, "g"))) {
    parts.push(text.slice(start, match.index));
    start = match.index! + (keepSeparator ? 0 : match[0].length);
  }
  parts.push(text.slice(start));
  return parts.filter(Boolean);
}

/** Keep the original elsewhere; this is only the active, non-quoted evidence view. */
export function observedDreamText(text: string) {
  const clauses = splitOutsideQuotes(text, /[.!?\n]+/);
  const active: string[] = [];
  for (const raw of clauses) {
    let clause = unquotedText(raw).trim();
    const correction = clause.match(/(?:아니[,，]?\s*(?:사실은?|정확히는)?|정정(?:할게요|하면|하자면)[,，]?)\s*(.+)/);
    const contrast = clause.match(/([가-힣]{1,20}?)(?:이|가|은|는)?\s*아니라\s*(.+)/);
    if (contrast) {
      const removed = contrast[1];
      const replacement = contrast[2].match(/^([가-힣 ]{1,30}?)(?:이었|였|이에요|예요|이야|야)(?:어요|어|요)?/)?.[1]?.trim();
      for (let i = 0; i < active.length; i += 1) {
        if (!active[i].includes(removed)) continue;
        active[i] = replacement ? active[i].replaceAll(removed, replacement) : "";
      }
      clause = contrast[2];
    } else if (correction && /^(?:아니|정정)/.test(clause)) {
      // A role/ownership correction refines a slot, not the entire preceding dream.
      if (!/^(?:내가|제가|나는|저는|피(?:는|가)|그\s*사람)/.test(correction[1])) active.pop();
      clause = correction[1];
    }
    if (clause) active.push(clause);
  }
  return active.join(". ");
}

export function emotionEvidence(text: string) {
  return unquotedText(text)
    .replace(/(?:안\s*무서(?:운|웠던)|무섭지\s*않(?:은|았던))\s*(?:건|것은|게)\s*아니[^,.!?]*/g, "무서웠어요")
    .replace(/(?:안\s*좋(?:은|았던)|좋지\s*않(?:은|았던))\s*(?:건|것은|게)\s*아니[^,.!?]*/g, "좋았어요")
    .replace(/(?:무서(?:운|웠던)|두려(?:운|웠던))\s*(?:건|것은|게)\s*아니[^,.!?]*/g, "")
    .replace(/(?:무섭지|두렵지)\s*않[^,.!?]*/g, "");
}

/** Split only explicit reality/dream markers; never infer waking events from dream content. */
export function splitDreamEvidence(text: string, initialKind: "dream" | "reality" = "dream") {
  const dream: string[] = [];
  const reality: string[] = [];
  let kind = initialKind;
  const parts = splitOutsideQuotes(text, /[.!?\n]+/).flatMap(sentence => splitOutsideQuotes(sentence,
    /꿈(?:속에서는|속에서|에서는|에서|에선|에는)|현실(?:에서는|에서|에선|은)|실제로/, true
  ));
  for (const raw of parts) {
    const part = raw.trim();
    if (!part || /^(?:최근|최근에|요즘|참고로|그리고)$/.test(part)) continue;
    // A question about the dream is not another real-world event.
    if (/(?:뜻일까요|뜻인가요|의미인가요|무슨\s*뜻|해몽해\s*줘|풀이해\s*줘|알고\s*싶어요|궁금해요)$/.test(part)) continue;
    if (/^꿈(?:속|에서|에선|에는)/.test(part) || /^(?:최근|요즘).{0,12}(?:꿈|꾼)/.test(part)) kind = "dream";
    else if (/^(?:(?:참고로|그리고)\s*)?(?:최근|요즘|현실에서는|현실에서|현실에선|현실은|실제로)/.test(part)) kind = "reality";
    (kind === "dream" ? dream : reality).push(part);
  }
  return { dreamText: dream.join(". "), realityTexts: reality };
}
