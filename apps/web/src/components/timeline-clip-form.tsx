'use client'

import { useState } from 'react'
import { TextField } from '@/components/form/text-field'
import { SnapNoticeList } from '@/components/timeline-snap-panel'
import { parseDurationSec, parseLayer, parseSeconds } from '@/lib/timeline-display'
import type { SnapNotice, SnapSpanInput, SnapSpanOutcome } from '@/lib/timeline-snap'

/**
 * TEXT トラックにテロップのクリップを足す（P5-4）。
 *
 * ドラッグは持たない。位置と尺は数値で入れる。
 * **入力の不備は必ず欄の下に出す。**「押したのに何も起きない」を作らない。
 *
 * VFX / VIDEO2 / SFX のクリップはこの画面からは作らない（素材の選択が要るため）。
 * それらのトラックは既にあるクリップを映すだけになる。
 *
 * 確定時に開始と終了を吸着候補へ寄せる。**寄せた結果は必ず欄の下に出す。**
 * 数字だけを見て「動いたのか動いていないのか」を利用者に推測させない（lessons L-015）。
 */

export type NewTextClipInput = {
  readonly startSec: number
  readonly durationSec: number
  readonly layer: number
  readonly templateKey: string
}

export type TimelineClipFormProps = {
  readonly busy: boolean
  readonly onAdd: (input: NewTextClipInput) => void
  /**
   * 吸着の実行。候補・許容距離・ON/OFF は呼び出し側が持つ。
   * **この画面に吸着の規則を書かない**（正は `packages/timeline`）。
   */
  readonly onSnapSpan: (span: SnapSpanInput) => SnapSpanOutcome
}

type Values = {
  readonly templateKey: string
  readonly startSec: string
  readonly durationSec: string
  readonly layer: string
}

type Errors = Partial<Record<keyof Values, string>>

const INITIAL: Values = {
  templateKey: 'lower-third',
  startSec: '0',
  durationSec: '2',
  layer: '0',
}

/** 検証は 1 つ落ちたら止めず、落ちた欄をすべて返す。直す回数を減らすため。 */
const validate = (
  values: Values,
): { readonly errors: Errors; readonly input: NewTextClipInput | null } => {
  const templateKey = values.templateKey.trim()
  const start = parseSeconds(values.startSec)
  const duration = parseDurationSec(values.durationSec)
  const layer = parseLayer(values.layer)

  const errors: Errors = {
    ...(templateKey === '' ? { templateKey: 'テンプレート名を入力してください' } : {}),
    ...(start.ok ? {} : { startSec: start.message }),
    ...(duration.ok ? {} : { durationSec: duration.message }),
    ...(layer.ok ? {} : { layer: layer.message }),
  }

  if (Object.keys(errors).length > 0 || !start.ok || !duration.ok || !layer.ok) {
    return { errors, input: null }
  }
  return {
    errors,
    input: { startSec: start.value, durationSec: duration.value, layer: layer.value, templateKey },
  }
}

export const TimelineClipForm = ({ busy, onAdd, onSnapSpan }: TimelineClipFormProps) => {
  const [values, setValues] = useState<Values>(INITIAL)
  const [errors, setErrors] = useState<Errors>({})
  const [notices, setNotices] = useState<readonly SnapNotice[] | null>(null)

  const update = (field: keyof Values) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setNotices(null)
  }

  const submit = (): void => {
    const result = validate(values)
    setErrors(result.errors)
    if (result.input === null) {
      setNotices(null)
      return
    }

    const snapped = onSnapSpan(result.input)
    setNotices(snapped.notices)
    // 実際に送る値を欄へ書き戻す。入力欄と送信値がずれていると何が起きたか分からない。
    setValues((current) => ({
      ...current,
      startSec: snapped.startSec.toFixed(3),
      durationSec: snapped.durationSec.toFixed(3),
    }))
    onAdd({ ...result.input, startSec: snapped.startSec, durationSec: snapped.durationSec })
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold text-slate-900">TEXT クリップを足す</h2>
      <p className="mt-1 text-sm text-slate-600">
        現在のレンダラはテキストを
        <code className="mx-1 rounded bg-slate-100 px-1">[text] テンプレート名</code>
        の仮表示として描きます。テンプレートが実装されるまで、見えるのはこの文字列です。
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          id="clip-template-key"
          label="テンプレート名"
          value={values.templateKey}
          disabled={busy}
          error={errors.templateKey}
          onChange={update('templateKey')}
        />
        <TextField
          id="clip-start-sec"
          label="開始（秒）"
          value={values.startSec}
          disabled={busy}
          error={errors.startSec}
          onChange={update('startSec')}
        />
        <TextField
          id="clip-duration-sec"
          label="尺（秒）"
          value={values.durationSec}
          disabled={busy}
          error={errors.durationSec}
          onChange={update('durationSec')}
        />
        <TextField
          id="clip-layer"
          label="layer（重ね順）"
          value={values.layer}
          disabled={busy}
          error={errors.layer}
          onChange={update('layer')}
        />
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        TEXT クリップを足す
      </button>

      <SnapNoticeList notices={notices} />
    </section>
  )
}
