/**
 * 解析サービス呼び出しのエラー。
 * 「サービスに届かなかった」「サービスが失敗を返した」「応答の形が違った」を
 * 呼び出し側が区別してリトライ方針を決められるよう、型で分ける（CLAUDE.md 規約 5）。
 */
export class MusicAnalyzerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'MusicAnalyzerError'
  }
}

/** サービスへ接続できなかった。未起動・ネットワーク断・タイムアウトなど。リトライの価値がある。 */
export class MusicAnalyzerConnectionError extends MusicAnalyzerError {
  constructor(
    readonly url: string,
    options?: { cause?: unknown },
  ) {
    super(`音楽解析サービスへ接続できませんでした: ${url}`, options)
    this.name = 'MusicAnalyzerConnectionError'
  }
}

/** サービスは応答したが解析に失敗した。同じ入力で再試行しても同じ結果になる。 */
export class MusicAnalyzerResponseError extends MusicAnalyzerError {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`音楽解析に失敗しました [HTTP ${String(status)}]: ${detail}`)
    this.name = 'MusicAnalyzerResponseError'
  }
}

/** 応答の形が想定と違う。サービスとクライアントのバージョン不整合を疑う。 */
export class MusicAnalyzerSchemaError extends MusicAnalyzerError {
  constructor(
    readonly issues: string,
    options?: { cause?: unknown },
  ) {
    super(`音楽解析サービスの応答が不正です: ${issues}`, options)
    this.name = 'MusicAnalyzerSchemaError'
  }
}
