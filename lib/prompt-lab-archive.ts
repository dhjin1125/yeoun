import "server-only";
import { mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { AppError } from "./http";
import { effectiveAiMode } from "./app-profile";

export type ArchiveKind = "snapshot" | "reading_started" | "reading_completed" | "reading_failed" | "proposal_started" | "proposal_completed" | "proposal_failed" | "goal_started" | "goal_completed" | "goal_failed";
export type ArchiveRecord = { id:string; savedAt:string; kind:ArchiveKind; data:Record<string,unknown> };
export type ArchiveItem = {id:string;savedAt:string;kind:ArchiveKind;runIds:number[];experimentId:number|null};
const archiveId = /^\d{13}-[a-f0-9-]{36}$/;

// Each event is an independent, private, immutable file. Never overwrite a previous run.
export class PromptLabArchive {
  constructor(readonly directory = join(process.cwd(), ".data", "prompt-lab")) {}
  async record(kind:ArchiveKind, data:Record<string,unknown>):Promise<ArchiveRecord> {
    const savedAt=new Date().toISOString();
    const record={id:`${Date.now()}-${randomUUID()}`,savedAt,kind,data};
    const temporary=join(this.directory,`.${record.id}.tmp`);
    try {
      await mkdir(this.directory,{recursive:true,mode:0o700});
      const file=await open(temporary,"wx",0o600);
      try {await file.writeFile(JSON.stringify(record,null,2),"utf8");await file.sync();} finally {await file.close();}
      await rename(temporary,join(this.directory,`${record.id}.json`));
      return record;
    } catch {
      await unlink(temporary).catch(()=>undefined);
      throw new AppError("LAB_ARCHIVE_FAILED","프로젝트 기록 저장에 실패했어요. 입력과 결과를 내려받아 보관한 뒤 다시 시도해 주세요.",503);
    }
  }
  async read(id:string):Promise<ArchiveRecord> {
    if(!archiveId.test(id)) throw new AppError("LAB_ARCHIVE_NOT_FOUND","기록을 찾을 수 없어요.",404);
    try {return JSON.parse(await readFile(join(this.directory,`${id}.json`),"utf8"));}
    catch {throw new AppError("LAB_ARCHIVE_NOT_FOUND","기록을 읽을 수 없어요.",404);}
  }
  async list():Promise<ArchiveItem[]> {
    let names:string[];
    try {names=await readdir(this.directory);} catch(e) {if((e as NodeJS.ErrnoException).code==="ENOENT")return [];throw e;}
    const items:ArchiveItem[]=[];
    for(const name of names.filter(name=>archiveId.test(name.replace(/\.json$/,"")) && name.endsWith(".json")).sort().reverse()) {
      const record=await this.read(name.slice(0,-5));
      const history=record.data.history as {runs?:{id:number}[]}|undefined;
      items.push({id:record.id,savedAt:record.savedAt,kind:record.kind,runIds:history?.runs?.map(run=>run.id)??[],experimentId:typeof record.data.experimentId==="number"?record.data.experimentId:null});
    }
    return items;
  }
}
export const promptLabArchive = new PromptLabArchive();
export const historyDigest=(history:unknown)=>createHash("sha256").update(JSON.stringify(history)).digest("hex");

// Snapshot the effective configuration at request start, not whatever is configured later.
export function labModelSettings(proposal=false, readingOperation: "free" | "detailed" = "free") {
  const provider=effectiveAiMode();
  const operation=proposal?"ANALYSIS":readingOperation.toUpperCase();
  const codex=provider==="codex";
  return {provider,
    model:codex?(proposal && process.env.CODEX_LOCAL_PROMPT_EDIT_MODEL?.trim() || process.env[`CODEX_LOCAL_${operation}_MODEL`]?.trim() || process.env.CODEX_LOCAL_MODEL?.trim() || "codex-cli-default"):(readingOperation === "detailed" ? process.env.OPENAI_PAID_MODEL ?? "gpt-5.4-mini" : process.env.OPENAI_FREE_MODEL??"gpt-5-mini"),
    reasoningEffort:codex?(proposal && process.env.CODEX_LOCAL_PROMPT_EDIT_REASONING_EFFORT?.trim() || process.env[`CODEX_LOCAL_${operation}_REASONING_EFFORT`]?.trim() || process.env.CODEX_LOCAL_REASONING_EFFORT?.trim() || "low"):(process.env[`OPENAI_${operation}_REASONING_EFFORT`]?.trim() || process.env.OPENAI_REASONING_EFFORT?.trim() || "low"),
    analysisReasoningEffort:codex?(process.env.CODEX_LOCAL_ANALYSIS_REASONING_EFFORT?.trim() || process.env.CODEX_LOCAL_REASONING_EFFORT?.trim() || "low"):(process.env.OPENAI_ANALYSIS_REASONING_EFFORT?.trim() || process.env.OPENAI_REASONING_EFFORT?.trim() || "low")};
}
