'use client'

import { SFX_DURATION_MAX_SEC, SFX_DURATION_MIN_SEC, SFX_VOLUME_MAX } from '@ixa/domain'
import type { SfxCueRow } from '@/lib/sfx-cue-rows'

const INPUT = 'rounded border border-line bg-surface px-2 py-1 text-sm text-text'

/** 「効果音を作る」窓の 1 行（ADR-0054）。使うか・時刻・長さ・英語の指示・音量を直す。 */
export const SfxCueRowFields = ({
  row,
  error,
  onChange,
  onRemove,
}: {
  readonly row: SfxCueRow
  readonly error: string | undefined
  readonly onChange: (patch: Partial<SfxCueRow>) => void
  readonly onRemove: () => void
}) => (
  <li className="space-y-1 rounded border border-line p-2">
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="checkbox"
        aria-label="この行を作る"
        checked={row.checked}
        onChange={(event) => {
          onChange({ checked: event.target.checked })
        }}
      />
      <label className="flex items-center gap-1 text-xs text-muted">
        時刻
        <input
          className={`${INPUT} w-24`}
          value={row.start}
          aria-invalid={error !== undefined}
          onChange={(event) => {
            onChange({ start: event.target.value })
          }}
        />
      </label>
      <label className="flex items-center gap-1 text-xs text-muted">
        長さ（秒）
        <input
          className={`${INPUT} w-20`}
          type="number"
          inputMode="decimal"
          min={SFX_DURATION_MIN_SEC}
          max={SFX_DURATION_MAX_SEC}
          step={0.1}
          value={row.duration}
          onChange={(event) => {
            onChange({ duration: event.target.value })
          }}
        />
      </label>
      <label className="flex items-center gap-1 text-xs text-muted">
        音量
        <input
          className={`${INPUT} w-16`}
          type="number"
          inputMode="decimal"
          min={0}
          max={SFX_VOLUME_MAX}
          step={0.1}
          value={row.volume}
          onChange={(event) => {
            onChange({ volume: event.target.value })
          }}
        />
      </label>
      {row.reason !== '' && <span className="text-xs text-muted">{row.reason}</span>}
      {row.align !== null && (
        <span className="text-xs text-muted" title="できた音の一番大きいところがこの時刻に来るよう、少し前から鳴らします">
          音の山を時刻に合わせる
        </span>
      )}
      <button type="button" className="ml-auto text-xs text-muted hover:text-danger" onClick={onRemove}>
        行を消す
      </button>
    </div>
    <input
      className={`${INPUT} w-full`}
      aria-label="効果音の指示（英語）"
      placeholder="例: soft sneaker footstep on wooden floor"
      value={row.prompt}
      onChange={(event) => {
        onChange({ prompt: event.target.value })
      }}
    />
    {error !== undefined && (
      <p role="alert" className="text-xs text-danger">
        {error}
      </p>
    )}
  </li>
)
