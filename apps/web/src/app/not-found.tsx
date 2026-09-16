import { describeViewState } from '@/components/empty-state'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { CHARACTER_LIST_HREF } from '@/lib/character-links'

/**
 * 404。**「ページが無い」は「中身が空」でも「読めなかった」でもない。**
 * 待っても再読み込みしても直らないので、行ける場所を必ず出す。
 */
const NotFound = () => {
  const state = describeViewState('missing', 'ページ')

  return (
    <main>
      <PageHeader title="404" />
      <ErrorPanel
        title={state.title}
        message="この URL に対応する画面はありません。"
        hint={state.hint}
        actions={[
          { href: '/', label: 'プロジェクト一覧へ' },
          { href: CHARACTER_LIST_HREF, label: 'キャラクター一覧へ' },
        ]}
      />
    </main>
  )
}

export default NotFound
