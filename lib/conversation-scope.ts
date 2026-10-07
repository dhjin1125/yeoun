import { z } from "zod";
import { classifyUserMessage } from "./consultation";

export const conversationScopeSchema = z.object({
  decision: z.enum(["related", "mixed", "off_topic", "unclear"]),
  relevantParts: z.array(z.string().min(1).max(1200)).max(4)
});
export type ConversationScope = z.infer<typeof conversationScopeSchema>;

const scope = (decision: ConversationScope["decision"]): ConversationScope => ({ decision, relevantParts: [] });

/** Only unambiguous standalone requests are rejected here without a provider call.
 * Dream framing or contextual wording goes to the contextual classifier instead.
 */
export function obviousConversationScope(message: string): ConversationScope | null {
  const text = message.normalize("NFKC").trim();
  if (classifyUserMessage(text) === "reaction" || /^(?:잘\s*)?(?:기억(?:이)?\s*(?:안\s*나(?:요)?|나지\s*않아요)|모르겠어요)[.!\s]*$/.test(text)) return scope("related");
  if (!/[가-힣a-zA-Z0-9]/.test(text) || /^(.)\1{7,}$/u.test(text.replace(/\s/g, ""))) return scope("off_topic");
  if (/^(?:안녕(?:하세요)?|hi|hello)[!.\s]*$/i.test(text)) return scope("related");
  if (/꿈|해몽|풀이|장면|그\s*사람|그때|앞서|방금|아까|말씀|말한|해석/.test(text)) return null;
  if (/^(?:(?:내|제|오늘|이번\s*주|올해)\s*)?(?:(?:[가-힣]{2})?일주|사주|팔자|운세|타로|점심|저녁\s*메뉴|맛집|날씨|주식|비트코인|코딩|파이썬|자바스크립트|python|javascript)(?:에\s*대해(?:서)?|의|를|을|는|가|좀|\s)*.{0,30}(?:알려\s*줘|설명해(?:\s*줘)?|추천해(?:\s*줘)?|봐\s*줘|짜\s*줘|만들어\s*줘|어때|뭐야|어떤가요)[.!?\s]*$/i.test(text)) return scope("off_topic");
  return null;
}

/** Offline/review fallback. Production uses the contextual structured classifier. */
export function localConversationScope(message: string): ConversationScope {
  const obvious = obviousConversationScope(message);
  if (obvious) return obvious;
  if (/꿈|해몽|풀이|해석|장면|현실|관계|처음|마지막|그\s*사람|그때|다른\s*관점|장소|감정|기분|무서|편안|후련|불안|기억|문장|정정|잘못|맞은|맞았|때렸|한마디|한\s*마디|[가-힣]+(?:였|었|했|봤|탔)어/.test(message)) return scope("related");
  return scope("unclear");
}

export function scopedConversationMessage(message: string, result: ConversationScope) {
  if (result.decision === "related") return message;
  if (result.decision !== "mixed") return null;
  // The classifier may select literal portions, never author new user facts.
  let cursor = 0;
  const parts = result.relevantParts.map(part => part.trim());
  if (!parts.length) throw new Error("INVALID_CONVERSATION_SCOPE");
  for (const part of parts) {
    const index = message.indexOf(part, cursor);
    if (part.length < 2 || index < cursor) throw new Error("INVALID_CONVERSATION_SCOPE");
    cursor = index + part.length;
  }
  return parts.join("\n");
}
