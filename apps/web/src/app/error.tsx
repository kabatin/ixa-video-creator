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
/**
 * **原因を決めつけない。** この境界は通信の失敗も画面の不具合も受ける。以前は
 * 「読めなかった」の既定文（通信か API 側の問題）をそのまま出していて、スマホ幅での
 * 無限更新でも利用者を通信の確認へ向かわせた。
 */
const BOUNDARY_HINT =
  '通信の途切れか、画面の不具合です。再読み込みで直らなければ、この画面の内容を添えて知らせてください。'

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
        message="画面を表示できませんでした。"
        hint={BOUNDARY_HINT}
        // 例外の文と識別子は直す手がかり。本文には出さず「詳しい情報」に畳む。
        detail={[
          error.message.length > 0 ? error.message : '原因を特定できませんでした。',
          ...(error.digest === undefined ? [] : [`問い合わせ用の識別子: ${error.digest}`]),
        ].join(' / ')}
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
