'use client'

import { Fragment } from 'react'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { lyricLines } from '@ixa/domain'
import { goToLyricSync, goToMasterTrack, goToProjectConcept } from '@/components/workbench/workbench-navigation'
import { startFrameKnownFor } from '@/lib/shot-posters'
import { workflowSteps, type WorkflowStep, type WorkflowStepId } from '@/lib/workflow-steps'

/** 段の番号。帯の幅を取らないよう丸数字にする。 */
const NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'] as const

/** 済み・途中・分からないの印。まだの段は何も付けない。 */
const markOf = (step: WorkflowStep): string => {
  if (step.state === 'skipped') return ' —'
  if (step.state === 'done') return ' ✓'
  if (step.progress !== null) return ` ${String(step.progress.done)}/${String(step.progress.total)}`
  return ''
}

const toneOf = (step: WorkflowStep, isNext: boolean): string => {
  if (isNext) return 'bg-accent text-accent-fg font-semibold'
  if (step.state === 'done') return 'text-ok hover:bg-surface-2'
  if (step.state === 'skipped') return 'text-muted opacity-60 hover:bg-surface-2'
  if (step.state === 'partial') return 'text-text hover:bg-surface-2'
  return 'text-muted hover:bg-surface-2 hover:text-text'
}

/**
 * 制作の流れの帯（制作者 2026-10-01「上部に流れの帯」）。メニューの下に常に出す。
 *
 * 「音楽 → 区切り → Shot → Take」と飛ばして、作品と関係ない映像ができた。済んだ所に ✓、途中は件数、
 * 次にやる所を目立たせ、押すとその作業の画面へ行く。判定は `lib/workflow-steps.ts`（純粋な関数）。
 */
export const WorkflowBar = () => {
  const workbench = useWorkbench()
  const { steps, nextId } = workflowSteps({
    hasTrack: workbench.track !== null,
    concept: workbench.concept,
    lyricLineCount: lyricLines(workbench.project.lyrics).length,
    lyricCueCount: workbench.project.lyricCues.length,
    shots: (workbench.shots ?? []).map((shot) => ({
      description: shot.description,
      hasStartFrame: startFrameKnownFor(workbench.posters, shot.id),
      adopted: shot.selectedTakeId !== null,
    })),
  })

  const go: Readonly<Record<WorkflowStepId, () => void>> = {
    music: () => {
      goToMasterTrack(workbench, workbench.notify)
    },
    concept: () => {
      goToProjectConcept(workbench)
    },
    // 歌い出しに時刻を付ける（テロップにもする）。区切る前に済ませる（制作者 2026-10-02）。
    lyrics: () => {
      goToLyricSync(workbench)
    },
    // 区切りから「Shot にする」までは、聴きながら切るでする。
    cut: () => {
      workbench.focusPanel('cutter')
    },
    shots: () => {
      workbench.focusPanel('cutter')
    },
    // AI に説明の下書きを書かせる（あとから 1 件ずつ直せる）。
    storyboard: () => {
      workbench.focusPanel('draft')
    },
    // 絵（最初のフレーム）と Take は、Shot 一覧でチェックしてまとめて作る。
    frames: () => {
      workbench.focusPanel('shots')
    },
    takes: () => {
      workbench.focusPanel('shots')
    },
  }

  return (
    <nav
      aria-label="制作の流れ"
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1 text-xs"
    >
      {steps.map((step, index) => {
        const isNext = step.id === nextId
        return (
          <Fragment key={step.id}>
            {index > 0 && (
              <span aria-hidden="true" className="text-muted">
                →
              </span>
            )}
            <button
              type="button"
              aria-current={isNext ? 'step' : undefined}
              title={
                isNext
                  ? '次はここ'
                  : step.state === 'skipped'
                    ? '歌詞が無いので飛ばします（作品の方針で歌詞を入れると使えます）'
                    : undefined
              }
              onClick={go[step.id]}
              className={`h-6 shrink-0 whitespace-nowrap rounded px-2 tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${toneOf(step, isNext)}`}
            >
              {`${NUMBERS[index] ?? ''} ${step.label}${markOf(step)}`}
            </button>
          </Fragment>
        )
      })}
    </nav>
  )
}
