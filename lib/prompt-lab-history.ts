import { z } from "zod";
import { EMOTIONS, type AssistantTurnPayload, type Emotion, type SafetyNotice } from "./types";
import { promptEditSchema, type PromptEdit } from "./prompt-edit";
import { emptyGoalState, goalStateSchema, agreedGoal, type GoalMemory, type GoalState } from "./prompt-lab-goal";

export const PAID_LAB_HISTORY_KEY = "yeoun:prompt-lab:paid:v1";
export const LAB_HISTORY_KEY = "yeoun:prompt-lab:v3";
export type LabMetadata = {archiveId?:string;createdAt?:string;settings?:{provider:string;model:string;reasoningEffort:string;analysisReasoningEffort?:string};archiveWarning?:string};
export type LabResult = LabMetadata & { generationMode?: "paid"; payload: AssistantTurnPayload; durationMs: number; promptApplied: boolean; safetyNotice: SafetyNotice | null };
export type LabRun = LabResult & { id: number; dream: string; emotion: Emotion | null; instructions: string };
export type LabPending = { proposal: PromptEdit & LabMetadata & { instructions: string }; base: string; feedback: string; run: LabRun; memoryKey?:string };
export type LabRejection = {pending:LabPending;reason:string;rejectedAt:string};
export type LabPreviewVariant="title"|"teaser";
export type LabPreviewSectionCopy={sectionIndex:number;titleMode:"source"|"neutral"|"hold";teaser:string;evidence:string;verified:boolean};
export type LabPreviewSettings = {runId:number;previewMode:boolean;variant:LabPreviewVariant;hiddenSectionIndexes:number[];hideSuggestedQuestions:boolean;sectionCopy:LabPreviewSectionCopy[]};
export type LabHistory = {
  version: 3; draft: { dream: string; emotion: Emotion | null; instructions: string };
  runs: LabRun[]; approvals: LabPending[]; pending: LabPending | null; feedback: string;
  baselineId: number | null; selectedId: number | null; workingId: number | null;
  previewSettings: LabPreviewSettings[];
  goal:GoalState; rejections:LabRejection[]; rejectionDraft:string; nextExperimentId?:number;
};
export const protectedPreviewSection=(title:string,index:number)=>index===0||/안전|불확실|확실히 말할 수 없|주의|한계/u.test(title);
const draftSchema = z.object({ dream: z.string().max(2000), emotion: z.enum(EMOTIONS).nullable(), instructions: z.string().max(40000) });
const id = z.number().int().positive();
const metadataSchema=z.object({archiveId:z.string().optional(),createdAt:z.string().optional(),archiveWarning:z.string().optional(),settings:z.object({provider:z.string(),model:z.string(),reasoningEffort:z.string(),analysisReasoningEffort:z.string().optional()}).optional()});
const runSchema = draftSchema.extend({
  ...metadataSchema.shape,
  generationMode: z.literal("paid").optional(),
  id, durationMs: z.number().finite().nonnegative(), promptApplied: z.boolean(),
  payload: z.object({ directAnswer: z.string(), directAnswerTitle: z.string().optional(), readingQuestion: z.string().optional(),
    sections: z.array(z.object({title: z.string(), paragraphs: z.array(z.string())})) }).passthrough(),
  safetyNotice: z.object({message: z.string()}).passthrough().nullable()
});
const pendingSchema = z.object({ proposal: promptEditSchema.extend({...metadataSchema.shape,instructions: z.string().max(40000)}), base: z.string().max(40000), feedback: z.string().max(2000), run: runSchema, memoryKey:z.string().optional() });
const previewSettingsSchema=z.object({runId:id,previewMode:z.boolean().default(false),variant:z.enum(["title","teaser"]).default("title"),hiddenSectionIndexes:z.array(z.number().int().nonnegative()).max(10),hideSuggestedQuestions:z.boolean(),sectionCopy:z.array(z.object({sectionIndex:z.number().int().nonnegative(),titleMode:z.enum(["source","neutral","hold"]).default("source"),teaser:z.string().max(240).default(""),evidence:z.string().max(160).default(""),verified:z.boolean().default(false)})).max(10).default([])});
const historySchema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]), draft: draftSchema, runs: z.array(runSchema),
  approvals: z.array(pendingSchema).default([]), pending: pendingSchema.nullable().default(null), feedback: z.string().max(2000).default(""),
  baselineId: id.nullable().optional(), selectedId: id.nullable().optional(), workingId: id.nullable().optional(),
  previewSettings:z.array(previewSettingsSchema).default([]),
  nextExperimentId:id.int().positive().optional(),
  goal:goalStateSchema.default(emptyGoalState),
  rejections:z.array(z.object({pending:pendingSchema,reason:z.string().min(1).max(2000),rejectedAt:z.string().datetime()})).default([]),
  rejectionDraft:z.string().max(2000).default("")
});

