'use client'

import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/components/workbench/workbench-context'

/**
 * 素材をインポート（ダイアログ）。**取り込む先を選ぶ入口。**
 *
 * 画像や音は「何の素材として使うか」が決まって初めて登録できる（識別画像・Look・
 * ロケーション・ブランド資産・楽曲で登録先が違う）。行き先の無いアップロード口は作らず、
 * 既存の登録画面を開く（判断メモ 7-M5）。
 */
export const ImportDialogBody = () => {
  const workbench = useWorkbench()
  const go = (action: () => void) => () => {
    workbench.closeDialog()
    action()
  }
  const entries = [
    {
      label: '楽曲（音源）',
      hint: '音源をアップロードして楽曲として登録し、拍とセクションを解析します。',
      run: () => {
        workbench.openDialog('music')
      },
    },
    {
      label: 'ロケーションの参照画像',
      hint: 'ロケーションを作り、参照画像を登録します。Shot の生成入力になります。',
      run: go(() => {
        workbench.openAsset({ kind: 'locations' })
      }),
    },
    {
      label: 'ブランド資産',
      hint: 'ロゴや指定色など。レビューで照合に使います。',
      run: go(() => {
        workbench.openAsset({ kind: 'brand-assets' })
      }),
    },
    {
      label: 'キャラクターの識別画像・Look',
      hint: '左の素材ツリーでキャラクターを選ぶと、そのタブで登録できます。',
      run: go(() => {
        workbench.focusPanel('assets')
      }),
    },
  ] as const

  return (
    <ul className="space-y-2">
      {entries.map((entry) => (
        <li key={entry.label} className="flex items-center gap-3 rounded-md border border-line p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text">{entry.label}</p>
            <p className="text-xs text-muted">{entry.hint}</p>
          </div>
          <Button size="sm" onClick={entry.run}>
            開く
          </Button>
        </li>
      ))}
    </ul>
  )
}
