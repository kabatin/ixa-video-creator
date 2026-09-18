'use client'

import type { MusicTrack } from '@ixa/domain'
import type { ReactNode } from 'react'
import { AnalysisStarter } from '@/components/analysis-starter'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { PanelEmpty } from '@/components/workbench/panels/panel-frame'
import { Button } from '@/components/ui/button'
import type { WireMusicAnalysis } from '@/lib/music-api'

/**
 * 楽曲と解析が揃うまでの案内（UI-WORKBENCH 7.4）。揃ったら中身を出す。
 *
 * **「楽曲なし」「解析なし」「読めていない」を畳まない**（L-015）。次の一手が違う。
 * 以前は `ErrorPanel` / `AnalysisStarter` がページ全体を占有していた。
 */
export const MusicGate = ({
  children,
}: {
  readonly children: (music: { readonly track: MusicTrack; readonly analysis: WireMusicAnalysis }) => ReactNode
}) => {
  const workbench = useWorkbench()

  if (!workbench.musicLoaded) {
    return (
      <PanelEmpty
        title="楽曲を読み込めませんでした"
        hint="ステータスバーの読み込みエラーを確認してください。"
      />
    )
  }
  if (workbench.track === null) {
    return (
      <PanelEmpty
        title="楽曲が登録されていません"
        hint="音源をアップロードして楽曲として登録すると、波形の上で区切りを置けます。"
      >
        <Button
          tone="primary"
          size="sm"
          onClick={() => {
            workbench.openDialog('music')
          }}
        >
          楽曲を登録
        </Button>
      </PanelEmpty>
    )
  }
  if (workbench.analysis === null) {
    return <AnalysisStarter track={workbench.track} />
  }
  return <>{children({ track: workbench.track, analysis: workbench.analysis })}</>
}
