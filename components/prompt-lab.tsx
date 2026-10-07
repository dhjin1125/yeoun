"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ProgressRequestError, requestProgressJson } from "@/lib/progress-client";
import type { Emotion } from "@/lib/types";
import { EMOTIONS } from "@/lib/types";
import type { PromptEdit } from "@/lib/prompt-edit";
import { PAID_LAB_HISTORY_KEY as LAB_HISTORY_KEY, parseLabHistory, mergeLabHistory, saveLabHistory, labGoalMemory,labDecisions,labReadingText,protectedPreviewSection, type LabRejection, type LabHistory, type LabResult as Result, type LabRun as Run, type LabPending as PendingProposal, type LabMetadata, type LabPreviewSettings, type LabPreviewSectionCopy } from "@/lib/prompt-lab-history";
import { emptyGoalState, goalMemoryKey,goalReviewCurrent,type GoalState,type GoalBrief } from "@/lib/prompt-lab-goal";
import { PromptLabGoal } from "./prompt-lab-goal";
import { PromptLabArchivePanel } from "./prompt-lab-archive";
import { promptLabProposalFailureHelp } from "@/lib/prompt-lab-error";
import styles from "./prompt-lab.module.css";

type Proposal = PromptEdit & LabMetadata & {instructions:string};
type ProposalFailure = { code: string; attempts: number };
type PromptLabExample = { id: string; label: string; dream: string; emotion: Emotion | null; source: "favorite" | "synthetic" };

