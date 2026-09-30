import { beforeEach, describe, expect, it } from 'vitest'
import { getConfig, loadConfig, resetConfigCache } from '../load.js'

const requiredEnv: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/ixa',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'ixa-media',
  S3_ACCESS_KEY_ID: 'access-key-id',
  S3_SECRET_ACCESS_KEY: 'super-secret-access-key',
}

describe('loadConfig', () => {
  it('必須変数が揃っていれば正しくパースされ、ネスト構造で返る', () => {
    const config = loadConfig({ ...requiredEnv })

    expect(config.database.url).toBe(requiredEnv.DATABASE_URL)
    expect(config.redis.url).toBe(requiredEnv.REDIS_URL)
    expect(config.s3).toEqual({
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'ixa-media',
      accessKeyId: 'access-key-id',
      secretAccessKey: 'super-secret-access-key',
      forcePathStyle: true,
    })
    expect(config.api.port).toBe(3001)
    expect(config.logLevel).toBe('info')
    expect(config.nodeEnv).toBe('development')
    expect(config.audio.url).toBe('http://127.0.0.1:8100')
    expect(config.providers.falApiKey).toBeNull()
  })

  it('必須変数が欠けていると throw し、メッセージに欠けた変数名が含まれる', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/)

    try {
      loadConfig({})
      throw new Error('loadConfig should have thrown')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).toContain('DATABASE_URL')
      expect(message).toContain('REDIS_URL')
      expect(message).toContain('S3_ENDPOINT')
      expect(message).toContain('S3_REGION')
      expect(message).toContain('S3_BUCKET')
      expect(message).toContain('S3_ACCESS_KEY_ID')
      expect(message).toContain('S3_SECRET_ACCESS_KEY')
    }
  })

  /**
   * 絵コンテの画像（ADR-0029）。**既定はスタブ。** `codex_cli` は手元の Codex CLI を呼び、
   * 契約の利用枠を使うので、明示的に切り替えたときだけ走らせる。
   */
  it('絵コンテの画像は既定でスタブ。codex_cli に切り替えられ、知らない値は弾く', () => {
    expect(loadConfig({ ...requiredEnv }).imageProvider).toBe('stub')
    expect(loadConfig({ ...requiredEnv, IMAGE_PROVIDER: 'codex_cli' }).imageProvider).toBe('codex_cli')
    expect(() => loadConfig({ ...requiredEnv, IMAGE_PROVIDER: 'openai' })).toThrow(/IMAGE_PROVIDER/)
  })

  it('既定値が効く: S3_FORCE_PATH_STYLE 未指定で true、LOG_LEVEL 未指定で info', () => {
    const config = loadConfig({ ...requiredEnv })

    expect(config.s3.forcePathStyle).toBe(true)
    expect(config.logLevel).toBe('info')
  })

  it('"false" 文字列が boolean の false になる', () => {
    const config = loadConfig({ ...requiredEnv, S3_FORCE_PATH_STYLE: 'false' })

    expect(config.s3.forcePathStyle).toBe(false)
  })

  it('API_PORT の "3001" が数値 3001 になる', () => {
    const config = loadConfig({ ...requiredEnv, API_PORT: '3001' })

    expect(config.api.port).toBe(3001)
    expect(typeof config.api.port).toBe('number')
  })

  it('不正な URL を渡すと throw する', () => {
    expect(() => loadConfig({ ...requiredEnv, DATABASE_URL: 'not-a-url' })).toThrow()
    expect(() => loadConfig({ ...requiredEnv, S3_ENDPOINT: 'not-a-url' })).toThrow()
  })

  it('エラーメッセージに秘密値が含まれない', () => {
    try {
      loadConfig({ ...requiredEnv, DATABASE_URL: 'not-a-url' })
      throw new Error('loadConfig should have thrown')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).not.toContain('not-a-url')
      expect(message).not.toContain(requiredEnv.S3_SECRET_ACCESS_KEY)
    }
  })
})

describe('getConfig', () => {
  beforeEach(() => {
    resetConfigCache()
  })

  it('getConfig がキャッシュされる（2回目の呼び出しでは env を再検証しない）', () => {
    const first = getConfig({ ...requiredEnv })
    const second = getConfig({ ...requiredEnv, API_PORT: '9999' })

    expect(second).toBe(first)
    expect(second.api.port).toBe(3001)
  })

  it('resetConfigCache でキャッシュが解除される', () => {
    getConfig({ ...requiredEnv, API_PORT: '3001' })
    resetConfigCache()

    const config = getConfig({ ...requiredEnv, API_PORT: '5555' })

    expect(config.api.port).toBe(5555)
  })
})

