'use client'

import { useMemo } from 'react'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { deriveTrackTitle } from '@/lib/music-upload'

/**
 * 手元の音のファイルを、作品の効果音の素材にする（制作者 2026-10-19）。効果音の段には置かない（置いていない候補）。
 * 素材ツリーの効果音に出し、そこから効果音の段へドラッグして置く。名前はファイル名（拡張子を除く）。
 */
export const useSfxFileImport = (): ((file: File) => Promise<{ readonly title: string }>) => {
  const workbench = useWorkbench()
  const api = useMemo(() => createApiClient(), [])
  return async (file) => {
    const title = deriveTrackTitle(file.name)
    const asset = await api.uploadMedia(file, {
      workspaceId: workbench.project.workspaceId,
      projectId: workbench.projectId,
      kind: 'audio',
    })
    await api.uploadSfxSound(workbench.projectId, { mediaAssetId: asset.id, title })
    return { title }
  }
}
