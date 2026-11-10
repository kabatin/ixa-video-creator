'use client'

import { projectKindRule, type ProjectStart } from '@ixa/domain'
import { Button } from '@/components/ui/button'
import { AddTrackButton } from '@/components/workbench/ui/add-track-button'
import { PanelEmpty } from '@/components/workbench/panels/panel-frame'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { useWorkflow } from '@/components/workbench/workflow-context'

/**
 * 楽曲が無いときのストーリーボード。曲の無い人にも入口を出す（以前は「楽曲を登録」1 つだけだった）。
 *
 * - 楽曲を登録・曲を作る…（手元の AI。ADR-0048）・曲なしで始める（ナレーションから）の 3 つ
 * - 主ボタン（塗り）は作品の種類の始め方（`projectKindRule`）に合わせる。素材置き場は主ボタンを置かない
 * - 置いたナレーションがもうあれば、その切れ目で Shot にする道（聴きながら切るの `NarrationCuts`）を主ボタンにする
 */

/** 始め方ごとの一言。 */
const GUIDANCE: Readonly<Record<ProjectStart, string>> = {
  music: '曲を登録して解析すると、波形の上で区切りを置いて Shot にできます。',
  narration: 'ナレーションの原稿を書いて声にすると、その切れ目で Shot にできます。曲は後から足せます。',
  none: '曲を登録する・曲を作る・ナレーションから始める、のどれからでも始められます。',
}

const NARRATION_CUTS_GUIDANCE = '置いたナレーションの切れ目で Shot にできます。曲は後から足せます。'

export const StoryboardNoTrack = () => {
  const workbench = useWorkbench()
  const { steps } = useWorkflow()
  const start = projectKindRule(workbench.project.kind).startsFrom
  // 声を作って置いた行（ナレーションの段の済んだ数）。曲が無いときは、その切れ目で区切れる。
  const placedLines = steps.find((step) => step.id === 'narration')?.progress?.done ?? 0
  const narrationCuts = placedLines > 0
  const primary: ProjectStart | null = narrationCuts ? null : start === 'none' ? null : start

  return (
    <PanelEmpty title="楽曲が登録されていません" hint={narrationCuts ? NARRATION_CUTS_GUIDANCE : GUIDANCE[start]}>
      {narrationCuts && (
        <Button
          tone="primary"
          size="sm"
          onClick={() => {
            workbench.openCutter('cut')
          }}
        >
          ナレーションの切れ目で Shot にする
        </Button>
      )}
      <AddTrackButton tone={primary === 'music' ? 'primary' : 'secondary'} />
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          tone="secondary"
          size="sm"
          onClick={() => {
            workbench.openDialog('make-music')
          }}
        >
          曲を作る…
        </Button>
        <Button
          tone={primary === 'narration' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => {
            workbench.focusPanel('narration')
          }}
        >
          曲なしで始める（ナレーションから）
        </Button>
      </div>
    </PanelEmpty>
  )
}
