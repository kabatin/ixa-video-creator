import type { NarrationLineRepository } from '@ixa/db'
import type { EditBatchAssetEdit, NarrationLineId, ProjectId } from '@ixa/domain'
import { syncNarrationTelops, type NarrationTelopSyncDeps } from '@ixa/generation'

/**
 * 声を戻したあとの後始末（2026-10-19 のレビュー）。素材の記録を戻した直後、行を戻す前に呼ぶ。
 *
 * - **作った声を戻した**（論理削除した）なら、その声に割り当てた行を「声が未定」に戻す（声を消す口と同じ）。
 *   消えた声を指したままの行を残さない
 * - **声の見た目（textStyleId）の直しを戻した**なら、その声の行のテロップを作り直す（直す口と同じ）
 * - **戻せなかった声**を返す。その声を指す行の記録は当てない（当てると消えた声を指す）
 */

export type VoiceUndoDeps = {
  readonly narration?: NarrationTelopSyncDeps & { readonly lines: Pick<NarrationLineRepository, 'findByProject' | 'update'> }
}

export const VOICE_NOT_RESTORED_REASON = '話していた声を戻せなかったので、この行も戻していません'

export const settleVoiceUndo = async (
  deps: VoiceUndoDeps,
  projectId: ProjectId,
  edits: readonly EditBatchAssetEdit[],
  result: { readonly restored: readonly string[]; readonly failed: readonly { readonly assetId: string }[] },
): Promise<ReadonlySet<string>> => {
  const voices = edits.filter((edit) => edit.asset === 'voice')
  const failedIds = new Set(result.failed.map((entry) => entry.assetId))
  const restoredIds = new Set(result.restored)
  const failedVoices = new Set(voices.filter((edit) => failedIds.has(edit.id)).map((edit) => edit.id))
  const removedVoices = new Set(voices.filter((edit) => edit.op === 'create' && restoredIds.has(edit.id)).map((edit) => edit.id))
  const restyledVoices = new Set(
    voices
      .filter((edit) => edit.op === 'update' && edit.before.textStyleId !== undefined && restoredIds.has(edit.id))
      .map((edit) => edit.id),
  )
  if (deps.narration === undefined || removedVoices.size + restyledVoices.size === 0) return failedVoices

  const lines = await deps.narration.lines.findByProject(projectId)
  const restyle: NarrationLineId[] = []
  for (const line of lines) {
    const voiceId = line.voiceProfileId
    if (voiceId === null) continue
    if (removedVoices.has(voiceId)) {
      await deps.narration.lines.update(line.id, { voiceProfileId: null })
      restyle.push(line.id)
    } else if (restyledVoices.has(voiceId)) {
      restyle.push(line.id)
    }
  }
  if (restyle.length > 0) await syncNarrationTelops(deps.narration, projectId, { restyle })
  return failedVoices
}
