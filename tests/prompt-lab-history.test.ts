import { describe, expect, it } from "vitest";
import { LAB_HISTORY_KEY, labGoalMemory, labReadingText, mergeLabHistory, parseLabHistory, saveLabHistory, type LabRun } from "../lib/prompt-lab-history";
import { goalAgreement } from "./helpers/prompt-goal";

const legacy = {version:2,draft:{dream:"테스트 꿈",emotion:null,instructions:"지침 B"},runs:[
  {id:1,dream:"테스트 꿈",emotion:null,instructions:"지침 A",durationMs:10,promptApplied:true,safetyNotice:null,payload:{directAnswer:"테스트 풀이 A",sections:[]}},
  {id:3,dream:"테스트 꿈",emotion:null,instructions:"지침 B",durationMs:20,promptApplied:true,safetyNotice:null,payload:{directAnswer:"테스트 풀이 B",sections:[]}}
],approvals:[]};

describe("실험실 기록 보존",()=>{
  it("includes suggested follow-up questions when sharing a selected result for review",()=>{
    const run = {...legacy.runs[0],payload:{...legacy.runs[0].payload,suggestedQuestions:["이 장면이 왜 기억에 남았을까요?"]}} as unknown as LabRun;
    expect(labReadingText(run)).toContain("이 장면이 왜 기억에 남았을까요?");
  });
  it("이전 내려받기 파일을 읽고 선택한 버전과 편집 지침을 각각 보존한다",()=>{
    const migrated=parseLabHistory(JSON.stringify(legacy));
    expect(migrated.selectedId).toBe(3);
    expect(migrated.baselineId).toBe(1);
    const chosen={...migrated,workingId:1,selectedId:3,draft:{...migrated.draft,instructions:"선택 후 수정"}};
    expect(parseLabHistory(JSON.stringify(chosen))).toEqual(chosen);
    expect(chosen.runs[0].instructions).toBe("지침 A");
  });
  it("깨진 파일과 중복 ID를 거부하고 없는 선택은 복원하지 않는다",()=>{
    expect(()=>parseLabHistory("{" )).toThrow();
    expect(()=>parseLabHistory(JSON.stringify({...legacy,runs:[legacy.runs[0],legacy.runs[0]]}))).toThrow();
    expect(()=>parseLabHistory(JSON.stringify({...legacy,runs:[{...legacy.runs[0],payload:{directAnswer:"x",sections:[{}]}}]}))).toThrow();
    expect(parseLabHistory(JSON.stringify({...legacy,workingId:99})).workingId).toBeNull();
  });
  it("stores the next experiment number even when failed attempts created no result row",()=>{
    const history=parseLabHistory(JSON.stringify({...legacy,nextExperimentId:12}));
    expect(history.runs.map(run=>run.id)).toEqual([1,3]);
    expect(history.nextExperimentId).toBe(12);
    expect(mergeLabHistory(parseLabHistory(JSON.stringify({...legacy,runs:[]})),history).nextExperimentId).toBe(12);
  });
  it("가져오기는 기존 기록을 유지하고 새 번호로 연결한다",()=>{
    const original=parseLabHistory(JSON.stringify({...legacy,workingId:1}));
    const merged=mergeLabHistory(original,original);
    expect(merged.runs.map(run=>run.id)).toEqual([1,3,4,5]);
    expect(merged.workingId).toBe(4);
    expect(merged.baselineId).toBe(4);
    expect(merged.selectedId).toBe(5);
    expect(original.runs).toHaveLength(2);
  });
  it("다른 탭에서 저장한 기록과 용량 오류를 덮어쓰거나 무시하지 않는다",()=>{
    const data=new Map<string,string>();
    const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};
    const history=parseLabHistory(JSON.stringify(legacy));
    const first=saveLabHistory(storage,null,history);
    expect(data.get(LAB_HISTORY_KEY)).toBe(first);
    data.set(LAB_HISTORY_KEY,"다른 탭의 새 기록");
    expect(()=>saveLabHistory(storage,first,history)).toThrow("다른 탭");
    expect(data.get(LAB_HISTORY_KEY)).toBe("다른 탭의 새 기록");
    expect(()=>saveLabHistory({...storage,setItem:()=>{throw new Error("quota");}},"다른 탭의 새 기록",history)).toThrow("quota");
  });
  it("목표 확인 전의 과거 기록을 합의로 추정하지 않는다",()=>{
    const history=parseLabHistory(JSON.stringify(legacy));
    expect(history.goal.agreements).toEqual([]);expect(labGoalMemory(history)).toBeNull();
  });
  it("목표·거절 이유를 저장 복원하고 가져올 때도 기존 목표 이력을 잃지 않는다",()=>{
    const history=parseLabHistory(JSON.stringify(legacy));
    const pending={run:history.runs[0],base:"지침",feedback:"바꿔요",proposal:{summary:"짧게 바꿔요",edits:[{before:"지침",after:"새 지침",reason:"짧게"}],instructions:"새 지침"}};
    history.goal={...history.goal,draft:goalAgreement.draft,agreements:[goalAgreement],activeId:goalAgreement.id,editing:false};
    history.rejections=[{pending,reason:"좋았던 설명도 사라져요",rejectedAt:"2026-09-23T01:00:00.000Z"}];
    const restored=parseLabHistory(JSON.stringify(history));
    expect(restored).toEqual(history);
    expect(labGoalMemory(restored)).toMatchObject({agreement:goalAgreement,decisions:[{status:"rejected",reason:"좋았던 설명도 사라져요"}]});
    const merged=mergeLabHistory(restored,parseLabHistory(JSON.stringify(legacy)));
    expect(merged.goal.activeId).toBe(goalAgreement.id);expect(merged.rejections).toHaveLength(1);
    expect(labGoalMemory({...restored,goal:{...restored.goal,editing:true}})).toBeNull();
    const empty=parseLabHistory(JSON.stringify({...legacy,runs:[]}));
    expect(mergeLabHistory(empty,restored).runs.map(run=>run.id)).toEqual([1,3]);
  });
});
