'use client'

import { useState } from 'react'
import { SelectField } from '@/components/form/select-field'
import type { WireGenerateResult } from '@/lib/api-schemas'
import { AUTO_MODEL, MODEL_OPTIONS, TAKE_COUNT_OPTIONS } from '@/lib/generation-options'

export type GeneratePanelProps = {
  readonly busy: boolean
  readonly generating: boolean
  readonly lastResult: WireGenerateResult | null
  readonly onGenerate: (model: string, count: number) => void
}

export const GeneratePanel = ({ busy, generating, lastResult, onGenerate }: GeneratePanelProps) => {
  const [model, setModel] = useState<string>(AUTO_MODEL)
  const [count, setCount] = useState<string>('1')

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">生成</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <SelectField
          id="model"
          label="モデル"
          value={model}
          options={MODEL_OPTIONS}
          disabled={busy}
          onChange={setModel}
        />
        <SelectField
          id="count"
          label="本数"
          value={count}
          options={TAKE_COUNT_OPTIONS}
          disabled={busy}
          onChange={setCount}
        />
        <div className="flex items-end">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onGenerate(model, Number(count))
            }}
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {generating ? '生成中…' : 'Take を生成'}
          </button>
        </div>
      </div>

      {generating && (
        <p role="status" className="mt-4 text-sm text-blue-800">
          生成中です。完了した Take から順に表示されます。
        </p>
      )}

      {lastResult !== null && (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-slate-600">
          <dt className="text-slate-400">選ばれたモデル</dt>
          <dd>{lastResult.resolvedModel}</dd>
          <dt className="text-slate-400">投入ジョブ</dt>
          <dd>{lastResult.jobIds.length} 件</dd>
          {lastResult.duplicateOfTakeId !== null && (
            <>
              <dt className="text-amber-700">重複</dt>
              <dd className="text-amber-700">
                同じ仕様の Take が既にあります（{lastResult.duplicateOfTakeId}）。
              </dd>
            </>
          )}
        </dl>
      )}
    </section>
  )
}
