'use client'

import type { MusicTrack } from '@ixa/domain'
import { MusicPanel } from '@/components/music-panel'
import { useLoaded } from '@/components/workbench/use-loaded'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { PanelNotice } from '@/components/workbench/panels/panel-frame'
import { createApiClient } from '@/lib/api-client'

/**
 * 楽曲・解析（ダイアログ。UI-WORKBENCH §3.3）。中身は既存の `music-panel`。
 * 登録や解析の結果はサーバの読み直しでワークベンチへ届くので、閉じたときに取り直さない。
 */
export const MusicDialogBody = () => {
  const { project } = useWorkbench()
  const tracks = useLoaded<readonly MusicTrack[]>(
    '楽曲',
    () => createApiClient().listMusicTracks(project.id),
    project.id,
  )
  if (tracks.state === 'loading') return <p className="text-sm text-muted">読み込んでいます…</p>
  if (tracks.state === 'error') return <PanelNotice tone="danger">{tracks.message}</PanelNotice>
  return (
    <MusicPanel projectId={project.id} workspaceId={project.workspaceId} initialTracks={tracks.value} />
  )
}
