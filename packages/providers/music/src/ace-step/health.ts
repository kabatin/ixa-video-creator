import type { LocalServerHealthCheck } from '@ixa/provider-video'
import { checkWorkflowHealth, type WorkflowHealthInput } from '../local-server/workflow-health.js'
import { ACE_STEP_IDENTITY, ACE_STEP_MUSIC_MODELS, aceStepWorkflowOf } from './descriptor.js'

/**
 * ace-step-api の health（ADR-0048 追記）。1 台で ACE-Step と MiniMax-Music3 を出し、片方のエンジンが
 * 使えなくてももう片方は動くので、workflow ごとに使えるかを見る（見方は `checkWorkflowHealth`）。
 */
const labelOf = (workflowId: string): string | undefined =>
  ACE_STEP_MUSIC_MODELS.find((model) => aceStepWorkflowOf(model.id) === workflowId)?.label

export const checkAceStepHealth = (input: WorkflowHealthInput): Promise<LocalServerHealthCheck> =>
  checkWorkflowHealth(ACE_STEP_IDENTITY, labelOf, input)
