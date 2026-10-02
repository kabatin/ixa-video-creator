'use client'

import { lacksStoryboard, type ProjectId, type Shot, type ShotId } from '@ixa/domain'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { FieldRow, INPUT_CLASS } from '@/components/workbench/ui/section'
import { Button } from '@/components/ui/button'
import { createApiClient, type ApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { GenerateTakesBody, type WireGenerateResult } from '@/lib/api-schemas'
import { buildCostMeterView, type CostMeterView } from '@/lib/cost-meter'
import { formatClock } from '@/lib/format-time'
import {
  AUTO_MODEL,
  TAKE_COUNT_OPTIONS,
  generateBlocker,
  modelOptionsFrom,
} from '@/lib/generation-options'
import type { WireVideoModel } from '@/lib/models-api'
import { POLL_TIMEOUT_MS, startAsyncPolling } from '@/lib/poller'
import { isGeneratingStatus } from '@/lib/shot-display'
import { offerReviewAfterGeneration } from '@/lib/offer-review'
import { useNow } from '@/components/workbench/use-active-generations'
import { useCancelGeneration } from '@/components/workbench/use-cancel-generation'
import { useOptionalContextMenuHost } from '@/components/workbench/ui/context-menu'
import { startFrameKnownFor } from '@/lib/shot-posters'
import {
  BACK_TO_STORYBOARD_LABEL,
  UNGUIDED_TAKE_CONFIRM,
  UNGUIDED_TAKE_LABEL,
} from '@/lib/unguided-take'
import { CANCEL_GENERATION_LABEL } from '@/lib/context-menus'
import { describeActiveGeneration } from '@/lib/generation-progress'

/**
 * 生成（UI-WORKBENCH-2 §5.2）。**このパネルの主ボタン**はここ。
 * 押す前に予算の残りを見せる（額だけを出さない規則はそのまま: 出どころを添える）。
 * 1 本ずつの見積は API が出さないので出さない（出したふりをしない）。
 *
 * 投入したあとは**経過時間と終わった本数を出す**（F1）。
 * 解析は経過時間を出し（`analysis-starter`）、書き出しは経過と % を出す
 * （`render-job-list`）のに、生成だけが 1 分でも 5 分でも同じ 1 行だった。
 * **割合は誰も報告していないので進捗バーは出さない。** 偽の進捗より、
 * 「何本中何本」と「経過」のほうが待てる材料になる。
 *
 * 累計費用は投入と Take の到着で取り直す（F3b）。mount 時 1 回だけだと、
 * 何本回しても「使った額 $0.00」のまま固まる。
 */

/** この画面が使う口だけ。**テストから差し替えるための注入口。** */
export type ShotGenerateApi = Pick<
  ApiClient,
  'generateTakes' | 'listTakes' | 'getCostMeter' | 'requestReview' | 'listModels' | 'cancelGenerations'
>

/** 上限まで待って諦めるまでの分数。数字を書き写さない（lessons L-016）。 */
const TIMEOUT_MINUTES = String(Math.round(POLL_TIMEOUT_MS / 60_000))

/**
 * 投入した生成の見守り。**この画面から投入したときだけ持てる。**
 *
 * API に「いつ始まった生成か」を問う口が無いため、開き直した生成の経過は分からない
 * （`analysis-starter` が開き直しで idle に戻すのと同じ理由）。
 * **誰の生成かを一緒に持つ。** Shot を替えた直後に前の Shot の見守りを使うと、
 * 別の Shot の経過を出してしまう（`use-shot-takes` と同じ用心）。
 */
type GenerateWatch = {
  readonly shotId: ShotId
  readonly startedAtMs: number
  /** 投入したジョブの数。 */
  readonly requested: number
  /** 投入直前の Take の本数。**null は「数えられなかった」**で 0 本ではない（L-021）。 */
  readonly baselineTakeCount: number | null
}

type GenerateProgress = {
  readonly elapsedMs: number
  /** 終わった本数。**null は「数えられない」**で 0 本ではない。 */
  readonly done: number | null
  /** 追跡が止まった理由。**「生成が終わった」と混ぜない**（lessons L-015）。 */
  readonly stopped: string | null
}

export const ShotGenerateSection = ({
  shot,
  api,
  hasStartFrame = false,
}: {
  readonly shot: Shot
  readonly api?: ShotGenerateApi
  /** 最初のフレームが付いているか（ADR-0025）。要るモデルで無ければ押す前に理由を出す。 */
  readonly hasStartFrame?: boolean
}) => {
  const workbench = useWorkbench()
  const client = useMemo<ShotGenerateApi>(() => api ?? createApiClient(), [api])
  const modelId = useId()
  const countId = useId()
  const [model, setModel] = useState(AUTO_MODEL)
  /** 登録されているモデル。**null は「読めていない」**（AUTO だけ選べる）。 */
  const [models, setModels] = useState<readonly WireVideoModel[] | null>(null)
  const [modelsError, setModelsError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    client
      .listModels()
      .then((loaded) => {
        if (alive) setModels(loaded)
      })
      .catch((cause: unknown) => {
        if (alive) setModelsError(describeForPerson(cause))
      })
    return () => {
      alive = false
    }
  }, [client])
  const blocker = generateBlocker(
    (models ?? []).find((candidate) => candidate.id === model) ?? null,
    hasStartFrame,
  )
  const [count, setCount] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<WireGenerateResult | null>(null)
  const [watch, setWatch] = useState<GenerateWatch | null>(null)
  /** この画面から投入した回数。費用を取り直す合図に使う。 */
  const [submissions, setSubmissions] = useState(0)

  const generating = isGeneratingStatus(shot.status)
  const cancelGeneration = useCancelGeneration(client).ask
  const host = useOptionalContextMenuHost()
  /**
   * 説明も最初のフレームも無いか（domain の `lacksStoryboard`）。最初のフレームが**分からない**ときは
   * 「ある」に倒す（読み込み前に確かめを出して、作業を止めない）。
   */
  const unguided = lacksStoryboard({
    description: shot.description,
    hasStartFrame: hasStartFrame || startFrameKnownFor(workbench.posters, shot.id) !== false,
  })
  // 前の Shot の見守りは「持っていない」として扱う。
  const watched = watch !== null && watch.shotId === shot.id ? watch : null
  const progress = useGenerateProgress(client, watched, generating)
  // サーバが知っている、この Shot で動いている生成（どのモデルで・いつから）。経過は毎秒刻む。
  const activity = workbench.activeGenerations.get(shot.id)?.[0] ?? null
  const now = useNow(generating && activity !== null)

  /**
   * 費用を取り直す合図。投入（自分が使った）と Take の到着（実際に金が動いた）と
   * サーバの読み直しで進む。**mount 時 1 回では固まる。**
   */
  const costEpoch = `${String(workbench.serverEpoch)}:${String(workbench.live.newTakeCount)}:${String(submissions)}`

  /**
   * この画面から投入した生成が終わったら、**自動レビューをするか聞く**（1 回の投入につき 1 回）。
   * 一括生成と同じ口（`offer-review.ts`）。Take ができていなければ聞かない。
   */
  const offeredForRef = useRef<number | null>(null)
  const { notify } = workbench
  useEffect(() => {
    if (watched === null || generating) return
    if (offeredForRef.current === watched.startedAtMs) return
    offeredForRef.current = watched.startedAtMs
    void offerReviewAfterGeneration({
      shotIds: [watched.shotId],
      api: client,
      confirm: (message) => window.confirm(message),
      notify,
    })
  }, [watched, generating, client, notify])
  const cost = useCost(client, workbench.projectId, costEpoch)

  const generate = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const body = GenerateTakesBody.parse({ model, count: Number(count) })
      /**
       * 投入前の本数を控える。**取れなくても生成は止めない。**
       * 数えられなくなるのは「何本終わったか」だけで、生成そのものは進む。
       */
      const baselineTakeCount = await countTakes(client, shot.id)
      const started = await client.generateTakes(shot.id, body)
      setResult(started)
      setWatch({
        shotId: shot.id,
        startedAtMs: Date.now(),
        requested: started.jobIds.length,
        baselineTakeCount,
      })
      setSubmissions((current) => current + 1)
      // サーバと同じ遷移を先回りして映す。完了は SSE が届ける。
      // 最長で作って伸ばすときは、サーバが Shot を「Take を尺に合わせる」にしている。
      workbench.replaceShots([
        { ...shot, status: 'generating', ...(started.stretchedToFit ? { timing: 'fit' as const } : {}) },
      ])
    } catch (cause) {
      setError(`生成を開始できませんでした: ${describeForPerson(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  const requestGenerate = (): void => {
    if (!unguided || host === null) {
      void generate()
      return
    }
    host.perform({
      kind: 'item',
      id: 'generate-unguided',
      label: UNGUIDED_TAKE_LABEL,
      disabledReason: null,
      confirm: UNGUIDED_TAKE_CONFIRM,
      keepLabel: BACK_TO_STORYBOARD_LABEL,
      run: generate,
    })
  }

  return (
    <div className="space-y-2">
      <FieldRow label="モデル" htmlFor={modelId}>
        <select
          id={modelId}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className={INPUT_CLASS}
        >
          {modelOptionsFrom(models).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow label="本数" htmlFor={countId}>
        <select
          id={countId}
          value={count}
          onChange={(e) => setCount(e.target.value)}
          className={INPUT_CLASS}
        >
          {TAKE_COUNT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FieldRow>
      <p className="text-xs text-muted" title={cost.view?.provenance}>
        {costLabel(cost)}
      </p>
      {modelsError !== null && (
        <p className="text-xs text-warn">{`モデルの一覧を読めませんでした（AUTO だけ選べます）: ${modelsError}`}</p>
      )}
      {blocker !== null && <p className="text-xs text-warn">{blocker}</p>}
      <Button
        tone="primary"
        disabled={busy || generating || blocker !== null}
        onClick={requestGenerate}
      >
        {generating ? '生成中…' : busy ? '送っています…' : 'Take を生成'}
      </Button>
      {generating && (
        <p role="status" className="text-xs text-text">
          {generatingLine(watched, progress, activity === null ? null : describeActiveGeneration(activity, now).long)}
        </p>
      )}
      {generating && cancelGeneration !== null && (
        <Button
          size="sm"
          onClick={() => {
            cancelGeneration(shot)
          }}
        >
          {CANCEL_GENERATION_LABEL}
        </Button>
      )}
      {result !== null && (
        <p className="text-xs text-muted">
          {`${result.resolvedModel} で ${String(result.jobIds.length)} 件を投入しました。`}
          {result.duplicateOfTakeId !== null && (
            <span className="text-warn"> 同じ仕様の Take が既にあります。</span>
          )}
          {result.stretchedToFit && (
            <span>
              {' '}
              Shot がこのモデルの最長より長いので、最長で作って少しゆっくり再生して合わせます（「Take を尺に合わせる」にしました）。
            </span>
          )}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * 生成中の 1 行。**1 分でも 5 分でも同じ文字列にしない。**
 * 分からないもの（開き直した生成の経過・数えられない本数）は、分からないと書く。
 */
const generatingLine = (
  watch: GenerateWatch | null,
  progress: GenerateProgress | null,
  /** サーバの記録から組んだ 1 文（どのモデルで・経過・目安）。読めていなければ null。 */
  activity: string | null,
): string => {
  const tail = '終わった Take から Take 比較に並びます。'
  if (activity !== null) {
    // 経過はサーバの記録で言う（開き直しても出る）。この画面から投入していれば、何本終わったかも添える。
    if (watch === null || progress === null) return `${activity}${tail}`
    const counted =
      progress.done === null ? '終わった本数は数えられません' : `${String(watch.requested)} 本中 ${String(progress.done)} 本`
    const stopped = progress.stopped === null ? '' : ` ${progress.stopped}`
    return `${activity}（${counted}）${tail}${stopped}`
  }
  if (watch === null || progress === null) {
    return `生成中です（この画面から投入した生成ではないため、経過時間と本数は分かりません）。${tail}`
  }
  const counted =
    progress.done === null
      ? '終わった本数は数えられません'
      : `${String(watch.requested)} 本中 ${String(progress.done)} 本`
  const stopped = progress.stopped === null ? '' : ` ${progress.stopped}`
  return `生成中です（経過 ${formatClock(progress.elapsedMs / 1_000)} / ${counted}）。${tail}${stopped}`
}

/** 投入直前の Take の本数。**数えられなければ null。** 0 本に畳まない（L-021）。 */
const countTakes = async (api: ShotGenerateApi, shotId: ShotId): Promise<number | null> => {
  try {
    return (await api.listTakes(shotId)).length
  } catch {
    // 黙って 0 にしない。数えられないことは生成中の行に出る。
    return null
  }
}

/**
 * 経過と、終わった本数を追う。
 *
 * 終わりの判定は **Shot の状態（SSE で届く）** が持つ。ここは経過を刻み、
 * Take を数えるだけで、「終わったかどうか」を自分で決めない。
 * ポーリングの止め方は `lib/poller.ts` が持つ（上限まで待った / 引けなくなったを分ける）。
 */
const useGenerateProgress = (
  api: ShotGenerateApi,
  watch: GenerateWatch | null,
  generating: boolean,
): GenerateProgress | null => {
  const [progress, setProgress] = useState<GenerateProgress | null>(null)

  useEffect(() => {
    if (watch === null || !generating) {
      setProgress(null)
      return undefined
    }
    const baseline = watch.baselineTakeCount
    setProgress({ elapsedMs: 0, done: baseline === null ? null : 0, stopped: null })

    const handle = startAsyncPolling<number | null>({
      // 数えられないと分かっているときは叩かない。経過だけを刻む。
      probe: async () =>
        baseline === null
          ? { running: true, value: null }
          : { running: true, value: (await api.listTakes(watch.shotId)).length },
      onProbe: ({ value }) => {
        setProgress({
          elapsedMs: Date.now() - watch.startedAtMs,
          done: value === null || baseline === null ? null : Math.max(value - baseline, 0),
          stopped: null,
        })
      },
      onTimeout: () => {
        setProgress((current) =>
          current === null
            ? current
            : {
                ...current,
                stopped: `${TIMEOUT_MINUTES} 分を過ぎたため経過の更新を止めました。生成は続いているかもしれません。`,
              },
        )
      },
      onFailed: (caught) => {
        setProgress((current) =>
          current === null
            ? current
            : {
                ...current,
                stopped: `終わった本数を数えられなくなりました: ${describeForPerson(caught)}`,
              },
        )
      },
    })
    return () => {
      handle.stop()
    }
  }, [api, watch, generating])

  return progress
}

/** 費用の 1 行。**読めていないのか、読めなかったのかを混ぜない**（lessons L-015）。 */
type CostLine = { readonly view: CostMeterView | null; readonly error: string | null }

const costLabel = ({ view, error }: CostLine): string => {
  if (view === null) {
    return error === null ? '予算を読み込んでいます…' : `予算を読めませんでした: ${error}`
  }
  const stale = error === null ? '' : `（取り直せませんでした: ${error}）`
  return `予算 ${view.budgetLabel} / 使った額 ${view.measuredLabel}（${view.provenance}）${stale}`
}

/**
 * 累計費用。**`epoch` が変わるたびに取り直す。**
 * 以前は `[api, projectId]` だけを見ていたため、生成を何本回しても
 * 「予算 $300.00 / 使った額 $0.00」のまま再読み込みまで固まっていた。
 */
const useCost = (api: ShotGenerateApi, projectId: ProjectId, epoch: string): CostLine => {
  const [line, setLine] = useState<CostLine>({ view: null, error: null })

  useEffect(() => {
    let cancelled = false
    api
      .getCostMeter(projectId)
      .then((meter) => {
        if (!cancelled) setLine({ view: buildCostMeterView(meter), error: null })
      })
      .catch((cause: unknown) => {
        // 握り潰さない。読めなかったことを画面に出す（規約 5 / lessons L-015）。
        if (!cancelled) {
          setLine((current) => ({ view: current.view, error: describeForPerson(cause) }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [api, projectId, epoch])

  return line
}
