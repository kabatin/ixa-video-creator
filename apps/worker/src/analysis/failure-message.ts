import { MusicAnalyzerConnectionError, MusicAnalyzerResponseError } from '@ixa/music'

/**
 * 解析の失敗を、利用者に見せる文へ直す（純粋関数）。
 *
 * **URL・ポート・例外の本文は入れない**（CLAUDE.md「画面に出さない」）。
 * それらはログにだけ残す。ここは「何が起きたか」と「次に何をするか」だけを言う。
 */
export const analysisFailureMessage = (error: unknown): string => {
  if (error instanceof MusicAnalyzerConnectionError) {
    return '曲を解析するサービスに接続できませんでした。解析サービスが起動しているか確かめてから、もう一度解析してください。'
  }
  if (error instanceof MusicAnalyzerResponseError) {
    return 'この曲を解析できませんでした。対応していない形式か、ファイルが壊れている可能性があります。'
  }
  if (error instanceof Error && error.name === 'ObjectNotFoundError') {
    return '曲のファイルが見つかりませんでした。曲をもう一度登録してください。'
  }
  return '曲の解析に失敗しました。もう一度解析してください。'
}
