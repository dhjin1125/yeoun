/** Restore a literal source span using formatting differences only.
 * Word boundaries, internal punctuation, negation and actor wording are preserved.
 */
export function resolveSourceQuote(quote: string, sources: string[]): string | null {
  if (!quote.trim()) return null;
  if (sources.some(source => source.includes(quote))) return quote;
  // The active evidence view removes sentence-ending punctuation, including
  // question/exclamation marks. Restore against that same scoped source only.
  const text = quote.trim().replace(/^[“‘"']|[”’"']$/gu, "").trim().replace(/[.!?。！？]+$/u, "").trim();
  if (!text) return null;
  const expression = new RegExp(text.split(/\s+/u)
    .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "u");
  for (const source of sources) {
    const match = source.match(expression);
    if (match) return match[0];
  }
  return null;
}
