import { z } from "zod";

export const promptEditSchema = z.object({
  summary: z.string().min(1).max(600),
  edits: z.array(z.object({
    before: z.string().min(1).max(8000),
    after: z.string().min(1).max(8000),
    reason: z.string().min(1).max(600)
  })).min(1).max(6)
});
export type PromptEdit = z.infer<typeof promptEditSchema>;

// Replace only unambiguous original spans. A proposal cannot silently rewrite
// unrelated instructions, nor can one edit target another edit's new text.
export function applyPromptEdits(original: string, proposal: PromptEdit) {
  const spans = proposal.edits.map(edit => {
    const start = original.indexOf(edit.before);
    if (start < 0 || original.indexOf(edit.before, start + 1) >= 0 || edit.before === edit.after) {
      throw new Error("INVALID_PROMPT_EDIT");
    }
    return {...edit,start,end:start + edit.before.length};
  }).sort((a,b) => a.start-b.start);
  if (spans.some((span,i) => i > 0 && span.start < spans[i-1].end)) throw new Error("OVERLAPPING_PROMPT_EDITS");
  let result=original;
  for (const span of spans.reverse()) result=result.slice(0,span.start)+span.after+result.slice(span.end);
  if (result.length > 40_000) throw new Error("PROMPT_EDIT_TOO_LONG");
  return result;
}
