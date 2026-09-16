/** リポジトリが対象行を見つけられなかったときに投げる。呼び出し側は 404 等へ変換する。 */
export class DbNotFoundError extends Error {
  override readonly name = 'DbNotFoundError'
  constructor(
    readonly entity: string,
    readonly id: string,
  ) {
    super(`${entity} が見つかりません: ${id}`)
  }
}
