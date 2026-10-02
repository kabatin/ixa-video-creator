import type { CharacterId } from '@ixa/domain'

/**
 * キャラクターの詳しい編集画面（同一性・識別画像・Look）へのリンク。
 * 一覧と新規作成の画面は無い（キャラクターはプロジェクトごとで、素材ツリーで作る。ADR-0034）。
 */
export const characterDetailHref = (id: CharacterId): string => `/characters/${encodeURIComponent(id)}`
