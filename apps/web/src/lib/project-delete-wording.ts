import { deleteConfirmMessage } from '@/lib/wording'

/**
 * プロジェクトを消す前に言うこと。設定画面の「プロジェクトの削除」と作品一覧の「削除…」が同じ文を使う
 * （制作者 2026-10-04「プロジェクト一覧でプロジェクト削除出来るようにしてほしい」）。
 */

/** 消えるもの。キャラクターなどもプロジェクトごとなので一緒に見えなくなる（ADR-0034）。 */
export const PROJECT_DELETE_LOSSES: readonly string[] = [
  'すべての Shot と、その生成結果（Take）',
  'ストーリーボード・タイムライン・トランジション',
  '登録した楽曲と解析結果',
  'レンダリング結果',
  'このプロジェクトのキャラクター・ロケーション・ブランド資産',
  '声と、ナレーションの原稿・作った声',
]

export const PROJECT_DELETE_NOTE =
  'キャラクター・ロケーション・ブランド資産も見えなくなります（プロジェクトごとのものなので）。' +
  'ほかのプロジェクトで使うなら、先にそちらで「ほかのプロジェクトから取り込む」をしておいてください。'

/** 消すかの 1 文目。 */
export const projectDeleteHeadline = (name: string): string => deleteConfirmMessage(`プロジェクト「${name}」`)

/** 1 つの段落にまとめた確認（右クリックのメニューの確認は文を 1 つ受け取るため）。 */
export const projectDeleteConfirmMessage = (name: string): string =>
  `${projectDeleteHeadline(name)}消えるもの: ${PROJECT_DELETE_LOSSES.join('、')}。${PROJECT_DELETE_NOTE}`
