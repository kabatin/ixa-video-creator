'use client'

import { lyricLines } from '@ixa/domain'
import { createContext, useContext, type ReactNode } from 'react'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { goToLyricSync, goToMasterTrack, goToProjectConcept } from '@/components/workbench/workbench-navigation'
import { startFrameKnownFor } from '@/lib/shot-posters'
import { workflowSteps, type WorkflowStep, type WorkflowStepId } from '@/lib/workflow-steps'

/**
 * 制作の流れ（次にやること）を、流れの帯とストーリーボードの空の表示で共有する（制作者 2026-10-03「楽曲を登録すると
 * 次何したらいいんだ？ってなる」）。判定は `lib/workflow-steps.ts`（純粋な関数）が正で、ここは材料を集めて渡すだけ。
 *
 * テロップの数と書き出しの履歴はワークベンチの外で読む（`ProjectWorkbench`）。ここは受け取るだけにして、
 * テストから値を渡せるようにする。
 */

export type WorkflowValue = {
  readonly steps: readonly WorkflowStep[]
  readonly nextId: WorkflowStepId | null
  /** その段の作業の画面へ行く。 */
  readonly go: (id: WorkflowStepId) => void
}

const WorkflowContext = createContext<WorkflowValue | null>(null)

export const WorkflowProvider = ({
  lyricTelopCount,
  rendered,
  children,
}: {
  /** 歌詞から置いたテロップの数。読めていなければ null。 */
  readonly lyricTelopCount: number | null
  /** 書き出しが 1 度でも終わったか。読めていなければ null。 */
  readonly rendered: boolean | null
  readonly children: ReactNode
}) => {
  const workbench = useWorkbench()
  const { steps, nextId } = workflowSteps({
    hasTrack: workbench.track !== null,
    concept: workbench.concept,
    hasLook: workbench.project.styleGuide.trim() !== '',
    lyricLineCount: lyricLines(workbench.project.lyrics).length,
    lyricCueCount: workbench.project.lyricCues.length,
    lyricTelopCount,
    shots: (workbench.shots ?? []).map((shot) => ({
      description: shot.description,
      hasStartFrame: startFrameKnownFor(workbench.posters, shot.id),
      adopted: shot.selectedTakeId !== null,
    })),
    rendered,
  })

  const go = (id: WorkflowStepId): void => {
    switch (id) {
      case 'music':
        goToMasterTrack(workbench, workbench.notify)
        return
      case 'concept':
        goToProjectConcept(workbench)
        return
      // 歌い出しに時刻を付け、そこでテロップにする（「歌詞をテロップにする」は歌詞のモードにある）。
      case 'lyrics':
      case 'telops':
        goToLyricSync(workbench)
        return
      // 区切りから「Shot にする」までは、聴きながら切るの区切るモードでする。
      case 'shots':
        workbench.openCutter('cut')
        return
      // AI に説明の下書きを書かせる（あとから 1 件ずつ直せる）。
      case 'storyboard':
        workbench.focusPanel('draft')
        return
      // 絵（最初のフレーム）と Take は、Shot 一覧でチェックしてまとめて作る。
      case 'frames':
      case 'takes':
        workbench.focusPanel('shots')
        return
      case 'render':
        workbench.openDialog('render')
        return
    }
  }

  const value: WorkflowValue = { steps, nextId, go }
  return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>
}

export const useWorkflow = (): WorkflowValue => {
  const value = useContext(WorkflowContext)
  if (value === null) throw new Error('useWorkflow は WorkflowProvider の中で使ってください')
  return value
}
