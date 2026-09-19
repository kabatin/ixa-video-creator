/** ネットワーク到達失敗を表す擬似ステータス。HTTP ステータスとは衝突しない値を使う。 */
export const TRANSPORT_ERROR_STATUS = 0

/**
 * API 呼び出しの失敗。原因を握り潰さず、ステータスと本文を必ず保持する。
 */
export class ApiError extends Error {
  readonly status: number
  readonly body: string

  constructor(message: string, status: number, body: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }

  get isTransportError(): boolean {
    return this.status === TRANSPORT_ERROR_STATUS
  }
}

export const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 人に見せる言い方（PHASE 8）。**URL や JSON をそのまま画面に出さない。**
 * API の本文が `{ error, fields }` なら「検証に失敗しました（値: category=color では value が必須です）」の形にする。
 * 読めなければ `describeError` に倒す（理由を黙って消さない）。
 */
export const describeForPerson = (error: unknown): string => {
  if (!(error instanceof ApiError)) return describeError(error)
  if (error.isTransportError) return 'API に接続できません。起動しているか確認してください。'
  try {
    const body = JSON.parse(error.body) as unknown
    if (typeof body !== 'object' || body === null) return describeError(error)
    const record = body as { error?: unknown; fields?: unknown }
    const head = typeof record.error === 'string' ? record.error : `HTTP ${String(error.status)}`
    const fields =
      typeof record.fields === 'object' && record.fields !== null
        ? Object.entries(record.fields as Record<string, unknown>)
            .flatMap(([name, messages]) =>
              Array.isArray(messages)
                ? messages
                    .filter((m): m is string => typeof m === 'string')
                    .map((m) => `${name}: ${m}`)
                : [],
            )
            .join(' / ')
        : ''
    return fields === '' ? head : `${head}（${fields}）`
  } catch {
    return describeError(error)
  }
}
