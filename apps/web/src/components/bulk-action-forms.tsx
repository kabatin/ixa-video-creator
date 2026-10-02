'use client'

import type { ModelId } from '@ixa/domain'
import { useState } from 'react'
import { FIELD_HINT_CLASS } from '@/components/form/field-styles'
import { SelectField } from '@/components/form/select-field'
import { TextField } from '@/components/form/text-field'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { TAKE_COUNT_OPTIONS } from '@/lib/generation-options'
import { unguidedBulkLine } from '@/lib/unguided-take'

/**
 * 操作バーの中で開く 3 つの小さな入力（P58-4）。
 *
 * **判定も送信もここではしない。** 打たれた値をそのまま上へ返す。
 * バーの開閉・焦点・結果の表示は `bulk-action-bar.tsx` が持つ。
 */

export type BulkModelValue = ModelId | 'AUTO'

export type BulkModelOption = {
  readonly value: BulkModelValue
  readonly label: string
}

export type BulkSelectOption = {
  readonly value: string
  readonly label: string
}

export type BulkGenerateInput = {
  readonly model: BulkModelValue
  readonly count: number
}

export type BulkTakeRule = 'only' | 'latest'

/** 触った項目だけを持つ。**省略と `null` は別の意味。** 省略は「変えない」。 */
export type BulkUpdatePatch = {
  readonly camera?: { readonly size: string }
  readonly mood?: string | null
  readonly locationId?: string | null
}

/**
 * 「変えない」を表す select の値。
 *
 * **空文字と混ぜない**（lessons L-015 / L-021）。この画面では
 * 空文字は「外す（`null` にする）」の意味で使う欄がある。両方を空文字にすると、
 * 触っていない欄が黙って `null` で送られ、27 件の mood が一斉に消える。
 */
export const KEEP_VALUE = '__keep__'
/** 「空にする」。patch には `null` として載る。 */
export const CLEAR_VALUE = '__clear__'

const KEEP_LABEL = '変えない'

export type BulkUpdateDraft = {
  readonly cameraSize: string
  readonly moodAction: 'keep' | 'set' | 'clear'
  readonly moodText: string
  readonly locationId: string
}

export const EMPTY_UPDATE_DRAFT: BulkUpdateDraft = Object.freeze({
  cameraSize: KEEP_VALUE,
  moodAction: 'keep',
  moodText: '',
  locationId: KEEP_VALUE,
})

/**
 * 触った項目だけを patch にする。
 *
 * **`KEEP_VALUE` の欄はキーごと落とす。** `undefined` を入れて送ると、
 * 受け側が「キーはあるが値が無い」を消去と読む余地が残る。
 */
export const buildBulkPatch = (draft: BulkUpdateDraft): BulkUpdatePatch => ({
  ...(draft.cameraSize === KEEP_VALUE ? {} : { camera: { size: draft.cameraSize } }),
  ...(draft.moodAction === 'keep'
    ? {}
    : { mood: draft.moodAction === 'clear' ? null : draft.moodText.trim() }),
  ...(draft.locationId === KEEP_VALUE
    ? {}
    : { locationId: draft.locationId === CLEAR_VALUE ? null : draft.locationId }),
})

/** 空欄のまま「この値にする」を選んだとき。**空文字を黙って送らない。** */
export const bulkPatchError = (draft: BulkUpdateDraft): string | undefined =>
  draft.moodAction === 'set' && draft.moodText.trim() === ''
    ? 'mood を入力してください。空にしたいときは「空にする」を選びます。'
    : undefined

export const hasBulkPatch = (draft: BulkUpdateDraft): boolean =>
  Object.keys(buildBulkPatch(draft)).length > 0

const withKeep = (options: readonly BulkSelectOption[]): readonly BulkSelectOption[] => [
  { value: KEEP_VALUE, label: KEEP_LABEL },
  ...options,
]

/** 「件」を数える文。ロック・採用済みの断りに使う。 */
const countLabel = (count: number): string => `${String(count)} 件`

/**
 * 合計の見積の 1 行。**`null` を空欄にしない。**
 *
 * いまの API には**投入前に見積だけ取る口が無い**。
 * `POST .../shots/bulk/generate` が `estimatedTotalUsd` を返すのは 202（投入したあと）と
 * 422（予算超過で 1 件も投入しなかったとき）だけ（`apps/api/src/routes/shots-bulk.ts`）。
 * 出せないものを黙って空欄にすると、金額が伏せられたまま「取り消せません」を押させることになる。
 * **出せないなら、出せないと書く**（lessons L-015）。
 */
