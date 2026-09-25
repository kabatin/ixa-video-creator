import type { ShotId, Take, TakeId } from '@ixa/domain'
import { describeError } from '@/lib/api-error'

/**
 * 生成が終わったら、自動レビューをするか聞く（制作者の判断 2026-09-25）。
 *
 * 以前は生成後に何も起きず、Shot は「レビュー待ち」、Take は「自動レビュー未実施」のまま
 * だった。自動レビューは勝手には始まらず、インスペクター最下部のボタンを押す必要があった。
 * **待っているように見えて、何も来ない**（解析で直したのと同じ型）。
 *
 * ただし勝手に始めはしない。レビュアが有料の AI になったとき、黙って回すと費用が出る。
 * 聞き方は**ネイティブの確認ダイアログ**（制作者の指定）。断ったときも、あとで
 * どこから実行できるかを伝える。
 *
 * 画面や window に直接触らず、聞く口・伝える口を受け取る（テストで差し替えるため）。
 */

/** 断ったときに伝える文。「いまはしない」を選んだ人が、あとで迷わないように。 */
export const REVIEW_LATER_GUIDANCE =
  '自動レビューはあとからでも実行できます。Shot を選び、右の「インスペクター」の「レビュー」で「レビューを実行」を押してください（採用している Take が対象です）。'

export type OfferReviewDeps = {
  readonly shotIds: readonly ShotId[]
  readonly api: {
    readonly listTakes: (shotId: ShotId) => Promise<readonly Take[]>
    readonly requestReview: (takeId: TakeId) => Promise<unknown>
  }
  /** はい / いいえ を聞く。ワークベンチでは `window.confirm`。 */
  readonly confirm: (message: string) => boolean
  /** 結果を伝える。ワークベンチでは上端の知らせ。 */
  readonly notify: (message: string) => void
}

const askMessage = (count: number): string =>
  [
    `生成が終わりました（Take ${String(count)} 本）。`,
    '自動レビューを実行しますか？',
    '',
    '自動レビューは Take を見て、技術的な問題や曲との食い違いを指摘します。',
    'どの Take を採用するか決める材料になります。',
  ].join('\n')

/**
 * **まだレビューしていない Take だけ**を対象にする。すでに結果がある Take は頼み直さない。
 * 対象が無ければ聞かない（何も起きないのに「実行しますか？」と聞くのは嘘になる）。
 */
export const offerReviewAfterGeneration = async ({
  shotIds,
  api,
  confirm,
  notify,
}: OfferReviewDeps): Promise<void> => {
  const lists = await Promise.all(shotIds.map((shotId) => api.listTakes(shotId)))
  const pending = lists.flat().filter((take) => take.reviewStatus === 'pending')
  if (pending.length === 0) return

  if (!confirm(askMessage(pending.length))) {
    notify(REVIEW_LATER_GUIDANCE)
    return
  }

  try {
    await Promise.all(pending.map((take) => api.requestReview(take.id)))
    notify(
      `${String(pending.length)} 本の自動レビューを始めました。結果は「Take 比較」の Take 一覧に出ます。`,
    )
  } catch (error) {
    notify(`自動レビューを始められませんでした: ${describeError(error)}`)
  }
}
