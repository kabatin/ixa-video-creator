'use client'

import { MediaAssetId } from '@ixa/domain'
import { readyOr, useAssets } from '@/components/workbench/asset-store'
import { NarrationLane } from '@/components/workbench/narration/narration-lane'
import { useNarration } from '@/components/workbench/narration/use-narration'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { describeForPerson } from '@/lib/api-error'
import { audioFileDurationSec } from '@/lib/audio-file-duration'
import { formatClock } from '@/lib/format-time'
import { laneBlocks } from '@/lib/narration-lane'

/**
 * タイムラインの音の口（ADR-0038 / 0039）。ナレーションのレーン（行の投影・動かす）と、効果音の帯へ落とした音を置く。
 * 失敗は上の知らせに出す（押したのに何も起きない、にしない）。
 */
export const useTimelineAudio = (onClipsChanged: () => void) => {
  const workbench = useWorkbench()
  const { voices } = useAssets()
  const { api, overview, apply } = useNarration()
  const lines = overview.state === 'ready' ? overview.value.lines : []
  const blocks = laneBlocks(
    lines,
    readyOr(voices).map((voice) => voice.id),
  )

  const narrationLane = (pxPerSec: number) => (
    <NarrationLane
      blocks={blocks}
      pxPerSec={pxPerSec}
      onMove={(lineId, startSec) => {
        const line = lines.find((candidate) => candidate.id === lineId)
        if (line === undefined) return
        api
          .updateNarrationLine(line.id, { startSec })
          .then(apply)
          .catch((cause: unknown) => {
            workbench.notify(`ナレーションを動かせませんでした: ${describeForPerson(cause)}`)
          })
      }}
    />
  )

  const onDropAudio = (file: File, atSec: number): void => {
    workbench.notify(`効果音「${file.name}」を ${formatClock(atSec)} に置いています…`)
    audioFileDurationSec(file)
      .then(async (durationSec) => {
        const asset = await api.uploadMedia(file, { workspaceId: workbench.project.workspaceId, projectId: workbench.projectId, kind: 'audio' })
        await api.createClip(workbench.projectId, {
          track: 'SFX',
          startSec: atSec,
          durationSec,
          content: { type: 'media', mediaAssetId: MediaAssetId.parse(asset.id), inSec: 0, outSec: durationSec, volume: 1 },
        })
        workbench.notify(`効果音「${file.name}」を ${formatClock(atSec)} に置きました。`)
        onClipsChanged()
      })
      .catch((cause: unknown) => {
        workbench.notify(`効果音を置けませんでした: ${describeForPerson(cause)}`)
      })
  }

  return { narrationLane, onDropAudio }
}