const estimateLine = (estimatedTotalUsd: number | null): string =>
  estimatedTotalUsd === null
    ? '合計の見積: いまは投入する前に出せません。投入すると実際の合計が出ます。'
    : `合計の見積: $${estimatedTotalUsd.toFixed(2)}`

// --- 一括生成 ---

export type BulkGenerateFormProps = {
  readonly idPrefix: string
  /** 実際に投入される件数（選択 − ロック）。 */
  readonly targetCount: number
  readonly lockedCount: number
  /** 説明も最初のフレームも無い Shot の数。止めはせず、押す前に言う。 */
  readonly unguidedCount: number
  readonly modelOptions: readonly BulkModelOption[]
  /**
   * 合計の見積（USD）。**`null` は「事前には見積もれない」。**
   * `0` は「見積もった結果 0」であって、同じ意味ではない（lessons L-015）。
   * どちらでも 1 行出す。**空欄にしない**（`estimateLine`）。
   */
  readonly estimatedTotalUsd: number | null
  readonly busy: boolean
  readonly onGenerate: (input: BulkGenerateInput) => void
}

export const BulkGenerateForm = ({
  idPrefix,
  targetCount,
  lockedCount,
  unguidedCount,
  modelOptions,
  estimatedTotalUsd,
  busy,
  onGenerate,
}: BulkGenerateFormProps) => {
  const unguided = unguidedBulkLine(unguidedCount)
  // 既定は AUTO。渡されていなければ先頭を使う（空の select を出さない）。
  const [model, setModel] = useState<BulkModelValue>(
    () => modelOptions.find((option) => option.value === 'AUTO')?.value ?? modelOptions[0]?.value ?? 'AUTO',
  )
  const [count, setCount] = useState('1')

  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <SelectField
        id={`${idPrefix}-model`}
        label="モデル"
        value={model}
        options={modelOptions.map((option) => ({ value: option.value, label: option.label }))}
        disabled={busy}
        onChange={(next) => {
          const picked = modelOptions.find((option) => option.value === next)
          if (picked !== undefined) setModel(picked.value)
        }}
      />
      <SelectField
        id={`${idPrefix}-count`}
        label="本数"
        value={count}
        options={TAKE_COUNT_OPTIONS}
        disabled={busy}
        onChange={setCount}
      />
      <div className="sm:pb-0.5">
        <ConfirmButton
          label={`${countLabel(targetCount)}に生成を依頼`}
          confirmLabel="依頼する"
          // 金額（か、金額が出せないこと）は**押す直前**に出す。フォームの隅では見ずに押される。
          message={`${countLabel(targetCount)}の Shot に ${count} 本ずつ生成を依頼します。${unguided}${estimateLine(estimatedTotalUsd)} 投入した生成は「生成をやめる」で止められますが、生成先によっては途中まで費用が掛かります。`}
          disabled={busy || targetCount === 0}
          size="sm"
          onConfirm={() => {
            onGenerate({ model, count: Number(count) })
          }}
        />
      </div>
      <div className="sm:col-span-3">
        {lockedCount > 0 && (
          <p className={FIELD_HINT_CLASS}>
            {countLabel(lockedCount)}はロックされているため、生成されません。
          </p>
        )}
        {unguided !== '' && <p className={FIELD_HINT_CLASS}>{unguided}</p>}
        {targetCount === 0 && (
          <p className={FIELD_HINT_CLASS}>生成できる Shot が選ばれていません。</p>
        )}
        {/* **条件を付けない。** 付けていたせいで、この行は一度も描かれなかった。 */}
        <p className={FIELD_HINT_CLASS}>{estimateLine(estimatedTotalUsd)}</p>
      </div>
    </div>
  )
}

// --- 一括採用 ---

const RULE_OPTIONS: readonly BulkSelectOption[] = [
  { value: 'only', label: 'Take が 1 件だけの Shot を採用' },
  { value: 'latest', label: '最新の Take を採用' },
]

export type BulkSelectTakesFormProps = {
  readonly idPrefix: string
  readonly targetCount: number
  /** 選択の中で既に採用済みの Shot の数。上書きになることを断る。 */
  readonly alreadySelectedCount: number
  readonly busy: boolean
  readonly onSelectTakes: (rule: BulkTakeRule) => void
}

