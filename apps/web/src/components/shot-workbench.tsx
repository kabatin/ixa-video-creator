'use client'

import type { Location, LocationId, Shot, ShotStatus, Take, TakeId } from '@ixa/domain'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { ErrorPanel } from '@/components/error-panel'
import { GeneratePanel } from '@/components/generate-panel'
import { ShotLocationEditor, type LocationSaveFeedback } from '@/components/shot-location-editor'
import { ShotSummary } from '@/components/shot-summary'
import { TakeGrid } from '@/components/take-grid'
import { ReviewPanel } from '@/components/review-panel'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { GenerateTakesBody, type WireGenerateResult } from '@/lib/api-schemas'
import { startPolling, type PollStopReason } from '@/lib/poller'
import { useProjectEvents } from '@/lib/use-project-events'
import { LiveStatusBadge } from '@/components/live-status-badge'
import { isGeneratingStatus } from '@/lib/shot-display'
import { describeLocation } from '@/lib/shot-location'

export type ShotWorkbenchProps = {
  readonly shot: Shot
  readonly initialTakes: readonly Take[]
  /** 空配列は「未登録」。取得自体に失敗したときは `locationsError` で区別する。 */
  readonly locations: readonly Location[]
  readonly locationsError?: string
}

const TIMEOUT_NOTICE =
  '生成の監視を打ち切りました（上限 5 分）。まだ処理中の可能性があります。再読み込みしてください。'

const LOCATION_SAVED = 'ロケーションを保存しました。'

/**
 * Shot 詳細の中核。生成トリガ・Take のポーリング・採用をまとめて持つ。
 * ポーリングは `polling` が真の間だけ動き、アンマウント時に必ず停止する。
 */
export const ShotWorkbench = ({
  shot,
  initialTakes,
  locations,
  locationsError,
}: ShotWorkbenchProps) => {
  const router = useRouter()
  const [takes, setTakes] = useState<readonly Take[]>(initialTakes)

  const [status, setStatus] = useState<ShotStatus>(shot.status)
  const [selectedTakeId, setSelectedTakeId] = useState<TakeId | null>(shot.selectedTakeId)
  /** レビューは採用中の Take に対して行う。未選択なら出さない。 */
  const selectedTake = takes.find((take) => take.id === selectedTakeId)
  const [polling, setPolling] = useState(isGeneratingStatus(shot.status))
  // 生成完了の判定材料。API にジョブ状態の参照が無いため Take 本数で見る。
  const [expectedTakes, setExpectedTakes] = useState(
    initialTakes.length + (isGeneratingStatus(shot.status) ? 1 : 0),
  )
  const [lastResult, setLastResult] = useState<WireGenerateResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // ロケーションは生成・採用とは別系統の操作なので、結果も専用の欄に出す。
  const [locationId, setLocationId] = useState<LocationId | null>(shot.locationId)
  const [locationSaving, setLocationSaving] = useState(false)
  const [locationFeedback, setLocationFeedback] = useState<LocationSaveFeedback | null>(null)

  /**
   * Take と Shot の状態を同時に読み直す。
   *
   * Take だけを見ていると、生成が終わって status が review に戻っても
   * 画面の状態バッジが「生成中」のまま残る（実機で確認した）。
   * 採用中の Take も worker 側で変わりうるので併せて反映する。
   */
  const refreshTakes = useCallback(async (): Promise<readonly Take[]> => {
    const client = createApiClient()
    const [next, latest] = await Promise.all([client.listTakes(shot.id), client.getShot(shot.id)])
    setTakes(next)
    setStatus(latest.status)
    setSelectedTakeId(latest.selectedTakeId)
    return next
  }, [shot.id])

  /**
   * この Shot の出来事が来たら即座に引き直す（PHASE 5.8b）。
   * ポーリングは繋がっていない間の保険として残す。
   */
  const live = useProjectEvents({
    projectId: shot.projectId,
    baseUrl: resolveApiBaseUrl(),
    onEvent: (event) => {
      if (event.shotId !== shot.id) return
      void refreshTakes().catch((cause: unknown) => {
        setError(`Take を取得できませんでした: ${describeError(cause)}`)
      })
    },
  })

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

  /**
   * ロケーションの付け替え。更新経路は `PATCH /shots/{id}` ひとつに揃える（ADR-0015）。
   * 参照画像は生成時に解決されるため、保存後に Take を取り直す必要は無い。
   */
  const saveLocation = async (next: LocationId | null): Promise<void> => {
    setLocationSaving(true)
    setLocationFeedback(null)
    try {
      const updated = await createApiClient().updateShot(shot.id, { locationId: next })
      setLocationId(updated.locationId)
      setLocationFeedback({ tone: 'success', message: LOCATION_SAVED })
      // Shot 一覧など他の画面の表示も古くなるため、サーバ側の再取得を促す。
      router.refresh()
    } catch (cause) {
      setLocationFeedback({
        tone: 'error',
        message: `ロケーションを保存できませんでした: ${describeError(cause)}`,
      })
    } finally {
      setLocationSaving(false)
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
      <ShotSummary
        shot={shot}
        status={status}
        selectedTakeId={selectedTakeId}
        locationLabel={describeLocation(locationId, locations)}
      />

      <ShotLocationEditor
        locations={locations}
        loadError={locationsError}
        locationId={locationId}
        saving={locationSaving}
        disabled={busy || polling}
        feedback={locationFeedback}
        onSave={(next) => {
          void saveLocation(next)
        }}
      />

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
        <p role="status" className="rounded-md bg-warn/10 p-4 text-sm text-warn">
          {notice}
        </p>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-text">Take 比較</h2>
          <LiveStatusBadge
            state={live.state}
            lastEventAt={live.lastEventAt}
            attempt={live.attempt}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              router.refresh()
              void refreshTakes().catch((cause: unknown) => {
                setError(`Take を取得できませんでした: ${describeError(cause)}`)
              })
            }}
            className="rounded-md border border-line-strong px-3 py-1.5 text-sm text-text hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-muted"
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

      {selectedTake !== undefined && (
        <ReviewPanel
          takeId={selectedTake.id}
          humanVerdict={selectedTake.humanVerdict}
          disabled={busy}
          onVerdictSaved={(updated) => {
            // 判定は Take の行を書き換えるので、一覧の該当 Take だけ差し替える。
            setTakes((current) => current.map((take) => (take.id === updated.id ? updated : take)))
          }}
        />
      )}
    </div>
  )
}