describe('空文字の任意変数', () => {
  it('FAL_API_KEY が空文字なら未設定として扱う', () => {
    const config = loadConfig({ ...requiredEnv, FAL_API_KEY: '' })
    expect(config.providers.falApiKey).toBeNull()
  })

  it('FAL_API_KEY が空白のみでも未設定として扱う', () => {
    const config = loadConfig({ ...requiredEnv, FAL_API_KEY: '   ' })
    expect(config.providers.falApiKey).toBeNull()
  })

  it('FAL_API_KEY に値があればそのまま読む', () => {
    const config = loadConfig({ ...requiredEnv, FAL_API_KEY: 'fal-key-123' })
    expect(config.providers.falApiKey).toBe('fal-key-123')
  })
})

/**
 * ローカルの動画生成（ADR-0030）。**URL やトークンの有無で切り替えない。**
 */
describe('ローカルの動画生成（vpipe）', () => {
  it('既定は使わない。URL は既定でこのマシンだけ、トークンは未設定', () => {
    const config = loadConfig({ ...requiredEnv })
    expect(config.providers.localVideoGenerator).toBe('none')
    expect(config.providers.vpipeApiUrl).toBe('http://127.0.0.1:8765')
    expect(config.providers.vpipeApiToken).toBeNull()
  })

  it('トークンや URL を置いただけでは有効にならない', () => {
    const config = loadConfig({
      ...requiredEnv,
      VPIPE_API_URL: 'http://127.0.0.1:9999',
      VPIPE_API_TOKEN: 'token',
    })
    expect(config.providers.localVideoGenerator).toBe('none')
  })

  it('vpipe に切り替えられ、知らない値は弾く', () => {
    expect(loadConfig({ ...requiredEnv, LOCAL_VIDEO_GENERATOR: 'vpipe' }).providers.localVideoGenerator).toBe(
      'vpipe',
    )
    expect(() => loadConfig({ ...requiredEnv, LOCAL_VIDEO_GENERATOR: 'comfy' })).toThrow(
      /LOCAL_VIDEO_GENERATOR/,
    )
  })

  it('トークンが空なら未設定として扱う', () => {
    expect(loadConfig({ ...requiredEnv, VPIPE_API_TOKEN: '  ' }).providers.vpipeApiToken).toBeNull()
    expect(loadConfig({ ...requiredEnv, VPIPE_API_TOKEN: 'tok' }).providers.vpipeApiToken).toBe('tok')
  })

  it('URL でないものは弾く', () => {
    expect(() => loadConfig({ ...requiredEnv, VPIPE_API_URL: 'not-a-url' })).toThrow(/VPIPE_API_URL/)
  })

  it('このマシンのサーバならトークン無しで起動できる', () => {
    for (const url of ['http://127.0.0.1:8765', 'http://localhost:8765', 'http://[::1]:8765', 'http://127.1.2.3:80']) {
      expect(() =>
        loadConfig({ ...requiredEnv, LOCAL_VIDEO_GENERATOR: 'vpipe', VPIPE_API_URL: url }),
      ).not.toThrow()
    }
  })

  /** サーバはループバック以外ではトークン必須。必ず 401 になる設定を、押す前に止める。 */
  it('外のサーバをトークン無しで指したら起動時に止める（値は文に入れない）', () => {
    const env = {
      ...requiredEnv,
      LOCAL_VIDEO_GENERATOR: 'vpipe',
      VPIPE_API_URL: 'http://192.168.1.20:8765',
    }
    expect(() => loadConfig(env)).toThrow(/VPIPE_API_TOKEN/)
    try {
      loadConfig(env)
    } catch (error) {
      expect(error instanceof Error ? error.message : '').not.toContain('192.168.1.20')
    }
    expect(() => loadConfig({ ...env, VPIPE_API_TOKEN: 'tok' })).not.toThrow()
  })

  it('使わない設定なら外の URL でも止めない', () => {
    expect(() => loadConfig({ ...requiredEnv, VPIPE_API_URL: 'http://192.168.1.20:8765' })).not.toThrow()
  })
})
