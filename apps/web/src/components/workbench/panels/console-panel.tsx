'use client'

import { Button } from '@/components/ui/button'
import { useConsoleEntries, useConsoleLog } from '@/components/workbench/console-log-context'
import { PanelEmpty, PanelFrame } from '@/components/workbench/panels/panel-frame'
import { CONSOLE_LEVEL_LABELS, formatConsoleClock, type ConsoleLevel } from '@/lib/console-log'

const LEVEL_CLASSES: Readonly<Record<ConsoleLevel, string>> = Object.freeze({
  info: 'text-muted',
  warn: 'text-warn',
  error: 'text-danger',
})

/**
 * コンソール（下の区画）。この画面を開いてから起きた出来事を新しい順に並べる。
 * 上の 1 行の知らせは次の知らせで消えるので、見逃したものをここで読み返す。
 * **ブラウザのメモリだけ**に置く（閉じれば消える。上限は `CONSOLE_LIMIT`）。
 */
export const ConsolePanel = () => {
  const log = useConsoleLog()
  const entries = useConsoleEntries()
  return (
    <PanelFrame
      toolbar={
        <>
          <span className="text-muted">{`${String(entries.length)} 件（新しい順）`}</span>
          <span className="ml-auto">
            <Button
              size="sm"
              disabled={entries.length === 0}
              onClick={() => {
                log?.clear()
              }}
            >
              消去
            </Button>
          </span>
        </>
      }
    >
      {entries.length === 0 ? (
        <PanelEmpty
          title="まだ出来事はありません"
          hint="操作の結果・知らせ・生成の完了と失敗が、起きた順にここへ残ります。"
        />
      ) : (
        <ol className="font-mono text-xs" aria-label="出来事">
          {entries.map((entry) => (
            <li key={entry.id} className="flex gap-3 border-b border-line py-1 last:border-b-0">
              <time className="shrink-0 tabular-nums text-muted">{formatConsoleClock(entry.at)}</time>
              <span className={`w-12 shrink-0 ${LEVEL_CLASSES[entry.level]}`}>
                {CONSOLE_LEVEL_LABELS[entry.level]}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-text">{entry.text}</span>
            </li>
          ))}
        </ol>
      )}
    </PanelFrame>
  )
}
