/**
 * `.env` の**空欄にだけ**値を入れる（純粋関数）。
 *
 * seed が作った Workspace の ID を `NEXT_PUBLIC_WORKSPACE_ID=` に書くために使う。
 * まっさらな clone で README どおりに進めると、seed は ID を 1 行出すだけで、
 * どこに書けばよいか分からず、一覧が「設定が不足しています」で止まっていた。
 *
 * - 空の行（`KEY=`）があるときだけ入れる。値の入った行は**決して上書きしない**
 * - 行が無ければ足さない（`.env.example` から作った `.env` を前提にする）
 * - 変えなかったときは `null`。呼び出し側は書き込まずに案内だけ出す
 */
export const fillEmptyEnvValue = (content: string, key: string, value: string): string | null => {
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=[ \\t]*$`, 'm')
  if (!pattern.test(content)) return null
  return content.replace(pattern, `${key}=${value}`)
}
