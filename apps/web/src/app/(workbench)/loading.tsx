import { describeViewState } from '@/components/empty-state'

/**
 * ワークベンチを開くまでの表示。共通材料（Shot・楽曲・解析など）を読む間、無反応に見せない。
 *
 * **ルート直下には置かない。** 置くと旧 URL のリダイレクトまで Suspense に包まれ、
 * HTTP の 307 ではなく 200 + クライアント側の移動になる（PHASE 7.1 で実測）。
 */
const WorkbenchLoading = () => {
  const state = describeViewState('loading', 'ワークベンチ')
  return (
    <main role="status" aria-live="polite" className="flex h-full flex-col items-center justify-center gap-4">
      <p className="text-sm text-muted">{state.hint}</p>
      <div aria-hidden className="h-2 w-40 animate-pulse rounded-full bg-line" />
    </main>
  )
}

export default WorkbenchLoading
