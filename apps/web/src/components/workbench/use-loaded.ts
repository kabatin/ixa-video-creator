'use client'

import { useEffect, useRef, useState } from 'react'
import { describeError } from '@/lib/api-error'

/**
 * パネル・ダイアログが開いたときに自分で読む材料（UI-WORKBENCH §7.3）。
 * **「読み込み中」「読めた」「読めなかった」を畳まない**（L-015）。
 */
export type Loaded<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly value: T }
  | { readonly state: 'error'; readonly message: string }

/** 何を読むかは `key` で決める。`run` は描画ごとに作り直されるので、最新を控えて呼ぶ。 */
export const useLoaded = <T>(label: string, run: () => Promise<T>, key: string): Loaded<T> => {
  const [state, setState] = useState<Loaded<T>>({ state: 'loading' })
  const runRef = useRef(run)
  runRef.current = run

  useEffect(() => {
    let cancelled = false
    setState({ state: 'loading' })
    runRef
      .current()
      .then((value) => {
        if (!cancelled) setState({ state: 'ready', value })
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setState({ state: 'error', message: `${label}を読み込めませんでした: ${describeError(cause)}` })
        }
      })
    return () => {
      cancelled = true
    }
  }, [label, key])

  return state
}
