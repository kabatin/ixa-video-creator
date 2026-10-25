/**
 * 一意制約の違反（postgres の 23505）か。drizzle は元の例外を `cause` に包むので、たどって探す。
 */
export const isUniqueViolation = (error: unknown): boolean => {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current)
    if ('code' in current && current.code === '23505') return true
    current = 'cause' in current ? current.cause : undefined
  }
  return false
}
