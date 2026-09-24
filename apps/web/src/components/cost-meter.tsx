'use client'

import type { ProjectId } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { describeForPerson } from '@/lib/api-error'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { buildCostMeterView, type CostTone } from '@/lib/cost-meter'
import { createCostMeterApi, type CostMeterApi, type WireCostMeter } from '@/lib/cost-meter-api'
import { createRequester } from '@/lib/requester'

/**
 * 使った額を、出どころつきで見せる（P63-2）。
 *
 * **額だけを独り歩きさせない。** 本制作の Take 50 件はすべてスタブ Provider で、
 * スタブの単価は 0 である。額だけを出すと「$0 / $300 使用、余裕あり」と読めるが、
 * 実際には実 Provider を一度も回していない。
 * そのため実測が 0 件のときは、バーの隣に必ず「実測 0 件（スタブ N 件）」を出す。
 *
 * 判定と言葉は `lib/cost-meter.ts` が持つ。ここは描くだけで、しきい値を書き写さない。
 */

/** 色は役割の名前で持つ（PHASE 5.9）。素の色名はここに書かない。 */
const BAR_CLASSES: Readonly<Record<CostTone, string>> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
}

const AMOUNT_CLASSES: Readonly<Record<CostTone, string>> = {
  ok: 'text-text',
  warn: 'text-warn',
  danger: 'text-danger',
}

export type CostMeterPanelProps = {
  readonly projectId: ProjectId
  /** サーバで先に読めていれば渡す。**null は「読めていない」**で 0 件ではない。 */
  readonly initialMeter?: WireCostMeter | null
  /** 読めなかった理由。あれば額を出さずにこれを出す。 */
  readonly loadError?: string | null
  /** テストから差し替えるための注入口。 */
  readonly api?: CostMeterApi
}

export const CostMeterPanel = ({
  projectId,
  initialMeter = null,
  loadError = null,
  api,
}: CostMeterPanelProps) => {
  const client = useMemo(
    () => api ?? createCostMeterApi(createRequester(resolveApiBaseUrl())),
    [api],
  )

  const [meter, setMeter] = useState<WireCostMeter | null>(initialMeter)
  const [error, setError] = useState<string | null>(loadError)

  useEffect(() => {
    if (initialMeter !== null || loadError !== null) return
    let cancelled = false

    client
      .getCostMeter(projectId)
      .then((loaded) => {
        if (!cancelled) setMeter(loaded)
      })
      .catch((cause: unknown) => {
        // 握り潰さない。読めなかったことを画面に出す（規約 5 / lessons L-015）。
        // **`describeError` は使わない。** 完全な URL とレスポンス本文が利用者に出る。
        if (!cancelled) setError(describeForPerson(cause))
      })

    return () => {
      cancelled = true
    }
  }, [client, projectId, initialMeter, loadError])

  if (error !== null) {
    return (
      <section className="rounded-lg border border-line bg-surface p-4" aria-label="費用">
        <h2 className="text-sm font-semibold text-text">費用</h2>
        <p role="alert" className="mt-2 text-sm text-danger">
          費用を読めませんでした（{error}）
        </p>
      </section>
    )
  }

  if (meter === null) {
    return (
      <section className="rounded-lg border border-line bg-surface p-4" aria-label="費用">
        <h2 className="text-sm font-semibold text-text">費用</h2>
        <p className="mt-2 text-sm text-muted">読み込み中です</p>
      </section>
    )
  }

  const view = buildCostMeterView(meter)

  return (
    <section className="rounded-lg border border-line bg-surface p-4" aria-label="費用">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">費用</h2>
        <p className="text-xs text-muted">{view.budgetIsSet ? `予算 ${view.budgetLabel}` : view.budgetLabel}</p>
      </div>

      {/*
        額の隣に**必ず Provider の名前を出す。**
        スタブの一覧に載せ忘れた Provider は額 0 のまま実測に数えられる。
        「実測 $0.00」だけでは何も起きていないように見えるが、
        「実測 $0.00（stub-v2 40 件）」なら載せ忘れだとその場で分かる。額では気付けない。
      */}
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${AMOUNT_CLASSES[view.tone]}`}>
        {view.measuredLabel}
      </p>

      {view.ratio !== null && view.ratioLabel !== null ? (
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2"
          role="meter"
          aria-label="予算の使用率"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(view.ratio * 100)}
          aria-valuetext={`予算 ${view.budgetLabel} のうち ${view.ratioLabel}`}
        >
          <div
            className={`h-full ${BAR_CLASSES[view.tone]}`}
            style={{ width: `${(view.ratio * 100).toString()}%` }}
          />
        </div>
      ) : null}

      {/*
        出どころは常に出す。**実測が 0 件のときは読み上げまで届かせる。**
        額が 0 なのと、費用が発生していないのは違う（lessons L-015）。
      */}
      <p
        className={`mt-2 text-xs ${view.spendIsEmpty ? 'text-warn' : 'text-muted'}`}
        role={view.spendIsEmpty ? 'alert' : undefined}
      >
        {/*
          **「額に意味が無い」と言えるのは、1 円も払っていないときだけ。**
          Take が 0 件でも、絵コンテ下書きで実際に払っていれば額には意味がある。
          ここを実測の Take だけで判断していたため、$0.38 使ったあとも
          「この額に意味はありません」と嘘を出していた（2026-09-18）。
          Provider の名前は Take の行に添える。載せ忘れは額では気付けない。
        */}
        {/*
          **Provider の名前は実測が 1 件以上のときだけ添える。**
          0 件なら「実測 0 件」で言い尽くしており、「（該当 Provider なし）」は重複。
          載せ忘れた Provider は実測に数えられて件数が 1 以上になるので、
          気付ける場面は失われない。
        */}
        {view.measuredIsEmpty
          ? `Take: ${view.provenance}`
          : `Take: ${view.provenance}（${view.measuredProviders}）`}
        {view.spendIsEmpty ? '。実 Provider をまだ回していないため、この額に意味はありません' : ''}
      </p>

      {/*
        Shot ごとの内訳を足しても合計に届かない理由を書く。
        差を黙って捨てると、内訳を数えた人が合計と合わずに原因を探すことになる（L-015）。
      */}
      {view.unlistedNote === null ? null : (
        <p className="mt-1 text-xs text-muted">{view.unlistedNote}</p>
      )}

      {/*
        **生成だけが金を使うわけではない。** 絵コンテ下書きやレビューの実行費も
        合計に入っている。内訳を出さないと、Take の額と合わずに原因を探すことになる。
      */}
      {view.otherRunsNote === null ? null : (
        <p className="mt-1 text-xs text-muted">{view.otherRunsNote}</p>
      )}
    </section>
  )
}
