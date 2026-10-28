import { checkWorkflowHealth, type LocalServerHealthCheck, type WorkflowHealthInput } from '@ixa/provider-video'
import { KLEIN_IDENTITY, KLEIN_WORKFLOW_ID, kleinWorkflowLabelOf } from './descriptor.js'

/**
 * klein-api の health（ADR-0065）。1 台で FLUX.2 [klein]（9B・4B）と Z Image Turbo を出すので、workflow ごとに見る。
 * **workflow の一覧を返さない古い版には flux2-klein しか無い**（Z Image を選べるように見せて、投入で 404 にしない）。
 */
export const checkKleinHealth = (input: WorkflowHealthInput): Promise<LocalServerHealthCheck> =>
  checkWorkflowHealth(KLEIN_IDENTITY, kleinWorkflowLabelOf, input, { legacyWorkflows: [KLEIN_WORKFLOW_ID] })
