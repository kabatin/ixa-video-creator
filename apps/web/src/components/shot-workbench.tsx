'use client'

import type { Shot, ShotStatus, Take, TakeId } from '@ixa/domain'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { ErrorPanel } from '@/components/error-panel'
import { GeneratePanel } from '@/components/generate-panel'
import { ShotSummary } from '@/components/shot-summary'
import { TakeGrid } from '@/components/take-grid'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { GenerateTakesBody, type WireGenerateResult } from '@/lib/api-schemas'
import { startPolling, type PollStopReason } from '@/lib/poller'
import { isGeneratingStatus } from '@/lib/shot-display'

export type ShotWorkbenchProps = {
  readonly shot: Shot
  readonly initialTakes: readonly Take[]
}

const TIMEOUT_NOTICE =
  '生成の監視を打ち切りました（上限 5 分）。まだ処理中の可能性があります。再読み込みしてください。'

/**
 * Shot 詳細の中核。生成トリガ・Take のポーリング・採用をまとめて持つ。
 * ポーリングは `polling` が真の間だけ動き、アンマウント時に必ず停止する。
 */
export const ShotWorkbench = ({ shot, initialTakes }: ShotWorkbenchProps) => {
  const router = useRouter()
  const [takes, setTakes] = useState<readonly Take[]>(initialTakes)
  const [status, setStatus] = useState<ShotStatus>(shot.status)
  const [selectedTakeId, setSelectedTakeId] = useState<TakeId | null>(shot.selectedTakeId)
  const [polling, setPolling] = useState(isGeneratingStatus(shot.status))
  // 生成完了の判定材料。API にジョブ状態の参照が無いため Take 本数で見る。
  const [expectedTakes, setExpectedTakes] = useState(
    initialTakes.length + (isGeneratingStatus(shot.status) ? 1 : 0),
  )
  const [lastResult, setLastResult] = useState<WireGenerateResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refreshTakes = useCallback(async (): Promise<readonly Take[]> => {
    const next = await createApiClient().listTakes(shot.id)
    setTakes(next)
    return next
  }, [shot.id])

  useEffect(() => {
    if (!polling) return undefined

    const handleStop = (reason: PollStopReason): void => {
      setPolling(false)
      if (reason === 'timeout') setNotice(TIMEOUT_NOTICE)
    }

    const handle = startPolling({
      onTick: () => {
        void refreshTakes()
          .then((next) => {
            if (next.length >= expectedTakes) setPolling(false)
          })
          .catch((cause: unknown) => {
            setError(`Take を取得できませんでした: ${describeError(cause)}`)
            setPolling(false)
          })
      },
      onStop: handleStop,
    })

    // 画面を離れたら必ず止める。止め忘れはリクエストの垂れ流しになる。
    return () => {
      handle.stop()
    }
  }, [polling, expectedTakes, refreshTakes])

  const generate = async (model: string, count: number): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const body = GenerateTakesBody.parse({ model, count })
      const result = await createApiClient().generateTakes(shot.id, body)
      setLastResult(result)
      setExpectedTakes(takes.length + body.count)
      setStatus('generating')
      setPolling(true)
    } catch (cause) {
      setError(`生成を開始できませんでした: ${describeError(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  const select = async (takeId: TakeId): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const updated = await createApiClient().selectTake(shot.id, takeId)
      setSelectedTakeId(updated.selectedTakeId)
      setStatus(updated.status)
    } catch (cause) {
      setError(`Take を採用できませんでした: ${describeError(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <ShotSummary shot={shot} status={status} selectedTakeId={selectedTakeId} />

      <GeneratePanel
        busy={busy || polling}
        generating={polling}
        lastResult={lastResult}
        onGenerate={(model, count) => {
          void generate(model, count)
        }}
      />

      {error !== null && <ErrorPanel title="操作に失敗しました" message={error} />}

      {notice !== null && (
        <p role="status" className="rounded-md bg-amber-50 p-4 text-sm text-amber-900">
          {notice}
        </p>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">Take 比較</h2>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              router.refresh()
              void refreshTakes().catch((cause: unknown) => {
                setError(`Take を取得できませんでした: ${describeError(cause)}`)
              })
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            再読み込み
          </button>
        </div>
        <TakeGrid
          takes={takes}
          selectedTakeId={selectedTakeId}
          busy={busy}
          onSelect={(takeId) => {
            void select(takeId)
          }}
        />
      </section>
    </div>
  )
}
