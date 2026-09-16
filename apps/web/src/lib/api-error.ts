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
