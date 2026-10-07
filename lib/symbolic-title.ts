/** Display compatibility for titles saved before source text and titles were separated. */
export function formatSymbolTitle(title: string) {
  if (/^(?:막\s*)?때리고의 상징$/.test(title)) return "때리는 장면";
  if (/^(?:막\s*)?맞고의 상징$/.test(title)) return "맞는 장면";
  if (/^피(?:가)?\s*(?:나오고|나고)의 상징$/.test(title)) return "피가 나는 장면";
  return title.replace(/장면의 상징$/, "장면");
}
