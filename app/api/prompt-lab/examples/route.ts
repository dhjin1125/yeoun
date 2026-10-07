import { assertSameOrigin, errorResponse, noStoreJson } from "@/lib/http";
import { assertPromptLabAccess } from "@/lib/prompt-lab";
import { readPaidPromptLabExamples } from "@/lib/prompt-lab-examples";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertSameOrigin(request);
    await assertPromptLabAccess();
    return noStoreJson({ examples: await readPaidPromptLabExamples() });
  } catch (error) {
    return errorResponse(error);
  }
}