export function parseLabHistory(raw: string): LabHistory {
  const parsed = historySchema.parse(JSON.parse(raw));
  const ids = new Set(parsed.runs.map(run => run.id));
  if (ids.size !== parsed.runs.length) throw new Error("중복된 실험 번호가 있어요.");
  const settingsIds=new Set<number>();
  for(const settings of parsed.previewSettings){if(!ids.has(settings.runId)||settingsIds.has(settings.runId))throw new Error("미리보기 설정이 결과와 일치하지 않아요.");settingsIds.add(settings.runId);}
  const previewSettings=parsed.previewSettings.map(settings=>{
    const sections=parsed.runs.find(run=>run.id===settings.runId)?.payload.sections??[];
    const validSectionCopy=settings.sectionCopy.filter(copy=>copy.sectionIndex<sections.length);
    if(new Set(validSectionCopy.map(copy=>copy.sectionIndex)).size!==validSectionCopy.length)throw new Error("중복된 미리보기 문구 설정이 있어요.");
    const sectionCopy=validSectionCopy.map(copy=>({...copy,verified:copy.verified&&Boolean(copy.teaser.trim())&&Boolean(copy.evidence.trim())}));
    const held=new Set(sectionCopy.filter(copy=>copy.titleMode==="hold").map(copy=>copy.sectionIndex));
    return {...settings,hiddenSectionIndexes:[...new Set(settings.hiddenSectionIndexes.filter(index=>index<sections.length&&!held.has(index)&&!protectedPreviewSection(sections[index]?.title??"",index)))].sort((a,b)=>a-b),hideSuggestedQuestions:false,sectionCopy};
  });
  const nextExperimentId=Math.max(parsed.nextExperimentId??1,...parsed.runs.map(run=>run.id+1));
  const valid = (value: number | null | undefined) => value != null && ids.has(value) ? value : null;
  return { ...parsed, previewSettings, version: 3, nextExperimentId,
    baselineId: valid(parsed.baselineId) ?? parsed.runs[0]?.id ?? null,
    selectedId: valid(parsed.selectedId) ?? parsed.runs.at(-1)?.id ?? null,
    workingId: valid(parsed.workingId),
    pending: parsed.pending && ids.has(parsed.pending.run.id) ? parsed.pending : null
  } as LabHistory;
}

// Import appends experiments instead of replacing any work already on this browser.
export function mergeLabHistory(current: LabHistory, imported: LabHistory): LabHistory {
  let sequence = Math.max(0, ...current.runs.map(run => run.id));
  const currentNext=Math.max(current.nextExperimentId??1,sequence+1);
  const importedLast=Math.max(0,...imported.runs.map(run=>run.id));
  const importedNext=Math.max(imported.nextExperimentId??1,importedLast+1);
  const ids = new Map(imported.runs.map(run => [run.id, current.runs.length ? ++sequence : run.id]));
  const remap = (run: LabRun): LabRun => ({...run, id: ids.get(run.id) ?? run.id});
  const remapPending = (item: LabPending): LabPending => ({...item, run: remap(item.run),memoryKey:undefined});
  const remapReference = <T extends {reference:{runId:number;result:string;instructions:string}}>(item:T):T => ({...item,reference:{...item.reference,runId:ids.get(item.reference.runId)??item.reference.runId}});
  const agreements=[...current.goal.agreements,...imported.goal.agreements.filter(item=>!current.goal.agreements.some(existing=>existing.id===item.id)).map(remapReference)];
  const goal=imported.goal.activeId || imported.goal.review || imported.goal.draft.wish ? {
    ...imported.goal,agreements,review:imported.goal.review?remapReference(imported.goal.review):null
  } : {...current.goal,agreements};
  return {...imported, runs: [...current.runs, ...imported.runs.map(remap)],
    previewSettings:[...current.previewSettings,...imported.previewSettings.map(item=>({...item,runId:ids.get(item.runId)??item.runId}))],
    approvals: [...current.approvals, ...imported.approvals.map(remapPending)],
    rejections:[...current.rejections,...imported.rejections.map(item=>({...item,pending:remapPending(item.pending)}))],goal,
    pending: imported.pending ? remapPending(imported.pending) : null,
    baselineId: ids.get(imported.baselineId ?? -1) ?? current.baselineId,
    selectedId: ids.get(imported.selectedId ?? -1) ?? current.selectedId,
    workingId: ids.get(imported.workingId ?? -1) ?? null,
    nextExperimentId:Math.max(currentNext,importedNext+(current.runs.length?Math.max(0,...current.runs.map(run=>run.id)):0),sequence+1) };
}

export function labDecisions(history:Pick<LabHistory,"approvals"|"rejections">):GoalMemory["decisions"] {
  return [
    ...history.approvals.map(item=>({status:"approved" as const,sourceRunId:item.run.id,feedback:item.feedback,summary:item.proposal.summary,reason:"지침 수정 승인. 재생성 결과까지 선호한다는 뜻은 아님."})),
    ...history.rejections.map(item=>({status:"rejected" as const,sourceRunId:item.pending.run.id,feedback:item.pending.feedback,summary:item.pending.proposal.summary,reason:item.reason}))
  ];
}
export function labGoalMemory(history:Pick<LabHistory,"goal"|"approvals"|"rejections">):GoalMemory|null {
  const agreement=agreedGoal(history.goal);
  return agreement?{agreement,decisions:labDecisions(history)}:null;
}
export const labReadingText=(run:LabRun)=>[run.payload.directAnswerTitle,run.payload.directAnswer,
  ...run.payload.sections.flatMap(section=>[section.title,...section.paragraphs]),
  ...(run.payload.uncertainty ?? []),...(run.payload.suggestedQuestions ?? []),run.payload.readingQuestion,run.safetyNotice?.message].filter(Boolean).join("\n\n");

export function saveLabHistory(storage: Pick<Storage, "getItem" | "setItem">, previous: string | null, history: LabHistory, storageKey = LAB_HISTORY_KEY): string {
  if (storage.getItem(storageKey) !== previous) throw new Error("다른 탭에서 실험 기록이 바뀌어 자동 저장을 멈췄어요. 이 탭의 기록을 내려받은 뒤 새로고침하고 불러와 주세요.");
  const raw = JSON.stringify(history);
  storage.setItem(storageKey, raw);
  return raw;
}
