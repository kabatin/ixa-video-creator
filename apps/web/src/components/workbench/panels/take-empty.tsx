'use client'

import { lacksStoryboard, type Shot } from '@ixa/domain'
import { Button } from '@/components/ui/button'
import { PanelEmpty } from '@/components/workbench/panels/panel-frame'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { startFrameKnownFor } from '@/lib/shot-posters'

/**
 * Take がまだ無い Shot の Take 比較（制作者 2026-10-02「作り方の案内やインスペクターを開くボタンなどがないので迷う」）。
 *
 * 「生成を実行してください」とだけ出て、どこで作るのか分からなかった。作り方の順番と、その欄を開くボタンを出す。
 * 説明も最初のフレームも無ければ先に絵コンテへ誘う（判定は domain の `lacksStoryboard`。作る欄の確認と同じ）。
 */
export const TakeEmpty = ({ shot }: { readonly shot: Shot }) => {
  const workbench = useWorkbench()
  // インスペクターが別のもの（人物など）を見ていることがある。この Shot を見せてから開く。
  const openInspector = (tab: 'generate' | 'settings'): void => {
    workbench.selectShot(shot.id)
    workbench.openInspector(tab)
  }

  if ((workbench.activeGenerations.get(shot.id) ?? []).length > 0) {
    return (
      <PanelEmpty title="Take を作っています" hint="できあがるとここに並びます。">
        <Button
          size="sm"
          onClick={() => {
            openInspector('generate')
          }}
        >
          進み具合を見る
        </Button>
      </PanelEmpty>
    )
  }

  // 最初のフレームが分からない（まだ引けていない）ときは、有るものとして扱う（L-021）。
  const unguided = lacksStoryboard({
    description: shot.description,
    hasStartFrame: startFrameKnownFor(workbench.posters, shot.id) !== false,
  })

  return (
    <PanelEmpty title={`${shot.code} の Take はまだありません`}>
      <ol aria-label="Take の作り方" className="space-y-1 text-left text-sm text-muted">
        <li>① この Shot に説明か最初のフレーム（絵コンテ）を入れる{unguided ? '' : ' ✓'}</li>
        <li>② インスペクターの「Take を作る」で、モデルを選んで作る</li>
        <li>③ できた Take をここで見比べて採用する</li>
      </ol>
      {unguided && (
        <p className="max-w-md text-sm text-warn">
          この Shot には説明も最初のフレームもありません。このまま作ると作品と関係ない映像になりやすいので、先に絵コンテを入れてください。
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {unguided && (
          <>
            <Button
              size="sm"
              tone="primary"
              onClick={() => {
                openInspector('settings')
              }}
            >
              説明を書く
            </Button>
            <Button
              size="sm"
              onClick={() => {
                workbench.focusPanel('draft')
              }}
            >
              絵コンテの案を開く
            </Button>
          </>
        )}
        <Button
          size="sm"
          tone={unguided ? 'secondary' : 'primary'}
          onClick={() => {
            openInspector('generate')
          }}
        >
          インスペクターを表示
        </Button>
      </div>
    </PanelEmpty>
  )
}
