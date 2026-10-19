'use client'

import {
  countSnapCandidates,
  describeBeatSource,
  type BeatSource,
  type BeatSourceTone,
} from '@/lib/timeline-snap'
import type { SnapCandidate } from '@ixa/timeline'

/**
 * 吸着の候補（P6）。候補の内訳・ビートの出どころを見せる。入り切りはタイムラインのツールバー。
 *
 * **「ビートに吸着しない」を黙って起こさない。** 解析が無い・楽曲が無い・読めていない、
 * どれも結果は同じ「ビート候補ゼロ」だが、利用者が取るべき行動が違う（lessons L-015）。
 */

const TONE_CLASSES: Readonly<Record<BeatSourceTone, string>> = {
  ok: 'border-ok/40 bg-ok/10 text-ok',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  error: 'border-danger/40 bg-danger/10 text-danger',
}

export type SnapSourceSummaryProps = {
  readonly beatSource: BeatSource
  /** どのクリップも除外していない状態の候補。内訳の目安として出す。 */
  readonly candidates: readonly SnapCandidate[]
}

/** ビートの出どころと候補の内訳。 */
const SnapSourceDetail = ({ beatSource, candidates }: SnapSourceSummaryProps) => {
  const notice = describeBeatSource(beatSource)
  const counts = countSnapCandidates(candidates)
  return (
    <>
      <div
        role={notice.tone === 'error' ? 'alert' : 'status'}
        className={`mt-3 rounded-md border p-3 ${TONE_CLASSES[notice.tone]}`}
      >
        <p className="text-sm font-medium">{notice.headline}</p>
        <p className="mt-1 text-sm">{notice.detail}</p>
      </div>

      {counts.length === 0 ? (
        <p role="status" className="mt-3 text-sm text-warn">
          吸着候補が 1 件もありません。「拍に吸着」を入れても位置は動きません。
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
    </>
  )
}

/**
 * 吸着の候補（検査のタブ）。**入り切りは置かない。** 切り替えはタイムラインのツールバーの「拍に吸着」。
 * ここは「なぜ吸着しないのか」を読む場所（解析が無い・楽曲が無い・読めていない）。
 */
export const SnapSourceSummary = (props: SnapSourceSummaryProps) => (
  <section className="rounded-lg border border-line bg-surface p-4" aria-label="ビート吸着の候補">
    <h2 className="text-sm font-semibold text-text">ビート吸着の候補</h2>
    <SnapSourceDetail {...props} />
  </section>
)
