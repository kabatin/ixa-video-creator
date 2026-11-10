/**
 * 日時の表示を 1 箇所に集める（`2026/11/10 14:02`）。以前は同じ設定の書式が 4 か所に書き写されていた。
 *
 * **言語と時間帯を決め打ちにする（ja-JP・東京）。** 閲覧側の時間帯に任せると、サーバで組んだ文字列と
 * 画面で組み直した文字列が食い違う（作品一覧のカードは両方で描く）。決め打ちなのでどちらでも同じ文字列になる。
 */
const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export const formatDateTime = (at: Date): string => dateTimeFormatter.format(at)
