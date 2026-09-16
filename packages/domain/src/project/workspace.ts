import { z } from 'zod'
import { WorkspaceId } from '../common/ids.js'

/** すべてのエンティティのルート。MVP では 1 つだけ存在する想定。 */
export const Workspace = z.object({
  id: WorkspaceId,
  name: z.string().min(1).max(200),
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type Workspace = z.infer<typeof Workspace>

export const CreateWorkspaceInput = Workspace.pick({ name: true })
export type CreateWorkspaceInput = z.input<typeof CreateWorkspaceInput>
