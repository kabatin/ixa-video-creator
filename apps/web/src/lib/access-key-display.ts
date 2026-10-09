import type { WireAccessToken } from '@/lib/auth-api'

/** アクセス用の鍵の画面の言葉（認証。2026-10-09）。 */

const formatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/** 日時。無ければ「—」（「使っていない」を空欄にすると読めないので記号で言う）。 */
export const formatWhen = (iso: string | null): string => (iso === null ? '—' : formatter.format(new Date(iso)))

/** 鍵の状態。**取り消したものも一覧に残す**（いつ止めたかを見られるように）。 */
export const accessKeyState = (token: Pick<WireAccessToken, 'revokedAt'>): '使える' | '取り消し済み' =>
  token.revokedAt === null ? '使える' : '取り消し済み'
