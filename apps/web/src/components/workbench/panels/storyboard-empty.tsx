'use client'

import { Button } from '@/components/ui/button'
import { PanelEmpty } from '@/components/workbench/panels/panel-frame'
import { StoryboardNoTrack } from '@/components/workbench/panels/storyboard-no-track'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { useWorkflow } from '@/components/workbench/workflow-context'
import { WORKFLOW_ACTIONS, type WorkflowStep } from '@/lib/workflow-steps'

/**
 * Shot が 0 件のストーリーボード（制作者 2026-10-03「楽曲を登録するとストーリーボードに「Shot はまだありません」と
 * 「聴きながら切る」「Shot を 1 件だけ作る」があり、Shot を作ってしまいそう」）。
 *
 * Shot の前にやること（作品の方針・歌詞の時刻・テロップ）を済ませてから区切ると、絵と歌詞が合う。
 * **次にやる 1 つを主ボタンにし**、Shot までの段を済んだ印つきで並べる。判定は流れの帯と同じ（`useWorkflow`）。
 * Shot を先に 1 件作る道は控えめに残す。
 */

/** Shot を作るまでの段（ここまでがストーリーボードの外の作業）。 */
const BEFORE_SHOTS = new Set(['music', 'concept', 'lyrics', 'telops', 'shots'])

const markOf = (step: WorkflowStep): string => {
  if (step.state === 'done') return '✓'
  if (step.state === 'skipped') return '—'
  if (step.progress !== null) return `${String(step.progress.done)}/${String(step.progress.total)}`
  return ''
}

export const StoryboardEmpty = () => {
  const workbench = useWorkbench()
  const { steps, nextId, go } = useWorkflow()

  // 曲の無い人にも入口を出す（楽曲を登録・曲を作る…・曲なしで始める）。
  if (workbench.musicLoaded && workbench.track === null) return <StoryboardNoTrack />


  const before = steps.filter((step) => BEFORE_SHOTS.has(step.id))
  // Shot の前の段がまだなら、その段。済んでいれば（分からない段だけが残っていても）区切って Shot にする。
  const target = nextId !== null && BEFORE_SHOTS.has(nextId) ? nextId : 'shots'

  return (
    <PanelEmpty
      title="Shot はまだありません"
      hint={
        workbench.project.instrumental
          ? '作品の方針を済ませてから区切ると、絵が作品に合います。'
          : '作品の方針・歌詞の時刻・テロップを済ませてから区切ると、絵と歌詞が合います。'
      }
    >
      <ol aria-label="Shot を作るまで" className="flex flex-col gap-1 text-left text-sm">
        {before.map((step, index) => {
          const isTarget = step.id === target
          return (
            <li
              key={step.id}
              aria-current={isTarget ? 'step' : undefined}
              className={`flex items-center gap-2 ${isTarget ? 'font-semibold text-text' : step.state === 'done' ? 'text-ok' : 'text-muted'}`}
            >
              <span className="w-4 text-right tabular-nums">{String(index + 1)}</span>
              <span>{step.label}</span>
              <span className="tabular-nums">{markOf(step)}</span>
            </li>
          )
        })}
      </ol>
      <Button
        tone="primary"
        size="sm"
        onClick={() => {
          go(target)
        }}
      >
        {WORKFLOW_ACTIONS[target]}
      </Button>
      <button
        type="button"
        onClick={() => {
          workbench.openDialog('new-shot')
        }}
        className="text-xs text-muted underline hover:text-text"
      >
        Shot を 1 件だけ作る
      </button>
    </PanelEmpty>
  )
}
