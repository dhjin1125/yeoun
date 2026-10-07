"use client";

import type { FormEvent } from "react";
import { agreedGoal, type GoalState } from "@/lib/prompt-lab-goal";
import styles from "./prompt-lab.module.css";

export function PromptLabGoal({state,busy,reviewCurrent,onChange,onDiscuss,onConfirm}:{
  state:GoalState;busy:boolean;reviewCurrent:boolean;onChange:(state:GoalState)=>void;
  onDiscuss:(event:FormEvent)=>void;onConfirm:()=>void;
}) {
  const agreement=agreedGoal(state);
  const brief=agreement?.brief??state.review?.brief;
  return <section className={styles.goal} aria-labelledby="goal-heading">
    <h3 id="goal-heading">먼저, 어떤 풀이를 원하세요?</h3>
    <p>원하는 방향을 추측하지 않고 먼저 맞춰볼게요. 확인한 목표와 유지할 장점, 거절 이유는 다음 수정에도 이어서 참고해요.</p>
    {agreement?<>
      <p className={styles.eyebrow}>함께 확인한 목표 · 기준 실험 {agreement.reference.runId}</p>
      <button type="button" disabled={busy} onClick={()=>onChange({...state,editing:true,review:null,answer:""})}>목표 다시 이야기하기</button>
    </>:<form onSubmit={onDiscuss}>
      <fieldset disabled={busy}>
        <label htmlFor="lab-goal-wish">어떤 결과가 나오면 ‘원하던 풀이’라고 느끼실까요?</label>
        <textarea id="lab-goal-wish" required minLength={2} maxLength={3000} rows={3} value={state.draft.wish} placeholder="원하는 느낌이나 문장 예시로 편하게 적어 주세요."
          onChange={e=>onChange({...state,draft:{...state.draft,wish:e.target.value},review:null,answers:[],answer:""})}/>
        <label htmlFor="lab-goal-keep">기준 결과에서 꼭 유지하고 싶은 점은 무엇인가요?</label>
        <textarea id="lab-goal-keep" required minLength={2} maxLength={3000} rows={2} value={state.draft.keep} placeholder="좋았던 설명이나 문장을 알려주세요. 아직 모르겠다면 그렇게 적어도 괜찮아요."
          onChange={e=>onChange({...state,draft:{...state.draft,keep:e.target.value},review:null,answers:[],answer:""})}/>
        <label htmlFor="lab-goal-avoid">어떤 수정이 싫었고, 왜 원복했나요? <small>선택</small></label>
        <textarea id="lab-goal-avoid" maxLength={3000} rows={2} value={state.draft.avoid}
          onChange={e=>onChange({...state,draft:{...state.draft,avoid:e.target.value},review:null,answers:[],answer:""})}/>
        {state.answers.map((item,index)=><p key={index}><strong>{item.question}</strong><br/>{item.answer}</p>)}
        {state.review?.brief.question&&<>
          <label htmlFor="lab-goal-answer">{state.review.brief.question}</label>
          <textarea id="lab-goal-answer" required minLength={1} maxLength={3000} rows={3} value={state.answer} onChange={e=>onChange({...state,answer:e.target.value})}/>
        </>}
        <div className={styles.actions}><button type="submit" disabled={busy||state.draft.wish.trim().length<2||state.draft.keep.trim().length<2}>
          {state.review?.brief.question?"답변하고 목표 다시 정리하기":"AI와 목표 정리하기"}
        </button></div>
      </fieldset>
    </form>}
    {brief&&<div className={styles.goalBrief}>
      <h4>{agreement?"앞으로 함께 사용할 기준":"제가 이해한 방향이에요"}</h4>
      <dl><dt>원하는 결과</dt><dd>{brief.goal}</dd><dt>유지할 장점</dt><dd>{brief.keep}</dd>
        <dt>피할 변경</dt><dd>{brief.avoid||"아직 말씀하신 내용이 없어요."}</dd></dl>
      <strong>좋아졌는지 비교할 기준</strong><ul>{brief.successCriteria.map((item,index)=><li key={index}>{item}</li>)}</ul>
      {!agreement&&!brief.question&&<>
        {!reviewCurrent&&<p>입력이나 기준 결과가 달라졌어요. 현재 내용으로 목표를 다시 정리해 주세요.</p>}
        <button type="button" className={styles.primary} disabled={busy||!reviewCurrent} onClick={onConfirm}>맞아요, 이 목표로 진행</button>
        <p><small>다르면 위 답변을 고쳐 다시 정리할 수 있어요. 목표 확인만으로 지침을 변경하거나 풀이를 생성하지 않아요.</small></p>
      </>}
    </div>}
  </section>;
}
