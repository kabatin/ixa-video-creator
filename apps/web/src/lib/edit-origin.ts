import type { ProjectEvent } from '@ixa/domain'

/**
 * 書いた画面の印（`project.edited` の `origin`。2026-10-30）。
 *
 * API は作品を書き換えるたびに `project.edited` を流す。MCP（外のエージェント）や別の画面の書き込みは
 * 読み直して出すが、**自分の書き込みは読み直さない**（保存した部品が自分で反映している。読み直すと二度手間になる）。
 * そのために画面ごとの印を書き込みのヘッダに付け、API がそれを出来事に載せて返す。
 */

/** API の `PROJECT_EDIT_ORIGIN_HEADER` と同じ名前。 */
export const EDIT_ORIGIN_HEADER = 'x-ixa-client'

const ORIGIN_BYTES = 12

/**
 * 新しい印。**`crypto.randomUUID` は使わない**（LAN の http では安全な文脈でなく、無い）。
 * `getRandomValues` はどの文脈にもある。
 */
export const newEditOrigin = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(ORIGIN_BYTES))
  return `tab_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

/** この画面（タブ）の印。最初に要ったときに作る。サーバ側では null（印を付けない）。 */
const tab: { origin: string | null } = { origin: null }
export const browserEditOrigin = (): string | null => {
  if (typeof window === 'undefined') return null
  if (tab.origin === null) tab.origin = newEditOrigin()
  return tab.origin
}

/** 外の書き込みか（読み直すか）。印の無い書き込み（MCP・エージェント）は必ず外。 */
export const isForeignEdit = (event: ProjectEvent, own: string | null): boolean =>
  event.type === 'project.edited' && (event.origin === null || event.origin !== own)
