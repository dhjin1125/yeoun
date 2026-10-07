"use client";
import { useState } from "react";
import { parseLabHistory, type LabHistory } from "@/lib/prompt-lab-history";
import type { ArchiveItem, ArchiveRecord } from "@/lib/prompt-lab-archive";
import styles from "./prompt-lab.module.css";

const labels:Record<string,string>={snapshot:"작업 기록",reading_started:"풀이 시작",reading_completed:"풀이 결과",reading_failed:"풀이 실패",proposal_started:"수정 요청",proposal_completed:"수정 제안",proposal_failed:"수정 실패",goal_started:"목표 대화 시작",goal_completed:"목표 정리",goal_failed:"목표 정리 실패"};
export function PromptLabArchivePanel({disabled,onRestore}:{disabled:boolean;onRestore:(history:LabHistory)=>void}) {
  const [items,setItems]=useState<ArchiveItem[]>([]);
  const [record,setRecord]=useState<ArchiveRecord|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [loaded,setLoaded]=useState(false);
  async function read(id?:string) {
    setLoading(true);setError("");
    try {
      const response=await fetch(`/api/prompt-lab/archive${id?`?id=${encodeURIComponent(id)}`:""}`,{cache:"no-store"});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error?.message??"기록을 읽지 못했어요.");
      if(id)setRecord(data);else {setItems(data.items);setLoaded(true);}
    }catch(e){setError(e instanceof Error?e.message:"기록을 읽지 못했어요.");}
    finally{setLoading(false);}
  }
  function restore() {
    if(!record)return;
    try {
      if(record.kind==="snapshot")onRestore(parseLabHistory(JSON.stringify(record.data.history)));
      else if(record.kind==="reading_completed") {
        const input=record.data.input as {dream:string;emotion?:string|null;instructions:string;experimentId?:number};
        const result=record.data.result as object;
        onRestore(parseLabHistory(JSON.stringify({version:3,draft:{dream:input.dream,emotion:input.emotion??null,instructions:input.instructions},runs:[{...result,dream:input.dream,emotion:input.emotion??null,instructions:input.instructions,id:input.experimentId??1,archiveId:record.id}]})));
      }
    }catch{setError("이 기록을 실험 목록으로 복원하지 못했어요. 전체 기록은 아래에서 확인할 수 있어요.");}
  }
  function download() {
    if(!record)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:"application/json"}));
    const link=document.createElement("a");link.href=url;link.download=`yeoun-archive-${record.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <details className={styles.archive}>
    <summary>프로젝트에 보관된 모든 기록 보기</summary>
    <p>브라우저를 닫아도 이 컴퓨터의 프로젝트 폴더에 남아요. 결과와 지침, 수정 제안, 승인·선택 내역을 다시 볼 수 있어요.</p>
    <button type="button" disabled={loading||disabled} onClick={()=>void read()}>보관 기록 불러오기</button>
    {loading&&<p role="status">보관 기록을 읽고 있어요…</p>}
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    {loaded&&items.length===0&&<p>프로젝트에 보관된 기록이 아직 없어요.</p>}
    {items.length>0&&<label>확인할 기록<select className={styles.archiveSelect} disabled={loading||disabled} value={record?.id??""} onChange={e=>{if(e.target.value)void read(e.target.value);}}>
      <option value="">기록 선택</option>{items.map(item=><option key={item.id} value={item.id}>{new Date(item.savedAt).toLocaleString("ko-KR")} · {labels[item.kind]}{item.runIds.length?` · 실험 ${item.runIds.join(", ")}`:item.experimentId?` · 실험 ${item.experimentId}`:""}</option>)}
    </select></label>}
    {record&&<section>
      <div className={styles.actions}><button type="button" onClick={download}>이 기록 전체 내려받기</button>
      {((record.kind==="snapshot" && Boolean(record.data.history))||record.kind==="reading_completed")&&<button type="button" disabled={disabled} onClick={restore}>이 기록의 실험 불러오기</button>}</div>
      <p>불러오면 현재 실험도 유지돼요. 번호가 겹치는 경우 새 번호로 추가해요.</p>
      <details><summary>저장된 지침·결과·변경 내역 전체</summary><pre>{JSON.stringify(record.data,null,2)}</pre></details>
    </section>}
  </details>;
}
