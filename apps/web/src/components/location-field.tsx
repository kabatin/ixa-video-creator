import type { Location } from '@ixa/domain'
import { SelectField } from '@/components/form/select-field'
import { FIELD_HINT_CLASS, FIELD_LABEL_CLASS } from '@/components/form/field-styles'
import {
  LOCATION_EMPTY_NOTICE,
  LOCATION_REFERENCE_NOTICE,
  toLocationOptions,
} from '@/lib/location-options'

/** ロケーションの選択欄。Shot は場所を 1 つだけ持つので単一選択にする（ADR-0015）。 */
export type LocationFieldProps = {
  readonly locations: readonly Location[]
  readonly value: string
  readonly disabled: boolean
  readonly error?: string
  /** 一覧の取得に失敗したときの説明。未登録と読み込み失敗は別物として見せる。 */
  readonly loadError?: string
  readonly onChange: (value: string) => void
}

const FIELD_ID = 'locationId'
const LABEL_ID = 'locationId-label'
const LABEL = 'ロケーション'

type NoticeProps = {
  readonly tone: 'muted' | 'warning'
  readonly message: string
}

const NOTICE_TONES: Readonly<Record<NoticeProps['tone'], string>> = Object.freeze({
  // warn を warn/10 の上に置く。コントラストはトークン側（globals.css）で担保する
  warning: 'border-warn/40 bg-warn/10 text-warn',
  // muted を surface-2 の上に置く。コントラストはトークン側（globals.css）で担保する
  muted: 'border-line-strong bg-surface-2 text-muted',
})

/**
 * 選択肢が出せないときの説明。
 *
 * **`<label>` を使わないこと。** ここには紐付ける入力欄が無い。対応する control の無い
 * `<label>` は読み上げ時に宙に浮く。代わりに項目名を `role="group"` の名前として与え、
 * 「ロケーションという項目の説明である」ことを読み上げに伝える。
 *
 * 読み込み失敗は `role="alert"` にする。利用者の操作の結果ではなく環境の異常なので、
 * 視線が別の場所にあっても届く必要がある。未登録は異常ではないので alert にしない。
 */
const NoticeField = ({ tone, message }: NoticeProps) => (
  <div role="group" aria-labelledby={LABEL_ID}>
    <span id={LABEL_ID} className={FIELD_LABEL_CLASS}>
      {LABEL}
    </span>
    <p
      role={tone === 'warning' ? 'alert' : undefined}
      className={`mt-1 rounded-md border border-dashed px-3 py-2 text-sm ${NOTICE_TONES[tone]}`}
    >
      {message}
    </p>
  </div>
)

export const LocationField = ({
  locations,
  value,
  disabled,
  error,
  loadError,
  onChange,
}: LocationFieldProps) => {
  if (loadError !== undefined) {
    return (
      <NoticeField tone="warning" message={`ロケーションを読み込めませんでした: ${loadError}`} />
    )
  }

  if (locations.length === 0) {
    return <NoticeField tone="muted" message={LOCATION_EMPTY_NOTICE} />
  }

  return (
    <div>
      <SelectField
        id={FIELD_ID}
        label={LABEL}
        value={value}
        options={toLocationOptions(locations)}
        disabled={disabled}
        error={error}
        onChange={onChange}
      />
      <p className={`mt-1 ${FIELD_HINT_CLASS}`}>{LOCATION_REFERENCE_NOTICE}</p>
    </div>
  )
}
