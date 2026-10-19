'use client'

import { createContext, useContext, useSyncExternalStore } from 'react'
import type { ConsoleEntry, ConsoleLog } from '@/lib/console-log'

/**
 * コンソールの記録の置き場（`lib/console-log.ts`）。ワークベンチに 1 つ。
 * **共有状態（`WorkbenchContext`）には入れない。** 記録が増えるたびに全パネルを描き直さないため、
 * 読むのはコンソールのタブだけで、書く側は `push` を呼ぶだけ。
 */
export const ConsoleLogContext = createContext<ConsoleLog | null>(null)
ConsoleLogContext.displayName = 'ConsoleLogContext'

/** 書く口。ワークベンチの外（単独の部品のテスト）では null。 */
export const useConsoleLog = (): ConsoleLog | null => useContext(ConsoleLogContext)

const NONE: readonly ConsoleEntry[] = []
const noSubscribe = (): (() => void) => () => undefined

/** 記録を新しい順に読む。変わったときだけ描き直す。 */
export const useConsoleEntries = (): readonly ConsoleEntry[] => {
  const log = useConsoleLog()
  return useSyncExternalStore(
    log?.subscribe ?? noSubscribe,
    log?.getSnapshot ?? (() => NONE),
    () => NONE,
  )
}
