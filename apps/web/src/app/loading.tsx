import { describeViewState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'

/**
 * 画面遷移中の表示。
 *
 * 全ページがサーバで組み立てられるため、これが無いと**遷移中は完全に無反応**になる。
 * 利用者はクリックが効かなかったと思って押し直す。
 *
 * **ここは「待てば出る」専用。** 0 件でも異常でもないので `role="status"` で、
 * 割り込まずに読み上げさせる。
 */
const Loading = () => {
  const state = describeViewState('loading', 'ページ')

  return (
    <main>
      <PageHeader title={state.title} />
      <div
        role="status"
        aria-live="polite"
        className="rounded-lg border border-slate-200 bg-white p-12 text-center"
      >
        <p className="text-sm text-slate-600">{state.hint}</p>
        <div
          aria-hidden
          className="mx-auto mt-6 h-2 w-40 animate-pulse rounded-full bg-slate-200"
        />
      </div>
    </main>
  )
}

export default Loading
