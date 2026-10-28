import { checkWorkflowHealth, type LocalServerHealthCheck, type WorkflowHealthInput } from '@ixa/provider-video'
import { SFX_API_IDENTITY, SFX_API_MODELS } from './descriptor.js'
import { STABLE_AUDIO_MUSIC_WORKFLOW_ID, stableAudioMusicModel } from './music-descriptor.js'

/**
 * sfx-api の health（ADR-0052）。1 台で複数の AI（効果音の Stable Audio Medium・Small・MOSS と、曲の Stable Audio Medium）を
 * 出すので、workflow ごとに使えるかを見る（見方は `checkWorkflowHealth`）。
 */
const labelOf = (workflowId: string): string | undefined =>
  workflowId === STABLE_AUDIO_MUSIC_WORKFLOW_ID
    ? stableAudioMusicModel.label
    : SFX_API_MODELS.find((model) => model.workflowId === workflowId)?.label

export const checkSfxApiHealth = (input: WorkflowHealthInput): Promise<LocalServerHealthCheck> =>
  checkWorkflowHealth(SFX_API_IDENTITY, labelOf, input)
