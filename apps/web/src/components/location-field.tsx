import type { Location } from '@ixa/domain'
import { SelectField } from '@/components/form/select-field'
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
const LABEL = 'ロケーション'

const Label = () => <span className="block text-sm font-medium text-slate-800">{LABEL}</span>

type NoticeProps = {
  readonly tone: 'muted' | 'warning'
  readonly message: string
}

const Notice = ({ tone, message }: NoticeProps) => (
  <p
    className={`mt-1 rounded-md border border-dashed px-3 py-2 text-sm ${
      tone === 'warning'
        ? 'border-amber-300 bg-amber-50 text-amber-900'
        : 'border-slate-300 bg-slate-50 text-slate-600'
    }`}
  >
    {message}
  </p>
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
      <div>
        <Label />
        <Notice tone="warning" message={`ロケーションを読み込めませんでした: ${loadError}`} />
      </div>
    )
  }

  if (locations.length === 0) {
    return (
      <div>
        <Label />
        <Notice tone="muted" message={LOCATION_EMPTY_NOTICE} />
      </div>
    )
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
      <p className="mt-1 text-xs text-slate-500">{LOCATION_REFERENCE_NOTICE}</p>
    </div>
  )
}
