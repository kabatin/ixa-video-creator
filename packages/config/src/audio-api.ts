import type { Env } from './schema.js'

/**
 * 声と文字起こしの外部 API の設定の食い違いを起動時に止める（ADR-0038）。
 * 使うと書いたのに鍵が無いと、声にするたびに失敗する。それを押す前に、起動した時点で知らせる。
 * **値（鍵）は文に入れない。**
 */
const KEY_OF = { gemini_api: 'GEMINI_API_KEY', elevenlabs: 'ELEVENLABS_API_KEY' } as const

export const audioApiProblem = (env: Env): string | null => {
  const missing = env.AUDIO_API_PROVIDERS.filter((provider) => env[KEY_OF[provider]] === undefined)
  if (missing.length === 0) return null
  const keys = missing.map((provider) => KEY_OF[provider]).join('・')
  return `AUDIO_API_PROVIDERS に書いた API の鍵（${keys}）が設定されていません。鍵を .env に入れるか、使わないなら AUDIO_API_PROVIDERS から外して再起動してください。`
}
