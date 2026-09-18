import { FourViewBadge } from '@/components/four-view-badge'
import { FOUR_VIEW_ABSENT_HINT, FOUR_VIEW_NOTICE } from '@/lib/identity-images'

export type FourViewNoticeProps = {
  readonly present: boolean
}

/**
 * 四面図が何のためにあるのかを画面で説明する（docs/ARCHITECTURE.md §8）。
 * 参照枠の節約という意図が分からないと、登録者は個別画像だけを入れてしまう。
 */
export const FourViewNotice = ({ present }: FourViewNoticeProps) => (
  <section
    className={`rounded-lg border p-4 ${
      present ? 'border-ok/40 bg-ok/10' : 'border-warn/40 bg-warn/10'
    }`}
  >
    <div className="flex flex-wrap items-center gap-3">
      <h3 className="text-sm font-semibold text-text">四面図で参照枠を節約する</h3>
      <FourViewBadge present={present} />
    </div>
    <p className="mt-2 text-sm text-text">{FOUR_VIEW_NOTICE}</p>
    {!present && <p className="mt-2 text-sm font-medium text-warn">{FOUR_VIEW_ABSENT_HINT}</p>}
    <dl className="mt-3 grid gap-1 text-xs text-muted">
      <div className="flex gap-2">
        <dt className="shrink-0 font-semibold">四面図あり</dt>
        <dd>[1] 四面図 / [2] Look の衣装 / [3] ロケーション</dd>
      </div>
      <div className="flex gap-2">
        <dt className="shrink-0 font-semibold">四面図なし</dt>
        <dd>[1] 顔（正面）/ [2] 顔（側面）/ [3] 全身 — 衣装もロケーションも渡せない</dd>
      </div>
    </dl>
  </section>
)
