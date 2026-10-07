import { z } from "zod";

export const goalDraftSchema = z.object({
  wish: z.string().max(3000), keep: z.string().max(3000), avoid: z.string().max(3000)
});
export const goalAnswerSchema = z.object({question:z.string().min(1).max(600),answer:z.string().min(1).max(3000)});
export const goalBriefSchema = z.object({
  goal:z.string().min(1).max(1500), keep:z.string().min(1).max(1500), avoid:z.string().max(1500),
  successCriteria:z.array(z.string().min(1).max(400)).min(1).max(5),
  question:z.string().max(600)
});
export const goalReferenceSchema = z.object({runId:z.number().int().positive(),result:z.string().min(1).max(12000),instructions:z.string().min(1).max(40000)});
export const goalReviewSchema = z.object({
  draft:goalDraftSchema, answers:z.array(goalAnswerSchema), reference:goalReferenceSchema, brief:goalBriefSchema
});
export const goalAgreementSchema = goalReviewSchema.extend({id:z.string().uuid(),confirmedAt:z.string().datetime()})
  .refine(value=>value.draft.wish.trim().length>=2 && value.draft.keep.trim().length>=2 && !value.brief.question.trim(),
    "먼저 원하는 결과와 유지할 점을 답하고 목표를 확인해 주세요.");
export const goalDecisionSchema = z.object({
  status:z.enum(["approved","rejected"]),sourceRunId:z.number().int().positive(),
  feedback:z.string().max(2000),summary:z.string().max(600),reason:z.string().max(2000)
});
export const goalMemorySchema = z.object({agreement:goalAgreementSchema,decisions:z.array(goalDecisionSchema)});
export const goalDiscussionInputSchema = z.object({
  draft:goalDraftSchema.refine(value=>value.wish.trim().length>=2 && value.keep.trim().length>=2,"원하는 결과와 유지할 점을 먼저 알려주세요."),
  answers:z.array(goalAnswerSchema),reference:goalReferenceSchema,
  previousAgreement:goalAgreementSchema.nullable(),decisions:z.array(goalDecisionSchema)
});
export const goalStateSchema = z.object({
  draft:goalDraftSchema, answers:z.array(goalAnswerSchema), answer:z.string().max(3000),
  review:goalReviewSchema.nullable(),agreements:z.array(goalAgreementSchema),activeId:z.string().uuid().nullable(),editing:z.boolean()
});
export type GoalBrief=z.infer<typeof goalBriefSchema>;
export type GoalAgreement=z.infer<typeof goalAgreementSchema>;
export type GoalMemory=z.infer<typeof goalMemorySchema>;
export type GoalState=z.infer<typeof goalStateSchema>;
export type GoalDiscussionInput=z.infer<typeof goalDiscussionInputSchema>;
export const emptyGoalState=():GoalState=>({draft:{wish:"",keep:"",avoid:""},answers:[],answer:"",review:null,agreements:[],activeId:null,editing:true});
export const agreedGoal=(state:GoalState)=>state.editing?null:state.agreements.find(item=>item.id===state.activeId)??null;
export const goalMemoryKey=(memory:GoalMemory)=>JSON.stringify(memory);
export function goalReviewCurrent(state:GoalState,reference:z.infer<typeof goalReferenceSchema>) {
  return Boolean(state.review && JSON.stringify(state.review.draft)===JSON.stringify(state.draft) &&
    JSON.stringify(state.review.answers)===JSON.stringify(state.answers) && JSON.stringify(state.review.reference)===JSON.stringify(reference));
}
