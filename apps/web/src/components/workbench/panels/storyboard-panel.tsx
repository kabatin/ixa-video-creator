'use client'

import { useEffect, useMemo, useState } from 'react'
import { StoryboardGrid } from '@/components/workbench/storyboard-grid'
import { readyOr, useAssets } from '@/components/workbench/asset-store'
import { useAssetDrop } from '@/components/workbench/use-asset-drop'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { PanelEmpty, PanelFrame, PanelNotice } from '@/components/workbench/panels/panel-frame'
import { Button } from '@/components/ui/button'
import { AddTrackButton } from '@/components/workbench/ui/add-track-button'
import { createApiClient } from '@/lib/api-client'
import {
  beatAlignmentToneClass,
  buildShotAlignments,
  summarizeBeatAlignment,
} from '@/lib/beat-alignment-view'

/**
 * ストーリーボード（中央上）。カードを最大 3 列で並べる（UI-WORKBENCH §5.3）。
 *
 * 拍とのズレは解析を持っているのでその場で判定する。**判定は `@ixa/domain` の
 * `alignBoundary` 1 箇所**なので、タイムライン（サーバ経由）と結果は必ず一致する。
 */
export const StoryboardPanel = () => {
  const workbench = useWorkbench()
  const { shots, analysis, track } = workbench
  const pendingDrafts = usePendingDraftCount()
  const { locations } = useAssets()
  const drop = useAssetDrop(workbench.notify)

  const alignment = useMemo(() => {
    if (shots === null || analysis === null || track === null) return null
    const views = buildShotAlignments(shots, analysis.beats, analysis.downbeats)
    return {
      views,
      summary: summarizeBeatAlignment({
        source: analysis.beats.length === 0 ? 'no_beats' : 'available',
        trackTitle: track.title,
        views,
      }),
    }
  }, [shots, analysis, track])

  const toolbar = (
    <>
      <span className="text-muted">{shots === null ? '—' : `${String(shots.length)} Shots`}</span>
      {alignment !== null && (
        /* 色だけでは全体像が掴めない。何件が外れているかを必ず文でも出す。 */
        <span className={`truncate text-xs ${beatAlignmentToneClass(alignment.summary.tone)}`}>
          {alignment.summary.text}
        </span>
      )}
      <span className="ml-auto" />
      <Button
        size="sm"
        onClick={() => {
          workbench.focusPanel('draft')
        }}
      >
        絵コンテ下書き…
      </Button>
    </>
  )

  if (shots === null) {
    return (
      <PanelFrame toolbar={toolbar}>
        <PanelEmpty
          title="Shot を読み込めていません"
          hint="ステータスバーの読み込みエラーを確認してください。"
        />
      </PanelFrame>
    )
  }

  if (shots.length === 0) {
    return (
      <PanelFrame toolbar={toolbar}>
        <StoryboardEmpty />
      </PanelFrame>
    )
  }

  return (
    <PanelFrame toolbar={toolbar}>
      {/**
       * **裏のタブは見つけられない。** 案が待っているのに知らせるものが無く、
       * 制作者が探せなかった（2026-09-18）。件数を出し、押せばタブが開く。
       */}
      {pendingDrafts > 0 && (
        <PanelNotice tone="info">
          {`絵コンテの案が ${String(pendingDrafts)} 件あります（まだ採用していないもの）。`}
          <Button
            size="sm"
            onClick={() => {
              workbench.focusPanel('draft')
            }}
          >
            絵コンテ下書きを開く
          </Button>
        </PanelNotice>
      )}
      {workbench.posterError !== null && (
        <PanelNotice tone="warn">{workbench.posterError}</PanelNotice>
      )}
      <StoryboardGrid
        shots={shots}
        posters={workbench.posters}
        selectedShotId={workbench.selectedShotId}
        onSelect={workbench.selectShot}
        alignments={alignment?.views}
        onOpen={(shotId) => {
          workbench.selectShot(shotId)
          workbench.focusPanel('compare')
        }}
        locationName={(shot) =>
          shot.locationId === null
            ? null
            : (readyOr(locations).find((l) => l.id === shot.locationId)?.name ?? null)
        }
        dropHandlers={drop.handlers}
        dropState={drop.stateOf}
      />
      <p className="mt-2 text-xs text-muted">
        カードを 2 回押すと Take
        比較。素材ツリーのキャラクターやロケーションをカードへ落とすと割り当てます。
      </p>
    </PanelFrame>
  )
}

/** Shot が 0 件。楽曲の有無で次の一手が変わる。 */
const StoryboardEmpty = () => {
  const workbench = useWorkbench()
  if (workbench.musicLoaded && workbench.track === null) {
    return (
      <PanelEmpty
        title="楽曲が登録されていません"
        hint="曲を登録して解析すると、波形の上で区切りを置いて Shot にできます。"
      >
        <AddTrackButton />
      </PanelEmpty>
    )
  }
  return (
    <PanelEmpty
      title="Shot はまだありません"
      hint="下の「聴きながら切る」で区切りを置いて Shot にするのが本筋です。1 件だけ作ることもできます。"
    >
      <div className="flex gap-2">
        <Button
          tone="primary"
          size="sm"
          onClick={() => {
            workbench.focusPanel('cutter')
          }}
        >
          聴きながら切る
        </Button>
        <Button
          size="sm"
          onClick={() => {
            workbench.openDialog('new-shot')
          }}
        >
          Shot を 1 件だけ作る
        </Button>
      </div>
    </PanelEmpty>
  )
}

/** まだ採用していない下書きの件数。**0 件なら何も出さない。** 開いたときに 1 回だけ引く。 */
const usePendingDraftCount = (): number => {
  const { projectId } = useWorkbench()
  const [count, setCount] = useState(0)
  useEffect(() => {
    let cancelled = false
    createApiClient()
      .getLatestDraft(projectId)
      .then((latest) => {
        if (!cancelled) setCount(latest.items.filter((item) => item.adoptedAt === null).length)
      })
      .catch(() => {
        // 知らせが出ないだけ。本体は下書きと無関係なので、ここでは落とさない。
        if (!cancelled) setCount(0)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])
  return count
}