function Reading({ run, label, chosen, disabled, previewSettings, onPreviewSettings, onChoose }: {run: Run; label: string; chosen: boolean; disabled: boolean; previewSettings:LabPreviewSettings; onPreviewSettings:(value:LabPreviewSettings)=>void; onChoose: () => void}) {
  const setSectionHidden=(index:number,hidden:boolean)=>{setRevealedSectionIndexes(current=>current.filter(item=>item!==index));onPreviewSettings({...previewSettings,hiddenSectionIndexes:hidden?[...new Set([...previewSettings.hiddenSectionIndexes,index])]:previewSettings.hiddenSectionIndexes.filter(item=>item!==index)});};
  const [revealedSectionIndexes,setRevealedSectionIndexes]=useState<number[]>([]);
  const setPreview=(enabled:boolean)=>{setRevealedSectionIndexes([]);onPreviewSettings({...previewSettings,previewMode:enabled});};
  const setVariant=(variant:LabPreviewSettings["variant"])=>{setRevealedSectionIndexes([]);onPreviewSettings({...previewSettings,variant});};
  const sectionCopy=(index:number):LabPreviewSectionCopy=>previewSettings.sectionCopy.find(item=>item.sectionIndex===index)??{sectionIndex:index,titleMode:"source",teaser:"",evidence:"",verified:false};
  const setSectionCopy=(index:number,patch:Partial<LabPreviewSectionCopy>)=>onPreviewSettings({...previewSettings,sectionCopy:[...previewSettings.sectionCopy.filter(item=>item.sectionIndex!==index),{...sectionCopy(index),...patch}]});
  const setTitleMode=(index:number,titleMode:LabPreviewSectionCopy["titleMode"])=>{setRevealedSectionIndexes(current=>current.filter(item=>item!==index));onPreviewSettings({...previewSettings,sectionCopy:[...previewSettings.sectionCopy.filter(item=>item.sectionIndex!==index),{...sectionCopy(index),titleMode}],hiddenSectionIndexes:titleMode==="hold"?previewSettings.hiddenSectionIndexes.filter(item=>item!==index):previewSettings.hiddenSectionIndexes});};
  const revealSection=(index:number,reveal:boolean)=>setRevealedSectionIndexes(current=>reveal?[...new Set([...current,index])]:current.filter(item=>item!==index));
  const hiddenSection=(index:number)=>previewSettings.previewMode&&previewSettings.hiddenSectionIndexes.includes(index)&&!revealedSectionIndexes.includes(index)&&sectionCopy(index).titleMode!=="hold"&&!protectedPreviewSection(run.payload.sections[index]?.title??"",index);
  return <article className={styles.reading}>
    <p className={styles.eyebrow}>{label} · 실험 {run.id} · {(run.durationMs / 1000).toFixed(1)}초</p>
    <button type="button" disabled={disabled || chosen} onClick={onChoose}>{chosen ? "이어갈 버전으로 선택됨" : `실험 ${run.id} · 이 버전으로 계속하기`}</button>
    {run.settings && <small>{run.settings.model} · {run.settings.reasoningEffort} · {run.createdAt ? new Date(run.createdAt).toLocaleString("ko-KR") : ""}</small>}
    {run.archiveWarning && <p role="alert" className={styles.error}>{run.archiveWarning}</p>}
    {!run.promptApplied && <p role="status">실제 AI가 실험 지침으로 생성한 결과인지 확인이 필요해요.</p>}
    <h3>{run.payload.directAnswerTitle}</h3><p>{run.payload.directAnswer}</p>
    {run.safetyNotice && <p>{run.safetyNotice.message}</p>}
    {run.payload.uncertainty?.length ? <section className={styles.readingUncertainty} aria-label="해석의 불확실성"><h3>꿈만으로 확실히 알 수 없는 부분</h3><ul>{run.payload.uncertainty.map((item,index)=><li key={index}>{item}</li>)}</ul></section>:null}
    <section className={styles.previewControls} aria-label="해몽 미리보기 설정">
      <div className={styles.previewHeading}>
        <div><strong>첫 화면 블러 실험</strong><p>제목·전체 답·첫 장면 근거·안전 안내·불확실성은 항상 보여요. 안전 안내나 답의 조건을 담은 섹션은 가리지 마세요.</p></div>
        <button type="button" aria-pressed={previewSettings.previewMode} onClick={()=>setPreview(!previewSettings.previewMode)}>{previewSettings.previewMode?"전체 해몽 보기":previewSettings.hiddenSectionIndexes.length?"미리보기로 돌아가기":"블러 미리보기"}</button>
      </div>
      <fieldset>
        <legend>첫 노출 문구 비교 <small>같은 블러 설정에서 안내 티저만 비교해요.</small></legend>
        <label className={styles.previewChoice}><input type="radio" name={`preview-variant-${run.id}`} checked={previewSettings.variant==="title"} onChange={()=>setVariant("title")} /><span>A · 제목형<small>별도 티저 없이 제목만 보여요.</small></span></label>
        <label className={styles.previewChoice}><input type="radio" name={`preview-variant-${run.id}`} checked={previewSettings.variant==="teaser"} onChange={()=>setVariant("teaser")} /><span>B · 안내형<small>티저는 원문을 바꾸지 않는 별도 UI 문구예요.</small></span></label>
      </fieldset>
      <fieldset>
        <legend>안전·필수 조건이 없고, 독립적으로 가려도 답이 달라지지 않는다고 확인한 섹션만 선택 <small>애매하면 공개해요. 제목이 부정확하거나 단정적이어도 공개를 유지해요.</small></legend>
        {run.payload.sections.map((section,index)=>{
          const locked=protectedPreviewSection(section.title,index);
          const copy=sectionCopy(index);
          return <div key={index} className={styles.previewSectionChoice}>
            <label className={styles.previewChoice}>
              <input type="checkbox" checked={previewSettings.hiddenSectionIndexes.includes(index)} disabled={locked||copy.titleMode==="hold"} onChange={event=>setSectionHidden(index,event.target.checked)} />
              <span>{section.title}{locked?<small> · 항상 공개</small>:<small> · 안전·필수 조건이 없음을 확인한 경우만</small>}</span>
            </label>
            <select aria-label={`${section.title} 미리보기 제목 처리`} value={copy.titleMode} onChange={event=>setTitleMode(index,event.target.value as LabPreviewSectionCopy["titleMode"])} disabled={locked}>
              <option value="source">원문 제목 표시</option><option value="neutral">중립 제목 사용</option><option value="hold">블러 보류 · 전체 공개</option>
            </select>
            {copy.titleMode==="neutral"&&<small>‘추가 설명’은 넓지만 틀리지는 않은 제목에만 사용해요. 본문과 어긋나면 블러를 보류하세요.</small>}
            {previewSettings.hiddenSectionIndexes.includes(index)&&copy.titleMode!=="hold"&&!locked&&<div className={styles.teaserEditor}>
              <label>검토용 문구 틀<select defaultValue="" aria-label={`${section.title} 티저 문구 틀`} onChange={event=>{if(event.target.value)setSectionCopy(index,{teaser:event.target.value,verified:false});event.currentTarget.value="";}}><option value="">문구 틀 선택…</option><option value="‘{꿈속 행동}’을 바라보는 추가 관점을 이어서 살펴봅니다.">추가 관점 · 실제 행동 확인 필요</option><option value="최근 비슷한 상황이 있었다면 꿈과 대조해 볼 수 있는 생활 속 예시가 이어집니다.">조건부 예시 · 조건부 본문 확인 필요</option><option value="공개된 기준에 더해, 비교할 추가 항목이 이어집니다.">추가 비교 · 핵심 기준 공개 필요</option></select></label>
              <label>안내형 티저<textarea maxLength={240} value={copy.teaser} onChange={event=>setSectionCopy(index,{teaser:event.target.value,verified:false})} placeholder="기본 안내: 가린 본문을 원문 그대로 확인할 수 있습니다." /></label>
              <label>이 티저가 약속하는 원문 위치<input maxLength={160} value={copy.evidence} onChange={event=>setSectionCopy(index,{evidence:event.target.value,verified:false})} placeholder="예: 이 섹션 2문단" /></label>
              <label className={styles.previewChoice}><input type="checkbox" checked={copy.verified} disabled={!copy.teaser.trim()||!copy.evidence.trim()} onChange={event=>setSectionCopy(index,{verified:event.target.checked})} /><span>원문 위치를 확인했고, 이 티저가 실제 내용만 약속함</span></label>
            </div>}
          </div>;
        })}
      </fieldset>
      <small>미리보기는 표현만 바꿔요. A/B는 같은 결과·블러 대상·제목 처리·버튼을 공유하고 티저 유무만 달라요. 후속 질문은 답 뒤에 항상 공개해요. 저장된 해몽과 피드백에 전달되는 원문은 그대로예요. 섹션 어디에 있든 안전 안내나 공개한 답의 조건·불확실성을 담고 있으면 선택하지 마세요.</small>
    </section>
    {run.payload.sections.map((section, i) => {
      const hidden=hiddenSection(i);
      const expanded=previewSettings.previewMode&&previewSettings.hiddenSectionIndexes.includes(i)&&revealedSectionIndexes.includes(i);
      const copy=sectionCopy(i);
      const teaserText=copy.verified&&copy.teaser.trim()&&copy.evidence.trim()?copy.teaser.trim():"가린 본문을 원문 그대로 확인할 수 있습니다.";
      const previewHeading=copy.titleMode==="neutral"?"추가 설명":section.title;
      const sectionContentId=`preview-run-${run.id}-section-${i}`;
      const previewManaged=previewSettings.previewMode&&previewSettings.hiddenSectionIndexes.includes(i)&&copy.titleMode!=="hold"&&!protectedPreviewSection(section.title,i);
      return <section key={i} className={hidden?styles.blurredSection:undefined}>
        <div>
          {hidden?<><h3>{previewHeading}</h3><div className={styles.teaserSlot} aria-hidden={previewSettings.variant==="title"}><span className={previewSettings.variant==="title"?styles.teaserTitleOnly:undefined}>{teaserText}</span></div><div id={sectionContentId} className={styles.blurredContent} aria-hidden="true">{copy.titleMode==="neutral"&&<h4>{section.title}</h4>}{section.paragraphs.map((p,j)=><p key={j}>{p}</p>)}</div></>:expanded?<div id={sectionContentId}><h3>{section.title}</h3>{section.paragraphs.map((p,j)=><p key={j}>{p}</p>)}</div>:<><h3>{section.title}</h3>{section.paragraphs.map((p,j)=><p key={j}>{p}</p>)}</>}
        </div>
        {previewManaged&&<button key="section-visibility" type="button" aria-expanded={!hidden} aria-controls={sectionContentId} aria-label={hidden?`${previewHeading} 전체 펼치기`:`${section.title} 다시 가리기`} className={styles.revealBlur} onClick={()=>revealSection(i,hidden)}>{hidden?"이 섹션 펼치기":"이 섹션 다시 가리기"}</button>}
      </section>;
    })}
    {run.payload.suggestedQuestions?.length ? <section><h3>이어 물어볼 질문</h3><ul>{run.payload.suggestedQuestions.map((question,index)=><li key={index}>{question}</li>)}</ul></section> : null}
    <details className={styles.contentReview}><summary>해몽 글 내용 점검 기준</summary>
      <strong>필수 수정 기준</strong>
      <ul><li>사용자가 말하지 않은 사건·감정·관계를 사실처럼 쓰지 않기</li><li>핵심 해석을 꿈속의 구체적인 장면이나 행동과 연결하기. 근거가 충분하지 않으면 프리뷰에서 문장을 새로 붙이지 말고 본문 보완으로 표시하기</li><li>질병·미래·타인의 속마음을 단정하지 않기</li><li>핵심 답을 질문이나 블러 영역으로 미루지 않기</li></ul>
      <strong>선택적 다듬기</strong>
      <ul><li>반복 문장 줄이기, 긴 문장 나누기</li><li>제목을 구체화하고 문단 전환 다듬기</li><li>이미 답한 후속 질문이나 비슷한 질문 줄이기</li></ul>
      <small>사실을 새로 보태거나 해석을 더 단정적으로 바꾸는 것은 단순 문장 다듬기가 아니에요.</small>
    </details>
    <details className={styles.contentReview}><summary>체감 가치를 높이는 내용과 안내 문구</summary>
      <strong>우선 보완할 내용</strong>
      <ol><li>꿈 장면의 순서·선택·반응이 해석으로 이어지는 이유를 설명해요. 입력에 없는 사건 순서를 만들지 않아요.</li><li>가능한 해석을 구별할 단서를 보여줘요. 근거가 모자라면 어느 쪽이 맞다고 정하지 않아요.</li><li>서로 다른 행동이나 명시된 감정이 있을 때 마음의 복합성을 풀어요. 숨겨진 본심을 알아냈다고 하지 않아요.</li><li>현실 사례는 꿈의 구조와 닮은 조건부 예시로만 제시해요. 실제 최근 사건처럼 말하지 않아요.</li><li>후속 질문은 공개된 답 뒤에 두고, 무엇을 더 구별할지 구체적으로 물어요.</li></ol>
      <strong>안내형 티저 템플릿</strong>
      <ul><li>기본 안내: “가린 본문을 원문 그대로 확인할 수 있습니다.”</li><li>추가 관점: “‘{"{꿈속 행동}"}’을 바라보는 추가 관점을 이어서 살펴봅니다.” · 원문에 반복이 아닌 추가 관점이 있을 때만</li><li>조건부 예시: “최근 비슷한 상황이 있었다면 꿈과 대조해 볼 수 있는 생활 속 예시가 이어집니다.” · 실제 예시가 조건부로 있을 때만</li><li>추가 비교: “공개된 기준에 더해, 비교할 추가 항목이 이어집니다.” · 핵심 비교와 한계를 공개했고 별도 비교 항목이 남았을 때만</li></ul>
      <strong>피할 후킹</strong><p>“진짜 의미 확인하기”, “당신도 모르는 속마음 보기”, “더 정확한 답 보기”처럼 공개 답이 불완전하거나 숨겨진 확실한 진실이 있는 듯한 표현은 쓰지 않아요. 안전 안내·조건·불확실성은 해당 주장과 함께 공개합니다.</p>
      <small>티저를 입력했다면 원문 위치를 적고, 그 내용이 실제로 있는지 확인한 뒤 표시하세요. 티저와 블러는 표시용일 뿐 해몽 원문을 수정하지 않아요.</small>
    </details>
    {run.payload.readingQuestion && <p className={styles.question}>{run.payload.readingQuestion}</p>}
    <details><summary>이 결과의 꿈·프롬프트 보기</summary><p>{run.dream}</p><small>감정: {run.emotion ?? "선택하지 않음"}</small><pre>{run.instructions}</pre></details>
  </article>;
}

