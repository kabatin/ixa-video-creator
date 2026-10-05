import { describe, expect, it } from 'vitest'
import { describeEnvironment } from '../environment-status.js'
import { loadConfig } from '../load.js'

/**
 * 声と文字起こしの AI の設定（ADR-0038）。**鍵の有無で切り替えない。**
 * 原稿が外に出る・お金が掛かるので、`AUDIO_API_PROVIDERS` に書いた外部 API だけを選べる。
 */

const requiredEnv: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/ixa',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'ixa-media',
  S3_ACCESS_KEY_ID: 'access-key-id',
  S3_SECRET_ACCESS_KEY: 'super-secret-access-key',
}

const GEMINI_KEY = 'gemini-secret-key-0123456789'
const ELEVEN_KEY = 'eleven-secret-key-0123456789'

describe('声と文字起こしの AI', () => {
  it('既定: 外部 API は使わない・鍵は未設定・Gemini は無料枠・ElevenLabs は 1000 字 $0.08・whisper のモデルは未設定', () => {
    expect(loadConfig(requiredEnv).voiceAi).toEqual({
      apiProviders: [],
      geminiApiKey: null,
      elevenLabsApiKey: null,
      geminiBilling: 'free',
      elevenLabsUsdPer1kChars: 0.08,
      whisperCppModel: null,
    })
  })

  it('鍵を置いただけでは使えるようにならない', () => {
    const config = loadConfig({ ...requiredEnv, GEMINI_API_KEY: GEMINI_KEY, ELEVENLABS_API_KEY: ELEVEN_KEY })
    expect(config.voiceAi.apiProviders).toEqual([])
    expect(config.voiceAi.geminiApiKey).toBe(GEMINI_KEY)
  })

  it('AUDIO_API_PROVIDERS はカンマ区切り（空白・空の項目は無視）。知らない名前は弾く', () => {
    const config = loadConfig({
      ...requiredEnv,
      AUDIO_API_PROVIDERS: ' gemini_api , elevenlabs ,',
      GEMINI_API_KEY: GEMINI_KEY,
      ELEVENLABS_API_KEY: ELEVEN_KEY,
    })
    expect(config.voiceAi.apiProviders).toEqual(['gemini_api', 'elevenlabs'])
    expect(() => loadConfig({ ...requiredEnv, AUDIO_API_PROVIDERS: 'openai' })).toThrow(/AUDIO_API_PROVIDERS/)
  })

  it('使うと書いたのに鍵が無ければ起動時に止める（どの変数かを言い、値は入れない）', () => {
    expect(() => loadConfig({ ...requiredEnv, AUDIO_API_PROVIDERS: 'gemini_api' })).toThrow(/GEMINI_API_KEY/)
    expect(() => loadConfig({ ...requiredEnv, AUDIO_API_PROVIDERS: 'elevenlabs', ELEVENLABS_API_KEY: ' ' })).toThrow(
      /ELEVENLABS_API_KEY/,
    )
  })

  it('Gemini の課金は free か paid、ElevenLabs の単価は 0 以上', () => {
    expect(loadConfig({ ...requiredEnv, GEMINI_API_BILLING: 'paid' }).voiceAi.geminiBilling).toBe('paid')
    expect(() => loadConfig({ ...requiredEnv, GEMINI_API_BILLING: 'pro' })).toThrow(/GEMINI_API_BILLING/)
    expect(loadConfig({ ...requiredEnv, ELEVENLABS_USD_PER_1K_CHARS: '0.022' }).voiceAi.elevenLabsUsdPer1kChars).toBe(0.022)
    expect(() => loadConfig({ ...requiredEnv, ELEVENLABS_USD_PER_1K_CHARS: '-1' })).toThrow(/ELEVENLABS_USD_PER_1K_CHARS/)
  })

  it('whisper.cpp のモデルは絶対パスだけ受ける', () => {
    expect(loadConfig({ ...requiredEnv, WHISPER_CPP_MODEL: '/models/ggml-large-v3-turbo.bin' }).voiceAi.whisperCppModel).toBe(
      '/models/ggml-large-v3-turbo.bin',
    )
    expect(() => loadConfig({ ...requiredEnv, WHISPER_CPP_MODEL: 'models/ggml.bin' })).toThrow(/WHISPER_CPP_MODEL/)
  })

  it('環境の一覧に Gemini と ElevenLabs の鍵が出る（値は出さない）', () => {
    const status = describeEnvironment(loadConfig({ ...requiredEnv, GEMINI_API_KEY: GEMINI_KEY }))
    const names = status.secrets.map((secret) => secret.envName)
    expect(names).toContain('GEMINI_API_KEY')
    expect(names).toContain('ELEVENLABS_API_KEY')
    expect(JSON.stringify(status)).not.toContain(GEMINI_KEY)
  })
})
