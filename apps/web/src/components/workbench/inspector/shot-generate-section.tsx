'use client'

import type { Shot } from '@ixa/domain'
import { useEffect, useId, useMemo, useState } from 'react'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { FieldRow, INPUT_CLASS } from '@/components/workbench/ui/section'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { GenerateTakesBody, type WireGenerateResult } from '@/lib/api-schemas'
import { buildCostMeterView, type CostMeterView } from '@/lib/cost-meter'
import { AUTO_MODEL, MODEL_OPTIONS, TAKE_COUNT_OPTIONS } from '@/lib/generation-options'
import { isGeneratingStatus } from '@/lib/shot-display'

/**
 * 生成（UI-WORKBENCH-2 §5.2）。**このパネルの主ボタン**はここ。
 * 押す前に予算の残りを見せる（額だけを出さない規則はそのまま: 出どころを添える）。
 * 1 本ずつの見積は API が出さないので出さない（出したふりをしない）。
 */
export const ShotGenerateSection = ({ shot }: { readonly shot: Shot }) => {
  const workbench = useWorkbench()
  const modelId = useId()
  const countId = useId()
  const [model, setModel] = useState(AUTO_MODEL)
  const [count, setCount] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<WireGenerateResult | null>(null)
  const cost = useCost(workbench.projectId)
  const generating = isGeneratingStatus(shot.status)

  const generate = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const body = GenerateTakesBody.parse({ model, count: Number(count) })
      setResult(await createApiClient().generateTakes(shot.id, body))
      // サーバと同じ遷移を先回りして映す。完了は SSE が届ける。
      workbench.replaceShots([{ ...shot, status: 'generating' }])
    } catch (cause) {
      setError(`生成を開始できませんでした: ${describeForPerson(cause)}`)
    } finally {
      setBusy(false)
    }
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
          {MODEL_OPTIONS.map((option) => (
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
      <p className="text-xs text-muted" title={cost?.provenance}>
        {cost === null
          ? '予算を読み込んでいます…'
          : `予算 ${cost.budgetLabel} / 使った額 ${cost.measuredLabel}（${cost.provenance}）`}
      </p>
      <Button tone="primary" disabled={busy || generating} onClick={() => void generate()}>
        {generating ? '生成中…' : busy ? '送っています…' : 'Take を生成'}
      </Button>
      {generating && (
        <p role="status" className="text-xs text-text">
          生成中です。終わった Take から Take 比較に並びます。
        </p>
      )}
      {result !== null && (
        <p className="text-xs text-muted">
          {`${result.resolvedModel} で ${String(result.jobIds.length)} 件を投入しました。`}
          {result.duplicateOfTakeId !== null && (
            <span className="text-warn"> 同じ仕様の Take が既にあります。</span>
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

const useCost = (projectId: Shot['projectId']): CostMeterView | null => {
  const api = useMemo(() => createApiClient(), [])
  const [view, setView] = useState<CostMeterView | null>(null)
  useEffect(() => {
    let cancelled = false
    api
      .getCostMeter(projectId)
      .then((meter) => {
        if (!cancelled) setView(buildCostMeterView(meter))
      })
      .catch(() => {
        // 予算が読めなくても生成はできる。行ごと出さない（ステータスバーの費用が理由を出す）。
      })
    return () => {
      cancelled = true
    }
  }, [api, projectId])
  return view
}
