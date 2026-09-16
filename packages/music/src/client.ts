import {
  MusicAnalyzerConnectionError,
  MusicAnalyzerResponseError,
  MusicAnalyzerSchemaError,
} from './errors.js'
import { AnalyzeResponseWire, toMusicAnalysisResult, type MusicAnalysisResult } from './schema.js'

export type MusicAnalyzer = {
  /** サービスが応答するか。接続できない場合は例外ではなく `false` を返す（それが健全性の答えのため）。 */
  health(): Promise<boolean>
  /**
   * 音声を解析する。`audioPath` はサービスの `AUDIO_ROOT` から見たパス。
   * ファイルの転送は行わない（同一ホストで動く前提）。
   */
  analyze(audioPath: string): Promise<MusicAnalysisResult>
}

/**
 * `apps/audio` のクライアント。
 * 応答は必ず zod で検証してから返し、接続失敗と解析失敗を別の例外として投げ分ける。
 */
export const createMusicAnalyzer = (baseUrl: string): MusicAnalyzer => {
  const root = baseUrl.replace(/\/+$/, '')

  const health = async (): Promise<boolean> => {
    const url = `${root}/health`
    try {
      const response = await fetch(url, { method: 'GET' })
      if (!response.ok) return false
      const body: unknown = await response.json()
      return isOkStatus(body)
    } catch {
      // 接続できないこと自体が健全性の答えであり、握り潰しではない。
      return false
    }
  }

  const analyze = async (audioPath: string): Promise<MusicAnalysisResult> => {
    const url = `${root}/analyze`
    const response = await post(url, { audio_path: audioPath })

    if (!response.ok) {
      throw new MusicAnalyzerResponseError(response.status, await readDetail(response))
    }

    let body: unknown
    try {
      body = await response.json()
    } catch (cause) {
      throw new MusicAnalyzerSchemaError('JSON として解釈できませんでした', { cause })
    }

    const parsed = AnalyzeResponseWire.safeParse(body)
    if (!parsed.success) {
      throw new MusicAnalyzerSchemaError(formatIssues(parsed.error))
    }

    try {
      return toMusicAnalysisResult(parsed.data)
    } catch (cause) {
      throw new MusicAnalyzerSchemaError('ドメイン型へ変換できませんでした', { cause })
    }
  }

  return { health, analyze }
}

const post = async (url: string, payload: Readonly<Record<string, string>>): Promise<Response> => {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (cause) {
    throw new MusicAnalyzerConnectionError(url, { cause })
  }
}

const isOkStatus = (body: unknown): boolean => {
  if (typeof body !== 'object' || body === null || !('status' in body)) return false
  return body.status === 'ok'
}

/** エラー応答から人が読める理由を取り出す。本文が読めなくても例外にしない。 */
const readDetail = async (response: Response): Promise<string> => {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'detail' in body) {
      if (typeof body.detail === 'string') return body.detail
    }
    return JSON.stringify(body)
  } catch {
    return response.statusText || '理由不明'
  }
}

const formatIssues = (error: { issues: readonly { path: PropertyKey[]; message: string }[] }): string =>
  error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ')
