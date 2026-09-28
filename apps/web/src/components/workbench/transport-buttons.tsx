'use client'

import { useMemo, type ReactNode } from 'react'
import { SharedPlayButton } from '@/components/workbench/shared-play-button'
import {
  NextEditIcon,
  PreviousEditIcon,
  StepBackIcon,
  StepForwardIcon,
} from '@/components/workbench/transport-icons'
import { useWorkbench, type TransportOwner } from '@/components/workbench/workbench-context'
import { programEndSec } from '@/lib/timeline-display'
import {
  editPointsOf,
  frameStepTarget,
  nextEditPoint,
  previousEditPoint,
} from '@/lib/transport-steps'

const StepButton = ({
  label,
  onClick,
  children,
}: {
  readonly label: string
  readonly onClick: () => void
  readonly children: ReactNode
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className="inline-flex h-7 w-8 shrink-0 items-center justify-center rounded text-text hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
  >
    {children}
  </button>
)

/**
 * 再生の操作列。**一般的な動画編集ツールと同じ並び**（2026-09-28、制作者の提案）:
 * 前の境目へ・1 コマ戻る・再生 / 一時停止・1 コマ進む・次の境目へ。
 *
 * - 位置は共有の 1 つ。どのパネルの列で押しても同じ場所へ動く
 * - 再生だけは**置かれたパネルが鳴る**（`SharedPlayButton`）
 * - 1 コマは書き出しと同じ 1/fps 秒。コマ送りは止めてから動かす（一般的な道具と同じ）
 * - 境目は Shot の頭と終わり・曲の頭と終わり。境目へ飛んでも再生は止めない
 * - 再生中の「前の境目へ」は、いまの Shot の頭を飛ばして 1 つ前の Shot の頭へ（`previousEditPoint`）
 *
 * 位置は押した瞬間に読む（`getTransport`）。**毎コマ描き直さない**（`@/lib/playhead-sec`）。
 */
export const TransportButtons = ({
  owner,
  durationSec,
}: {
  readonly owner: TransportOwner
  /** 尺。分からなければ Shot の終わりまで。 */
  readonly durationSec: number | null
}) => {
  const { transportControls, shots, project } = useWorkbench()
  const { fps } = project
  const endSec = durationSec ?? programEndSec(shots ?? [])
  const points = useMemo(() => editPointsOf(shots ?? [], endSec), [shots, endSec])
  const now = (): number => transportControls.getTransport().currentSec

  const stepFrame = (direction: -1 | 1): void => {
    transportControls.pause()
    transportControls.seekTo(frameStepTarget(now(), direction, fps, endSec))
  }
  const jumpTo = (target: number | null): void => {
    if (target !== null) transportControls.seekTo(target)
  }

  return (
    <div role="group" aria-label="再生の操作" className="flex shrink-0 items-center gap-0.5">
      <StepButton
        label="前の境目へ"
        onClick={() => {
          const { currentSec, playing } = transportControls.getTransport()
          jumpTo(previousEditPoint(points, currentSec, fps, { playing }))
        }}
      >
        <PreviousEditIcon />
      </StepButton>
      <StepButton label="1コマ戻る" onClick={() => stepFrame(-1)}>
        <StepBackIcon />
      </StepButton>
      <SharedPlayButton owner={owner} />
      <StepButton label="1コマ進む" onClick={() => stepFrame(1)}>
        <StepForwardIcon />
      </StepButton>
      <StepButton label="次の境目へ" onClick={() => jumpTo(nextEditPoint(points, now(), fps))}>
        <NextEditIcon />
      </StepButton>
    </div>
  )
}
