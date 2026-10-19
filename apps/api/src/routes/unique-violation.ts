/**
 * PostgreSQL の一意制約違反かどうか。
 * **エラーの型で判定せず code で見る。** drizzle は driver の例外を包んで投げるため、
 * instanceof では捕まえられない（実際に包まれていることを確認済み）。
 */
export const isUniqueViolation = (error: unknown): boolean => {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current)
    if (typeof current === 'object' && 'code' in current && current.code === '23505') return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}
