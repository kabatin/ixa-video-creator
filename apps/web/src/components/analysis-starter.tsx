'use client'

import type { MusicTrack } from '@ixa/domain'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'

/**
 * 未解析の楽曲について、音楽解析をキューへ積む操作。
 *
 * 解析は worker が数十秒かけて行う。**ここでは完了を待たない。**
 * 受け付けたことだけを伝え、結果は利用者が画面を更新して確かめる。
 */

export type AnalysisStarterProps = {
  readonly track: MusicTrack
}

export const AnalysisStarter = ({ track }: AnalysisStarterProps) => {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'sending' | 'queued'>('idle')
  const [error, setError] = useState<string | null>(null)

  const start = async (): Promise<void> => {
    setState('sending')
    setError(null)
    try {
      await createApiClient().requestAnalysis(track.id)
      setState('queued')
    } catch (caught) {
      setError(describeError(caught))
      setState('idle')
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">この楽曲はまだ解析されていません</h2>
      <p className="mt-1 text-sm text-slate-600">
        Shot を割るにはビートとセクションが必要です。解析を実行してください。
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={state === 'sending'}
          onClick={() => {
            void start()
          }}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {state === 'sending' ? '送信中…' : '解析を実行'}
        </button>

        {state === 'queued' && (
          <button
            type="button"
            onClick={() => {
              router.refresh()
            }}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            結果を確認
          </button>
        )}

        {state === 'queued' && (
          <p role="status" className="text-sm text-slate-700">
            解析を受け付けました。完了まで数十秒かかります。
          </p>
        )}

        {error !== null && (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
