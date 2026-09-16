import { WorkspaceId } from '@ixa/domain'

export type WorkspaceResolution =
  | { readonly ok: true; readonly workspaceId: WorkspaceId }
  | { readonly ok: false; readonly reason: string }

const MISSING =
  '環境変数 NEXT_PUBLIC_WORKSPACE_ID が設定されていません。apps/web/.env.example を参照してください。'

const INVALID = '環境変数 NEXT_PUBLIC_WORKSPACE_ID が ULID ではありません。'

/**
 * 表示対象の Workspace を env から解決する。
 * MVP では Workspace は 1 つだけ存在する想定（packages/domain/src/project/workspace.ts）。
 */
export const resolveWorkspaceId = (
  raw: string | undefined = process.env.NEXT_PUBLIC_WORKSPACE_ID,
): WorkspaceResolution => {
  if (raw === undefined || raw.trim() === '') return { ok: false, reason: MISSING }

  const parsed = WorkspaceId.safeParse(raw.trim())
  if (!parsed.success) return { ok: false, reason: INVALID }

  return { ok: true, workspaceId: parsed.data }
}
