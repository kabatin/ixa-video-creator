import { Button } from '@/components/ui/button'
import type { StartRenderDuplicate } from '@/lib/render-api'
import { formatJobTime } from '@/lib/render-display'

/**
 * 前回うまくいった書き出しと中身が同じ（まだ始めていない）。制作者 2026-10-09
 * 「時間かけて書き出ししてから保存で失敗すると時間の無駄だし UX 最悪なので事前に分かるように」。
 *
 * **自動で飛ばさず、選ばせる。** アプリを更新して描き方が変わっていれば、同じタイムラインでも
 * 結果は変わりうる。そのときは「もう一度書き出す」を選べばよい。
 */
export const RenderDuplicate = ({
  duplicate,
  busy,
  onRenderAgain,
  onDismiss,
}: {
  readonly duplicate: StartRenderDuplicate
  readonly busy: boolean
  readonly onRenderAgain: () => void
  readonly onDismiss: () => void
}) => {
  const when = duplicate.duplicateOf.finishedAt
  return (
    <section role="status" className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
      <p className="text-sm text-text">
        {when === null
          ? '前回の書き出しと中身が同じです。'
          : `前回（${formatJobTime(new Date(when))}）の書き出しと中身が同じです。`}
        右の一覧の、印の付いた書き出しをそのまま使えます。
      </p>
      <p className="text-xs text-muted">アプリを更新したあとなど、作り直したいときだけ「もう一度書き出す」を押してください。</p>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={onRenderAgain}>
          もう一度書き出す
        </Button>
        <Button size="sm" disabled={busy} onClick={onDismiss}>
          閉じる
        </Button>
      </div>
    </section>
  )
}
