import { z } from "zod";
import { assertPromptLabAccess } from "@/lib/prompt-lab";
import { AppError, assertSameOrigin, errorResponse, noStoreJson } from "@/lib/http";
import { parseLabHistory } from "@/lib/prompt-lab-history";
import { promptLabArchive, historyDigest } from "@/lib/prompt-lab-archive";

export const runtime="nodejs";
const inputSchema=z.object({workspaceId:z.string().uuid(),history:z.unknown()});
export async function GET(request:Request) {
  try {
    assertSameOrigin(request);await assertPromptLabAccess();
    const id=new URL(request.url).searchParams.get("id");
    return noStoreJson(id?await promptLabArchive.read(id):{items:await promptLabArchive.list()});
  }catch(e){return errorResponse(e);}
}
export async function POST(request:Request) {
  try {
    assertSameOrigin(request);await assertPromptLabAccess();
    const raw=await request.text();
    if(Buffer.byteLength(raw,"utf8")>20_000_000) throw new AppError("LAB_ARCHIVE_TOO_LARGE","기록이 너무 커요. JSON 파일로 내려받아 보관해 주세요.",413);
    let decoded:unknown;
    try{decoded=JSON.parse(raw);}catch{throw new AppError("INVALID_JSON","기록 파일의 형식을 확인해 주세요.",400);}
    const input=inputSchema.parse(decoded);
    let history;
    try{history=parseLabHistory(JSON.stringify(input.history));}catch{throw new AppError("INVALID_HISTORY","올바른 실험 기록이 아니에요. 기존 기록은 유지돼요.",400);}
    const record=await promptLabArchive.record("snapshot",{workspaceId:input.workspaceId,history,digest:historyDigest(history)});
    return noStoreJson({id:record.id,savedAt:record.savedAt});
  }catch(e){return errorResponse(e);}
}