export function PromptLab({ initialInstructions, model, initialNextExperimentId }: { initialInstructions: string; model: string; initialNextExperimentId: number }) {
  const [dream, setDream] = useState("");
  const [emotion, setEmotion] = useState<Emotion | null>(null);
  const [instructions, setInstructions] = useState(initialInstructions);
  const defaults = initialInstructions;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [runs, setRuns] = useState<Run[]>([]);
  const [nextExperimentId, setNextExperimentId] = useState(initialNextExperimentId);
  const [baselineId, setBaselineId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [previewSettings,setPreviewSettings]=useState<LabPreviewSettings[]>([]);
  const [feedback, setFeedback] = useState("");
  const [proposalFailure, setProposalFailure] = useState<ProposalFailure | null>(null);
  const [pending, setPending] = useState<PendingProposal | null>(null);
  const [approvals, setApprovals] = useState<PendingProposal[]>([]);
  const [goal,setGoal]=useState<GoalState>(emptyGoalState);
  const [rejections,setRejections]=useState<LabRejection[]>([]);
  const [rejectionReason,setRejectionReason]=useState("");
  const [proposing, setProposing] = useState(false);
  const running = useRef(false);
  const feedbackField = useRef<HTMLTextAreaElement>(null);
  const dreamField = useRef<HTMLTextAreaElement>(null);
  const sequence = useRef(0);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const lastSaved = useRef<string | null>(null);
  const storageBlocked = useRef(false);
  const [workspaceId,setWorkspaceId]=useState("");
  const [archiveStatus,setArchiveStatus]=useState("프로젝트 기록 저장 준비 중");
  const [archiveError,setArchiveError]=useState("");
  const [examples,setExamples]=useState<PromptLabExample[]>([]);
  const [examplesError,setExamplesError]=useState("");
  const archiveSequence=useRef(0);
  const archiveQueue=useRef<Promise<unknown>>(Promise.resolve());
  const backup=useCallback(async(saved:LabHistory)=>{
    if(!workspaceId)throw new Error("기록 저장을 준비하고 있어요.");
    const revision=++archiveSequence.current;
    setArchiveStatus("프로젝트에 기록 저장 중…");
    const task=archiveQueue.current.catch(()=>undefined).then(async()=>{
      const response=await fetch("/api/prompt-lab/archive",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspaceId,history:saved})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error?.message??"프로젝트 기록을 저장하지 못했어요.");
      if(revision===archiveSequence.current){setArchiveStatus(`프로젝트 저장 완료 · ${new Date(result.savedAt).toLocaleTimeString("ko-KR")}`);setArchiveError("");}
      return result;
    });
    archiveQueue.current=task;
    try{return await task;}catch(e){if(revision===archiveSequence.current){setArchiveStatus("프로젝트 저장 실패");setArchiveError(e instanceof Error?e.message:"기록 저장 실패");}throw e;}
  },[workspaceId]);
  const history: LabHistory = {version:3,draft:{dream,emotion,instructions},runs,approvals,pending,feedback,baselineId,selectedId,workingId,previewSettings,goal,rejections,rejectionDraft:rejectionReason,nextExperimentId};

  function restore(saved: LabHistory) {
    setDream(saved.draft.dream); setEmotion(saved.draft.emotion); setInstructions(saved.draft.instructions);
    setRuns(saved.runs); setApprovals(saved.approvals); setPending(saved.pending); setFeedback(saved.feedback);
    setGoal(saved.goal);setRejections(saved.rejections);setRejectionReason(saved.rejectionDraft);
    setBaselineId(saved.baselineId); setSelectedId(saved.selectedId); setWorkingId(saved.workingId);
    setPreviewSettings(saved.previewSettings);
    const nextId=Math.max(initialNextExperimentId,saved.nextExperimentId??1,...saved.runs.map(run=>run.id+1));
    sequence.current=nextId-1;setNextExperimentId(nextId);
  }
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAB_HISTORY_KEY);
      if (raw) restore(parseLabHistory(raw));
      lastSaved.current = raw;
      const existingWorkspace=localStorage.getItem("yeoun:prompt-lab:paid:workspace");
      const identity=existingWorkspace && /^[a-f0-9-]{36}$/.test(existingWorkspace)?existingWorkspace:crypto.randomUUID();
      localStorage.setItem("yeoun:prompt-lab:paid:workspace",identity);setWorkspaceId(identity);
      void fetch("/api/prompt-lab/examples", { cache: "no-store" }).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? "예시 꿈을 불러오지 못했어요.");
        setExamples(body.examples as PromptLabExample[]);
      }).catch(error => setExamplesError(error instanceof Error ? error.message : "예시 꿈을 불러오지 못했어요."));
    } catch {
      storageBlocked.current = true;
      setWorkspaceId(crypto.randomUUID());
      setStorageError("저장된 기록을 읽지 못해 자동 저장을 멈췄어요. 기존 저장 내용은 유지돼요. 작업한 기록은 내려받아 보관해 주세요.");
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready || storageBlocked.current) return;
    try {
      lastSaved.current = saveLabHistory(localStorage, lastSaved.current, {version:3,draft:{dream,emotion,instructions},runs,approvals,pending,feedback,baselineId,selectedId,workingId,previewSettings,goal,rejections,rejectionDraft:rejectionReason,nextExperimentId}, LAB_HISTORY_KEY);
    } catch (e) {
      storageBlocked.current = true;
      setStorageError(e instanceof Error && e.message.startsWith("다른 탭") ? e.message : "브라우저에 자동 저장하지 못했어요. 이 탭의 기록을 내려받아 보관해 주세요.");
    }
  }, [ready,dream,emotion,instructions,runs,approvals,pending,feedback,baselineId,selectedId,workingId,previewSettings,goal,rejections,rejectionReason,nextExperimentId]);

  useEffect(()=>{
    if(!ready||!workspaceId)return;
    const snapshot:LabHistory={version:3,draft:{dream,emotion,instructions},runs,approvals,pending,feedback,baselineId,selectedId,workingId,previewSettings,goal,rejections,rejectionDraft:rejectionReason,nextExperimentId};
    const timer=setTimeout(()=>{void backup(snapshot).catch(()=>undefined);},700);
    return ()=>clearTimeout(timer);
  },[ready,workspaceId,backup,dream,emotion,instructions,runs,approvals,pending,feedback,baselineId,selectedId,workingId,previewSettings,goal,rejections,rejectionReason,nextExperimentId]);

  async function choose(run: Run) {
    if(running.current)return;
    running.current=true;setBusy(true);
    try {
      await backup({...history,draft:{dream:run.dream,emotion:run.emotion,instructions:run.instructions},workingId:run.id,baselineId:run.id,selectedId:run.id,pending:null,feedback:""});
    setDream(run.dream); setEmotion(run.emotion); setInstructions(run.instructions);
    setWorkingId(run.id); setBaselineId(run.id); setSelectedId(run.id); setPending(null); setFeedback("");

    setStatus(`실험 ${run.id}의 지침을 선택했어요. 이 버전에서 수정안을 요청하거나 다시 테스트할 수 있어요.`);
    }catch(e){setError(e instanceof Error?e.message:"선택을 저장하지 못했어요.");}
    finally{running.current=false;setBusy(false);}
  }
  function importText(raw: string) {
    const imported = parseLabHistory(raw);
    restore(mergeLabHistory(history, imported));
    setError("");
    setStatus(`${imported.runs.length}개의 실험을 불러왔어요. 기존 실험도 함께 유지돼요.`);
  }
  function importPasted(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    try {importText(String(new FormData(form).get("history") ?? "")); form.reset();}
    catch {setError("기록 형식을 읽지 못했어요. 내려받은 JSON 파일의 전체 내용을 붙여넣어 주세요.");}
  }
  async function importHistory(file: File) {
    try {
      if (file.size > 20_000_000) throw new Error("파일이 너무 커요. 20MB 이하의 실험 기록을 선택해 주세요.");
      importText(await file.text());
    } catch (e) {
      const unreadable = e instanceof DOMException;
      setError(unreadable ? "선택한 파일을 읽을 수 없어요. 파일을 이 컴퓨터에 저장한 뒤 다시 선택해 주세요." : "실험 기록을 불러오지 못했어요. 내려받은 JSON 파일인지 확인해 주세요.");
      console.warn("prompt-lab import failed", e instanceof Error ? e.name : "UnknownError");
    }
  }

  useEffect(() => {
    if (!busy) return;
    const started = Date.now(); setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    const warn = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = "";};
    window.addEventListener("beforeunload", warn);
    return () => {clearInterval(timer); window.removeEventListener("beforeunload", warn);};
  }, [busy]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await execute({dream,emotion,instructions});
  }
  async function execute(snapshot: {dream:string;emotion:Emotion|null;instructions:string},savedHistory=history) {
    if (running.current) return;
    const experimentId=Math.max(nextExperimentId,sequence.current+1);
    sequence.current=experimentId;
    setNextExperimentId(experimentId+1);
    const attemptHistory={...savedHistory,nextExperimentId:experimentId+1};
    running.current = true; setBusy(true); setError("");  setProposalFailure(null); setStatus("실험을 시작하고 있어요");
    try {
      await backup(attemptHistory);
      const result = await requestProgressJson<Result>("/api/prompt-lab", {method:"POST",body:JSON.stringify({...snapshot,workspaceId,experimentId})}, progress => setStatus(progress.label));
      const run = {...result,...snapshot,id:experimentId};
      setRuns(previous => [...previous,run]); setSelectedId(run.id);
      setBaselineId(previous => previous ?? run.id);
      setStatus("결과를 비교해 보세요");
    } catch (e) {
      setError(e instanceof Error ? e.message : "상세 해몽 실험을 완료하지 못했어요.");
      setStatus("");
    }
    finally {running.current = false; setBusy(false);}
  }
  function download() {
    const blob = new Blob([JSON.stringify(history,null,2)],{type:"application/json"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href=url; link.download="yeoun-prompt-experiments.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  const selected = runs.find(run => run.id === selectedId);
  const working = runs.find(run => run.id === workingId);
  const workingUnchanged = Boolean(working && working.instructions === instructions);
  const baseline = runs.find(run => run.id === baselineId);
  const memory=labGoalMemory(history);
  const reference=selected?{runId:selected.id,result:labReadingText(selected),instructions:selected.instructions}:null;
  const reviewCurrent=Boolean(reference&&goalReviewCurrent(goal,reference));
  const proposalCurrent = pending && memory && pending.memoryKey===goalMemoryKey(memory) && pending.base === instructions && pending.run.id === selectedId && pending.feedback === feedback.trim();
  async function discussGoal(event:FormEvent) {
    event.preventDefault();
    if(!reference||running.current)return;
    const answers=goal.review?.brief.question?[...goal.answers,{question:goal.review.brief.question,answer:goal.answer.trim()}]:goal.answers;
    if(answers.some(item=>!item.answer))return;
    const next={...goal,answers,answer:"",review:null,editing:true};
    running.current=true;setBusy(true);setProposing(true);setError("");setStatus("먼저 원하는 방향을 확인하고 있어요");
    try {
      await backup({...history,goal:next});setGoal(next);
      const result=await requestProgressJson<LabMetadata&{brief:GoalBrief}>("/api/prompt-lab/goal",{method:"POST",body:JSON.stringify({
        workspaceId,draft:next.draft,answers,reference,previousAgreement:goal.agreements.find(item=>item.id===goal.activeId)??null,decisions:labDecisions(history)
      })},progress=>setStatus(progress.label));
      setGoal({...next,review:{draft:next.draft,answers,reference,brief:result.brief}});
      if(result.archiveWarning)setArchiveError(result.archiveWarning);
      setStatus(result.brief.question?"추측하지 않고 한 가지 더 여쭤볼게요.":"AI가 이해한 방향이 맞는지 확인해 주세요.");
    }catch(e){setError(e instanceof Error?e.message:"목표를 정리하지 못했어요.");}
    finally{running.current=false;setBusy(false);setProposing(false);}
  }
  async function confirmGoal() {
    if(!goal.review||!reviewCurrent||goal.review.brief.question||running.current)return;
    const agreement={...goal.review,id:crypto.randomUUID(),confirmedAt:new Date().toISOString()};
    const next={...goal,agreements:[...goal.agreements,agreement],activeId:agreement.id,editing:false};
    running.current=true;setBusy(true);setError("");
    try {await backup({...history,goal:next,pending:null});setGoal(next);setPending(null);setStatus("이 목표와 유지할 장점, 거절 이유를 다음 수정에도 함께 전달할게요.");}
    catch(e){setError(e instanceof Error?e.message:"목표 확인을 저장하지 못했어요.");}
    finally{running.current=false;setBusy(false);}
  }
  async function rejectProposal() {
    if(!pending||running.current)return;
    const entry={pending,reason:rejectionReason.trim()||"이유를 남기지 않고 버림. 거절 이유를 추측하지 않는다.",rejectedAt:new Date().toISOString()};
    running.current=true;setBusy(true);setError("");
    try {await backup({...history,pending:null,rejections:[...rejections,entry],rejectionDraft:""});setRejections(previous=>[...previous,entry]);setPending(null);setRejectionReason("");setStatus("수정안과 거절 이유를 보존했어요. 다음 수정에도 함께 참고해요.");}
    catch(e){setError(e instanceof Error?e.message:"거절 기록을 저장하지 못했어요.");}
    finally{running.current=false;setBusy(false);}
  }
  async function propose(event: FormEvent) {
    event.preventDefault();
    if (!selected || !memory || running.current || feedback.trim().length < 2) return;
    const source={base:instructions,feedback:feedback.trim(),run:selected,memoryKey:goalMemoryKey(memory)};
    running.current=true;setBusy(true);setProposing(true);setError("");setProposalFailure(null);setPending(null);
    setStatus("결과와 피드백을 살펴보고 있어요");
    try {
      await backup(history);
      const result=labReadingText(selected);
      const proposal=await requestProgressJson<Proposal>("/api/prompt-lab/propose",{method:"POST",body:JSON.stringify({
        workspaceId,sourceRunId:selected.id,instructions:source.base,feedback:source.feedback,dream:selected.dream,result,resultInstructions:selected.instructions,memory
      })},progress=>setStatus(progress.label));
      setPending({...source,proposal});if(proposal.archiveWarning)setArchiveError(proposal.archiveWarning);setStatus("수정안을 확인한 뒤 승인해 주세요");
    } catch(e) {
      if (e instanceof ProgressRequestError && e.code === "PROMPT_PROPOSAL_FAILED") {
        const code=e.message.match(/\(([A-Z][A-Z0-9_]{2,})\)/)?.[1] ?? "UNKNOWN_PROPOSAL_ERROR";
        const attempts=Number(e.message.match(/(\d+)회 시도/)?.[1] ?? 1);
        setProposalFailure({code,attempts});setError("");
      } else {
        setProposalFailure(null);setError(e instanceof Error ? e.message : "수정안을 만들지 못했어요.");
      }
      setStatus("");
    }
    finally {running.current=false;setBusy(false);setProposing(false);}
  }
  function addProposalFailureGuidance() {
    if (!proposalFailure) return;
    const addition=promptLabProposalFailureHelp(proposalFailure.code).feedbackAddition;
    if (!addition) return;
    const updated=`${feedback.trim()}${feedback.trim() ? "\n\n" : ""}${addition}`;
    if (updated.length > 2000) {
      setError("피드백 입력 한도를 넘어요. 기존 문장을 줄인 뒤 안내를 추가해 주세요.");
      return;
    }
    setFeedback(updated);
    setStatus("오류에 맞는 수정 안내를 피드백에 넣었어요. 내용을 확인한 뒤 다시 요청해 주세요.");
    feedbackField.current?.focus();
  }
  async function approve(retest:boolean) {
    if (!pending || !proposalCurrent || running.current) return;
    const snapshot={dream:pending.run.dream,emotion:pending.run.emotion,instructions:pending.proposal.instructions};
    const approvedHistory={...history,draft:snapshot,baselineId:pending.run.id,approvals:[...approvals,pending],pending:null};
    running.current=true;setBusy(true);
    try {await backup(approvedHistory);}
    catch(e){setError(e instanceof Error?e.message:"승인 기록을 저장하지 못했어요.");return;}
    finally{running.current=false;setBusy(false);}
    setInstructions(snapshot.instructions);setDream(snapshot.dream);setEmotion(snapshot.emotion);
    setBaselineId(pending.run.id);setApprovals(previous=>[...previous,pending]);setPending(null);
    if (retest) {
      setStatus("승인한 지침으로 기존 꿈을 테스트하고 있어요.");
      await execute(snapshot,approvedHistory);
    } else {
      setStatus("지침을 승인했어요. 꿈을 바꾸고 ‘현재 꿈과 지침으로 상세 해몽 실험’을 누르세요.");
      requestAnimationFrame(()=>dreamField.current?.focus());
    }
  }
  return <main id="main-content" className={styles.lab}>
    <header className={styles.intro}><p className={styles.eyebrow}>여운 유료 해몽 실험실</p><h1>상세 해몽부터 검증해요.</h1><p>꿈과 지침을 넣으면 상세 풀이를 바로 생성하고 검수해요. 무료 풀이 생성이나 결제 단계는 없어요.</p><small>서비스 프롬프트와 꿈 기록에는 반영되지 않아요. 결과·지침·수정 요청과 승인 내역을 브라우저와 이 컴퓨터의 프로젝트에 함께 기록해요.</small></header>
    <div className={styles.actions}>
      <button type="button" disabled={!ready || busy} onClick={download}>실험 기록 내려받기</button>
      <label className={styles.importLabel}>실험 기록 불러오기<input type="file" accept="application/json,.json" disabled={!ready || busy} onChange={e => {const file=e.target.files?.[0]; if(file) void importHistory(file); e.target.value="";}} /></label>
      <small>{!ready ? "저장된 기록을 불러오는 중…" : storageError ? "자동 저장 중단" : "이 브라우저에 자동 저장"}</small>
    </div>
    <details className={styles.importText}><summary>파일 선택이 어려우면 기록 내용 붙여넣기</summary>
      <form onSubmit={importPasted}><label htmlFor="lab-import-json">내려받은 JSON 파일의 전체 내용</label>
        <textarea id="lab-import-json" name="history" required rows={3} maxLength={20000000} disabled={!ready || busy} />
        <button type="submit" disabled={!ready || busy}>붙여넣은 기록 불러오기</button>
      </form>
    </details>
    <p role="status">{archiveStatus}</p>
    {archiveError && <p role="alert" className={styles.error}>{archiveError} <button type="button" disabled={!ready||busy} onClick={()=>void backup(history).catch(()=>undefined)}>프로젝트 저장 다시 시도</button></p>}
    <PromptLabArchivePanel disabled={!ready||busy} onRestore={saved=>{restore(mergeLabHistory(history,saved));setStatus("프로젝트에 보관된 실험을 불러왔어요.");}} />
    {storageError && <p role="alert" className={styles.error}>{storageError}</p>}
    <>
      <form onSubmit={submit} className={styles.editor} aria-busy={busy}>
        <fieldset disabled={busy || !ready}>
          <div className={styles.heading}><h2>테스트할 꿈</h2><small>{model}</small></div>
          <label htmlFor="lab-dream">기억나는 장면과 궁금한 점</label>
          <section className={styles.examplePicker} aria-label="실험 꿈 예시">
            <p>실험 예시 5개</p>
            <div>{examples.map(example => <button key={example.id} type="button" onClick={() => {
              setDream(example.dream);
              setEmotion(example.emotion);
              setStatus(example.source === "favorite" ? "이전에 선호로 남긴 꿈을 불러왔어요." : "이전에 테스트한 합성 꿈을 불러왔어요.");
              dreamField.current?.focus();
            }}>{example.label}</button>)}</div>
            {examplesError && <small role="status">{examplesError}</small>}
          </section>
          <textarea ref={dreamField} id="lab-dream" value={dream} onChange={e => {setDream(e.target.value);}} required minLength={2} maxLength={2000} rows={5} placeholder="같은 꿈 비교는 그대로 입력하고, 새 꿈을 시험하려면 내용을 바꿔 주세요." />
          <label htmlFor="lab-emotion">꿈에서 느낀 감정 <small>선택</small></label>
          <select id="lab-emotion" value={emotion ?? ""} onChange={e => {setEmotion(e.target.value ? e.target.value as Emotion : null);}}><option value="">선택하지 않음</option>{EMOTIONS.map(item => <option key={item}>{item}</option>)}</select>
          <div className={styles.heading}><h2>상세 해몽 프롬프트</h2><button type="button" disabled={instructions === defaults} onClick={() => {setInstructions(defaults);}}>앱 기본값으로 되돌리기</button></div>
          {working && <p className={styles.eyebrow}>이어갈 버전: 실험 {working.id}{workingUnchanged ? " · 선택한 지침 그대로" : " · 선택 후 지침 수정됨"}</p>}
          <label htmlFor="lab-instructions">이 실험에 적용할 지침</label>
          <textarea id="lab-instructions" className={styles.prompt} value={instructions} onChange={e => {setInstructions(e.target.value);}} required maxLength={40000} rows={16} spellCheck={false} />
          <small>사실 확인과 결과 검수는 앱의 기준을 그대로 사용해요. 지침만 바꿔 비교할 수 있어요.</small>
          <div className={styles.actions}><button className={styles.primary} disabled={!dream.trim() || !instructions.trim()}>{busy ? proposing ? "수정안 작성 중…" : "풀이 생성 중…" : runs.length ? "현재 꿈과 지침으로 상세 해몽 실험" : "상세 해몽 실험 시작"}</button><span>실제 AI 호출 · 결제 및 질문 차감 없음</span></div>
        </fieldset>
      </form>
      <p role="status" aria-live="polite">{status}{busy ? ` · ${elapsed}초 경과` : ""}</p>
      {busy && <small>상세 생성과 독립 검수가 끝나면 아래에 결과가 추가돼요.</small>}
    </>
    {error && <p role="alert" className={styles.error}>{error} 입력과 이전 결과는 유지돼요.</p>}
    {runs.length > 0 && <section className={styles.results}>
      <div className={styles.heading}><h2>풀이 비교</h2><small>이전 결과를 골라 ‘이 버전으로 계속하기’를 누르세요.</small></div>
      <div className={styles.selectors}><label>비교 기준<select disabled={busy} value={baselineId ?? ""} onChange={e => setBaselineId(Number(e.target.value))}>{runs.map(run => <option key={run.id} value={run.id}>실험 {run.id}{workingId === run.id ? " · 이어갈 버전" : ""}</option>)}</select></label><label>살펴볼 결과<select disabled={busy} value={selectedId ?? ""} onChange={e => setSelectedId(Number(e.target.value))}>{runs.map(run => <option key={run.id} value={run.id}>실험 {run.id}{workingId === run.id ? " · 이어갈 버전" : ""}</option>)}</select></label>
</div>
      {baseline && selected && baseline.dream !== selected.dream && <p>서로 다른 꿈의 결과를 비교하고 있어요.</p>}
      <div className={baseline && selected && baseline.id !== selected.id ? styles.comparison : ""}>
        {baseline && selected && baseline.id !== selected.id && <Reading key={`baseline-${baseline.id}`} run={baseline} label="비교 기준" chosen={workingId === baseline.id && workingUnchanged && dream === baseline.dream && emotion === baseline.emotion} disabled={busy} previewSettings={previewSettings.find(item=>item.runId===baseline.id)??{runId:baseline.id,previewMode:false,variant:"title",hiddenSectionIndexes:[],hideSuggestedQuestions:false,sectionCopy:[]}} onPreviewSettings={value=>setPreviewSettings(current=>[...current.filter(item=>item.runId!==value.runId),value])} onChoose={()=>void choose(baseline)} />}
        {selected && <Reading key={`selected-${selected.id}`} run={selected} label="살펴보는 결과" chosen={workingId === selected.id && workingUnchanged && dream === selected.dream && emotion === selected.emotion} disabled={busy} previewSettings={previewSettings.find(item=>item.runId===selected.id)??{runId:selected.id,previewMode:false,variant:"title",hiddenSectionIndexes:[],hideSuggestedQuestions:false,sectionCopy:[]}} onPreviewSettings={value=>setPreviewSettings(current=>[...current.filter(item=>item.runId!==value.runId),value])} onChoose={()=>void choose(selected)} />}
      </div>
      {selected && <section className={styles.feedback} aria-labelledby="feedback-heading">
        <h2 id="feedback-heading">원하는 방향을 함께 맞춰가요</h2>
        <PromptLabGoal state={goal} busy={busy} reviewCurrent={reviewCurrent} onChange={setGoal} onDiscuss={discussGoal} onConfirm={()=>void confirmGoal()}/>
        <p>실험 {selected.id}의 결과와 확인한 목표를 함께 보고 수정안을 제안해요. 승인하기 전에는 지침이 바뀌지 않아요.</p>
        {!memory&&<p>먼저 위 질문에 답하고 목표를 확인해 주세요. 이전 결과만 보고 원하는 방향을 정하지 않을게요.</p>}
        <form onSubmit={propose}><label htmlFor="lab-feedback">바라는 변화</label>
          <textarea ref={feedbackField} id="lab-feedback" value={feedback} disabled={busy} onChange={e=>setFeedback(e.target.value)} required minLength={2} maxLength={2000} rows={4} placeholder="예: 미련이 아니라는 설명을 반복하지 말고, 지금 여자친구 옆에서 왜 옛 인연이 나온 건지에 먼저 답했으면 좋겠어요." />
          <div className={styles.actions}><button className={styles.primary} disabled={busy || !memory || feedback.trim().length < 2}>{proposing ? "AI와 이야기하는 중…" : proposalFailure ? "확인한 내용으로 수정안 다시 요청" : "합의한 목표로 지침 수정안 요청"}</button></div>
          {status && <p role="status">{status}{busy ? ` · ${elapsed}초 경과` : ""}</p>}
          {proposalFailure && (()=>{
            const help=promptLabProposalFailureHelp(proposalFailure.code);
            return <section className={styles.proposalFailure} role="alert" aria-labelledby="proposal-failure-title">
              <h3 id="proposal-failure-title">{help.title}</h3>
              <p>{help.explanation}</p><p>{help.nextStep}</p>
              <div className={styles.actions}>
                {help.feedbackAddition && <button type="button" onClick={addProposalFailureGuidance}>오류에 맞는 안내를 피드백에 추가</button>}
                <button type="button" onClick={()=>feedbackField.current?.focus()}>피드백 직접 수정</button>
              </div>
              <details><summary>오류 코드와 시도 횟수</summary><p><code>{proposalFailure.code}</code> · {proposalFailure.attempts}회 시도</p></details>
            </section>;
          })()}
          {error && <p role="alert" className={styles.error}>{error}</p>}
        </form>
        {pending && <section className={styles.proposal} aria-labelledby="proposal-heading">
          <p className={styles.eyebrow}>승인 대기 · 실험 {pending.run.id}에 대한 제안</p>
          <h3 id="proposal-heading">지침을 이렇게 수정하겠습니다</h3><p>{pending.proposal.summary}</p>
          {pending.proposal.edits.map((edit,index)=><section className={styles.edit} key={index}><h4>{index+1}. {edit.reason}</h4><div className={styles.comparison}>
            <div><strong>변경 전</strong><pre>{edit.before}</pre></div><div><strong>변경 후</strong><pre>{edit.after}</pre></div>
          </div></section>)}
          <details><summary>수정 후 지침 전체 보기</summary><pre>{pending.proposal.instructions}</pre></details>
          {!proposalCurrent && <p role="status">목표·거절 기록·지침·피드백 또는 선택한 결과가 달라졌거나 목표 확인 전의 제안이에요. 현재 기준으로 수정안을 다시 요청해 주세요.</p>}
          <div className={styles.actions}><button className={styles.primary} disabled={busy || !proposalCurrent} onClick={()=>void approve(true)}>승인하고 같은 꿈 테스트</button>
            <button disabled={busy || !proposalCurrent} onClick={()=>void approve(false)}>승인하고 새 꿈 입력하기</button>
          </div>
          <label htmlFor="lab-rejection">이 수정안을 원하지 않는 이유 <small>선택</small></label>
          <textarea id="lab-rejection" disabled={busy} value={rejectionReason} onChange={e=>setRejectionReason(e.target.value)} maxLength={2000} rows={2} placeholder="이유를 남기면 다음 수정에서 같은 방향을 반복하지 않도록 참고해요."/>
          <button disabled={busy} onClick={()=>void rejectProposal()}>수정안 버리기 · 이유 보존</button>
        </section>}
        {rejections.length>0&&<details className={styles.proposal}><summary>다음 수정에도 전달할 거절 기록 {rejections.length}개</summary>
          {rejections.map((item,index)=><p key={index}>실험 {item.pending.run.id} · {item.pending.proposal.summary}<br/><strong>거절 이유:</strong> {item.reason}</p>)}
        </details>}
      </section>}
    </section>}
  </main>;
}