export const BulkSelectTakesForm = ({
  idPrefix,
  targetCount,
  alreadySelectedCount,
  busy,
  onSelectTakes,
}: BulkSelectTakesFormProps) => {
  const [rule, setRule] = useState<BulkTakeRule>('only')

  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <SelectField
        id={`${idPrefix}-rule`}
        label="規則"
        value={rule}
        options={RULE_OPTIONS}
        disabled={busy}
        onChange={(next) => {
          if (next === 'only' || next === 'latest') setRule(next)
        }}
      />
      <div className="sm:pb-0.5">
        {/* 採用は詳細から選び直せる。確認は挟まない（`components/ui/button` の注記）。 */}
        <Button
          tone="primary"
          size="sm"
          disabled={busy || targetCount === 0}
          onClick={() => {
            onSelectTakes(rule)
          }}
        >
          {countLabel(targetCount)}を採用
        </Button>
      </div>
      {alreadySelectedCount > 0 && (
        <p className={`${FIELD_HINT_CLASS} sm:col-span-2`}>
          {countLabel(alreadySelectedCount)}は採用済みで、上書きになります。
        </p>
      )}
    </div>
  )
}

// --- 一括で変える ---

const MOOD_ACTION_OPTIONS: readonly BulkSelectOption[] = [
  { value: 'keep', label: KEEP_LABEL },
  { value: 'set', label: 'この値にする' },
  { value: 'clear', label: '空にする' },
]

export type BulkUpdateFormProps = {
  readonly idPrefix: string
  readonly targetCount: number
  readonly cameraSizeOptions: readonly BulkSelectOption[]
  readonly locationOptions: readonly BulkSelectOption[]
  readonly busy: boolean
  readonly onUpdate: (patch: BulkUpdatePatch) => void
}

export const BulkUpdateForm = ({
  idPrefix,
  targetCount,
  cameraSizeOptions,
  locationOptions,
  busy,
  onUpdate,
}: BulkUpdateFormProps) => {
  const [draft, setDraft] = useState<BulkUpdateDraft>(EMPTY_UPDATE_DRAFT)
  const error = bulkPatchError(draft)

  // 渡された選択肢の空文字は「なし」を指す（`lib/location-options`）。
  // ここでは「変えない」と衝突するため落とし、外す操作は専用の値で出す。
  const locations = [
    { value: KEEP_VALUE, label: KEEP_LABEL },
    { value: CLEAR_VALUE, label: 'ロケーションを外す' },
    ...locationOptions.filter((option) => option.value !== ''),
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-4 sm:items-end">
      <SelectField
        id={`${idPrefix}-camera-size`}
        label="カメラの景別"
        value={draft.cameraSize}
        options={withKeep(cameraSizeOptions)}
        disabled={busy}
        onChange={(next) => {
          setDraft({ ...draft, cameraSize: next })
        }}
      />
      <div>
        <SelectField
          id={`${idPrefix}-mood-action`}
          label="mood"
          value={draft.moodAction}
          options={MOOD_ACTION_OPTIONS}
          disabled={busy}
          onChange={(next) => {
            if (next === 'keep' || next === 'set' || next === 'clear') {
              setDraft({ ...draft, moodAction: next })
            }
          }}
        />
        {draft.moodAction === 'set' && (
          <div className="mt-2">
            <TextField
              id={`${idPrefix}-mood-text`}
              label="mood の値"
              value={draft.moodText}
              disabled={busy}
              error={error}
              onChange={(next) => {
                setDraft({ ...draft, moodText: next })
              }}
            />
          </div>
        )}
      </div>
      <SelectField
        id={`${idPrefix}-location`}
        label="ロケーション"
        value={draft.locationId}
        options={locations}
        disabled={busy}
        onChange={(next) => {
          setDraft({ ...draft, locationId: next })
        }}
      />
      <div className="sm:pb-0.5">
        {/* 変えた値は詳細からも一覧からも直せる。確認は挟まない。 */}
        <Button
          tone="primary"
          size="sm"
          disabled={busy || targetCount === 0 || !hasBulkPatch(draft) || error !== undefined}
          onClick={() => {
            onUpdate(buildBulkPatch(draft))
          }}
        >
          {countLabel(targetCount)}に適用
        </Button>
      </div>
      <p className={`${FIELD_HINT_CLASS} sm:col-span-4`}>
        「{KEEP_LABEL}」のままの項目は送りません。説明は一覧の行の中で直せます。
      </p>
    </div>
  )
}
