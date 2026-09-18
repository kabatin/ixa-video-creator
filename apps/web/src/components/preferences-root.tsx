'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  DEFAULT_PREFERENCES,
  applyPreferences,
  readPreferences,
  writePreferences,
  type Preferences,
} from '@/lib/preferences'

/**
 * 環境設定の持ち主（PHASE 7.1）。全画面で 1 つ。
 *
 * **最初の描画は既定で固定する。** 保存を初期値で読むとサーバと食い違って
 * ハイドレーションが崩れる（lessons L-019）。描画のあとに読み、`<html>` へ反映する。
 * 部品は環境設定を直接読まない。見た目は `<html>` の属性と根元の文字の大きさだけで変わる。
 */
type PreferencesContextValue = {
  readonly preferences: Preferences
  /** 新しい値を丸ごと渡す。保存と `<html>` への反映はここが行う。 */
  readonly setPreferences: (next: Preferences) => void
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

export const usePreferences = (): PreferencesContextValue => {
  const value = useContext(PreferencesContext)
  if (value === null) throw new Error('usePreferences は PreferencesRoot の内側で使うこと')
  return value
}

export const PreferencesRoot = ({ children }: { readonly children: ReactNode }) => {
  const [preferences, setState] = useState<Preferences>(DEFAULT_PREFERENCES)

  useEffect(() => {
    const stored = readPreferences()
    setState(stored)
    applyPreferences(stored)
  }, [])

  const setPreferences = useCallback((next: Preferences): void => {
    setState(next)
    applyPreferences(next)
    writePreferences(next)
  }, [])

  const value = useMemo(() => ({ preferences, setPreferences }), [preferences, setPreferences])

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}
