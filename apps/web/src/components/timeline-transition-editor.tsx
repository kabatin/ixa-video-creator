'use client'

import {
  TransitionType as TransitionTypeSchema,
  type Shot,
  type Transition,
  type TransitionId,
  type TransitionType,
} from '@ixa/domain'
import { useState } from 'react'
import { SelectField } from '@/components/form/select-field'
import { TextField } from '@/components/form/text-field'
import {
  adjacentShotPairs,
  formatClock,
  parseSeconds,
  transitionForPair,
  transitionTypeLabel,
  type ShotPair,
} from '@/lib/timeline-display'

/**
 * Shot と Shot の間に Transition を置く / 消す（P5-4）。
 *
 * **置ける場所は隣り合う Shot の間だけ。** 隣接していない組を選べる画面にすると、
 * 作れてしまってからサーバに弾かれる。組のほうを先に列挙して選ばせる。
 *
 * PATCH は無い契約なので、差し替えは「消して置き直す」になる。
 */

export type AddTransitionInput = {
  readonly fromShotId: Shot['id']
  readonly toShotId: Shot['id']
  readonly type: TransitionType
  readonly durationSec: number
}

export type TimelineTransitionEditorProps = {
  readonly shots: readonly Shot[]
  readonly transitions: readonly Transition[]
  readonly busy: boolean
  readonly onAdd: (input: AddTransitionInput) => void
  readonly onRemove: (id: TransitionId) => void
}

const TYPE_OPTIONS = TransitionTypeSchema.options.map((type) => ({
  value: type,
  label: transitionTypeLabel(type),
}))

const DEFAULT_TYPE: TransitionType = 'dissolve'
const DEFAULT_DURATION = '0.50'

type PairRowProps = {
  readonly pair: ShotPair
  readonly transition: Transition | null
  readonly busy: boolean
  readonly onAdd: (input: AddTransitionInput) => void
  readonly onRemove: (id: TransitionId) => void
}

const PairRow = ({ pair, transition, busy, onAdd, onRemove }: PairRowProps) => {
  const [type, setType] = useState<string>(DEFAULT_TYPE)
  const [durationRaw, setDurationRaw] = useState(DEFAULT_DURATION)
  const [error, setError] = useState<string | undefined>(undefined)

  const rowId = `${pair.from.id}-${pair.to.id}`
  const boundary = formatClock(pair.to.startSec)

  const submit = (): void => {
    const parsedType = TransitionTypeSchema.safeParse(type)
    if (!parsedType.success) {
      setError('種類を選んでください')
      return
    }
    const duration = parseSeconds(durationRaw)
    if (!duration.ok) {
      setError(duration.message)
      return
    }
    setError(undefined)
    onAdd({
      fromShotId: pair.from.id,
      toShotId: pair.to.id,
      type: parsedType.data,
      durationSec: duration.value,
    })
  }

  return (
    <li className="flex flex-wrap items-end gap-3 border-t border-slate-200 py-3">
      <div className="min-w-48 flex-1">
        <p className="text-sm font-medium text-slate-800">
          {`${pair.from.code} → ${pair.to.code}`}
        </p>
        <p className="text-xs text-slate-500">{`境目 ${boundary}`}</p>
      </div>

      {transition === null ? (
        <>
          <div className="w-44">
            <SelectField
              id={`transition-type-${rowId}`}
              label="種類"
              value={type}
              options={TYPE_OPTIONS}
              disabled={busy}
              onChange={setType}
            />
          </div>
          <div className="w-28">
            <TextField
              id={`transition-duration-${rowId}`}
              label="尺（秒）"
              value={durationRaw}
              disabled={busy}
              error={error}
              onChange={setDurationRaw}
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            置く
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-800">
            {`${transitionTypeLabel(transition.type)} / ${transition.durationSec.toFixed(2)}s`}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onRemove(transition.id)
            }}
            className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            消す
          </button>
        </>
      )}
    </li>
  )
}

export const TimelineTransitionEditor = ({
  shots,
  transitions,
  busy,
  onAdd,
  onRemove,
}: TimelineTransitionEditorProps) => {
  const pairs = adjacentShotPairs(shots)

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold text-slate-900">Transition</h2>
      <p className="mt-1 text-sm text-slate-600">
        隣り合う Shot の間にだけ置けます。差し替えるときは一度消してから置き直してください。
      </p>

      {pairs.length === 0 ? (
        <p role="status" className="mt-4 text-sm text-slate-600">
          {shots.length === 0
            ? 'Shot が 1 つもないため、置ける場所がありません。'
            : 'Shot が 1 つしかないため、置ける場所がありません。'}
        </p>
      ) : (
        <ul className="mt-2">
          {pairs.map((pair) => (
            <PairRow
              key={`${pair.from.id}-${pair.to.id}`}
              pair={pair}
              transition={transitionForPair(transitions, pair)}
              busy={busy}
              onAdd={onAdd}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
