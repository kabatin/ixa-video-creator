'use client'

import {
  countSnapCandidates,
  describeBeatSource,
  snapNoticeClassName,
  type BeatSource,
  type BeatSourceTone,
  type SnapNotice,
} from '@/lib/timeline-snap'
import type { SnapCandidate } from '@ixa/timeline'

/**
 * 吸着の操作盤（P6）。ON / OFF・許容距離・候補の内訳・ビートの出どころを見せる。
 *
 * **「ビートに吸着しない」を黙って起こさない。** 解析が無い・楽曲が無い・読めていない、
 * どれも結果は同じ「ビート候補ゼロ」だが、利用者が取るべき行動が違う（lessons L-015）。
 */

const TONE_CLASSES: Readonly<Record<BeatSourceTone, string>> = {
  ok: 'border-ok/40 bg-ok/10 text-ok',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  error: 'border-danger/40 bg-danger/10 text-danger',
}

export type TimelineSnapPanelProps = {
  readonly enabled: boolean
  readonly onToggle: (enabled: boolean) => void
  readonly beatSource: BeatSource
  /** 今のズームでの許容距離（秒）。px 固定なのでズームで変わることを見せる。 */
  readonly toleranceSec: number
  /** どのクリップも除外していない状態の候補。内訳の目安として出す。 */
  readonly candidates: readonly SnapCandidate[]
}

export const TimelineSnapPanel = ({
  enabled,
  onToggle,
  beatSource,
  toleranceSec,
  candidates,
}: TimelineSnapPanelProps) => {
  const notice = describeBeatSource(beatSource)
  const counts = countSnapCandidates(candidates)

  return (
    <section className="rounded-lg border border-line bg-surface p-5" aria-label="ビート吸着">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-text">ビート吸着</h2>
        <button
          type="button"
          aria-pressed={enabled}
          onClick={() => {
            onToggle(!enabled)
          }}
          className={`rounded-md px-4 py-1.5 text-sm font-medium ring-1 ${
            enabled
              ? 'bg-accent text-accent-fg ring-accent'
              : 'bg-surface text-text ring-line-strong hover:bg-surface-2'
          }`}
        >
          {enabled ? '吸着 ON' : '吸着 OFF'}
        </button>
      </div>

      <p role="status" className="mt-2 text-sm text-muted">
        {enabled
          ? `入力した秒を、最寄りの候補へ寄せます。許容距離は今のズームで ${toleranceSec.toFixed(3)}s（画面上で 8px 相当）です。`
          : '吸着を切っています。入力した秒をそのまま使います。狙った位置へ正確に置きたいときはこちらです。'}
      </p>

      <div
        role={notice.tone === 'error' ? 'alert' : 'status'}
        className={`mt-3 rounded-md border p-3 ${TONE_CLASSES[notice.tone]}`}
      >
        <p className="text-sm font-medium">{notice.headline}</p>
        <p className="mt-1 text-sm">{notice.detail}</p>
      </div>

      {counts.length === 0 ? (
        <p role="status" className="mt-3 text-sm text-warn">
          吸着候補が 1 件もありません。吸着を ON にしても値は動きません。
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {counts.map((entry) => (
            <li
              key={entry.kind}
              className="rounded-full bg-surface-2 px-3 py-1 text-xs text-text ring-1 ring-line"
            >
              {`${entry.label} ${String(entry.count)} 件`}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export type SnapNoticeListProps = {
  /** null は「まだ確定していない」。空配列を出すのと区別する。 */
  readonly notices: readonly SnapNotice[] | null
}

/**
 * 直前の確定で何に吸着したかを出す。
 * **`snappedTo` が null かどうかだけで文面が決まっている**（`timeline-snap.ts`）ので、
 * 値が変わらなかった吸着も「吸着した」と表示される。
 */
export const SnapNoticeList = ({ notices }: SnapNoticeListProps) => {
  if (notices === null || notices.length === 0) return null

  return (
    <ul role="status" className="mt-3 space-y-1 rounded-md bg-surface-2 p-3">
      {notices.map((notice) => (
        <li key={notice.label} className={`text-xs ${snapNoticeClassName(notice.state)}`}>
          <span className="font-medium">{`${notice.label}: `}</span>
          {notice.message}
        </li>
      ))}
    </ul>
  )
}
