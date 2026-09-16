import type { CharacterId } from '@ixa/domain'

/** キャラクターライブラリ内のリンク生成をここへ集約する。 */
export const CHARACTER_LIST_HREF = '/characters'

export const NEW_CHARACTER_HREF = '/characters/new'

export const characterDetailHref = (id: CharacterId): string =>
  `${CHARACTER_LIST_HREF}/${encodeURIComponent(id)}`
