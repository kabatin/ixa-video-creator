'use client'

import { describeViewState } from '@/components/empty-state'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { WORDING } from '@/lib/wording'

/**
 * 想定外の例外を受け止める境界。
 *
 * これが無いと Next.js の既定画面（英語のスタックトレース）が出る。利用者は
 * 何が起きたのかも、次に何をすればよいのかも分からない。
 *
 * **「読めなかった」は「無い」ではない。** 対象が存在するかどうかは分かっていないので、
 * まず `reset()` でやり直させる。直らないときのために一覧への経路も出す。
 *
 * `digest` はサーバ側のログと突き合わせるための識別子。本番ではメッセージが
 * 伏せられるため、これが無いと原因に辿り着けない。
 */
type ErrorPageProps = {
  readonly error: Error & { readonly digest?: string }
  readonly reset: () => void
}

const ErrorPage = ({ error, reset }: ErrorPageProps) => {
  const state = describeViewState('unreadable', 'ページ')

  return (
    <main>
      <PageHeader title="エラーが発生しました" />
      <ErrorPanel
        title={state.title}
        message={error.message.length > 0 ? error.message : '原因を特定できませんでした。'}
        hint={
          error.digest === undefined
            ? state.hint
            : `${state.hint}（問い合わせ用の識別子: ${error.digest}）`
        }
        actions={[{ href: '/', label: 'プロジェクト一覧へ' }]}
      >
        <Button tone="primary" onClick={reset}>
          {WORDING.reload}
        </Button>
      </ErrorPanel>
    </main>
  )
}

export default ErrorPage
