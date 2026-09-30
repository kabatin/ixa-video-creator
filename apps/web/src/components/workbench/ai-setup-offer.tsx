'use client'

import { useEffect, useMemo } from 'react'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import type { AiSettingsApi } from '@/lib/ai-settings-api'
import { shouldOfferAiSetup } from '@/lib/ai-setup'

/** 勧めたことを覚えるキー。制作データではないので `localStorage`（この画面だけの覚え）。 */
const OFFERED_KEY = 'ixa:ai-setup-offered:v1'

type OfferStorage = Pick<Storage, 'getItem' | 'setItem'>

/** `localStorage` に触るだけで例外が出る環境がある（`preferences.ts` と同じく包む）。 */
const defaultStorage = (): OfferStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/**
 * 初めてワークベンチを開いたときに「使う AI」を 1 度だけ勧める（ADR-0032）。何も描かない。
 * **選ばずに閉じても次からは出さない**（開くたびに出ると作業の邪魔。メニュー「使う AI…」から開ける）。
 * 設定を読めなければ何もしない（勧めないだけで、作業は止めない）。
 */
export const AiSetupOffer = ({
  api,
  storage,
}: {
  readonly api?: Pick<AiSettingsApi, 'getAiSettings'>
  readonly storage?: OfferStorage
}) => {
  const workbench = useWorkbench()
  const client = useMemo(() => api ?? createApiClient(), [api])
  const openDialog = workbench.openDialog

  useEffect(() => {
    const store = storage ?? defaultStorage()
    let alive = true
    client
      .getAiSettings()
      .then((state) => {
        const offered = (store?.getItem(OFFERED_KEY) ?? null) !== null
        if (!alive || !shouldOfferAiSetup(state.source, offered)) return
        store?.setItem(OFFERED_KEY, new Date().toISOString())
        openDialog('ai-setup')
      })
      .catch(() => {
        // 勧めないだけ。「使う AI…」はメニューから開ける。
      })
    return () => {
      alive = false
    }
  }, [client, storage, openDialog])

  return null
}
