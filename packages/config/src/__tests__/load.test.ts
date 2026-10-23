import { homedir } from 'node:os'
import { beforeEach, describe, expect, it } from 'vitest'
import { getConfig, loadConfig, resetConfigCache } from '../load.js'
import { loopbackAssetUrlWarning } from '../storage.js'

const requiredEnv: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/ixa',
  REDIS_URL: 'redis://localhost:6379',
  // 置き場は既定が fs なので、署名の鍵まで揃って初めて「揃っている」env になる（ADR-0041）。
  STORAGE_SIGNING_SECRET: 'a'.repeat(32),
  // s3 に切り替える検査のために残す。fs では使われない。
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
    expect(config.storage.s3).toEqual({
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
    }
  })

  /**
   * `S3_*` は置き場が `s3` のときだけ要るので、zod の必須ではなくなった（ADR-0041）。
   * **要るのに無い場合は別の検査が止める**（`storageProblem`。下の「置き場」の describe で確かめている）。
   * ここでは、必須から外したことで**何も言わずに起動してしまわない**ことだけ押さえる。
   */
  it('S3_* が無くても、置き場が s3 なら起動しない', () => {
    expect(() =>
      loadConfig({ ...requiredEnv, STORAGE_DRIVER: 's3', S3_BUCKET: undefined }),
    ).toThrow(/S3_BUCKET/)
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

    expect(config.storage.s3?.forcePathStyle).toBe(true)
    expect(config.logLevel).toBe('info')
  })

  it('"false" 文字列が boolean の false になる', () => {
    const config = loadConfig({ ...requiredEnv, S3_FORCE_PATH_STYLE: 'false' })

    expect(config.storage.s3?.forcePathStyle).toBe(false)
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
 * ローカルの動画生成（ADR-0031）。**URL やトークンの有無で切り替えない。**
 */
/** vpipe-api と同じ規則（空白を含まない印字可能な ASCII を 32 文字以上）を満たすトークン。 */
const GOOD_TOKEN = 'vpipe_0123456789abcdefABCDEF-._~!'

describe('ローカルの動画生成（vpipe）', () => {
  /** 短い・空白や全角が混ざったトークンは、押したときの 401 ではなく起動時に止める。 */
  it('トークンの形が vpipe-api の規則に合わなければ起動時に止める（値は文に入れない）', () => {
    expect(GOOD_TOKEN.length).toBeGreaterThanOrEqual(32)
    const bad = [
      'short-token-31-chars-xxxxxxxxxx',
      'has space in the middle of token 0123456789',
      'zenkaku-ｔｏｋｅｎ-0123456789abcdefghij',
      'tab\tinside-0123456789abcdefghijklmnop',
    ]
    for (const token of bad) {
      const run = () =>
        loadConfig({ ...requiredEnv, LOCAL_VIDEO_GENERATOR: 'vpipe', VPIPE_API_TOKEN: token })
      expect(run).toThrow(/VPIPE_API_TOKEN の形が違います/)
      try {
        run()
      } catch (error) {
        expect(error instanceof Error ? error.message : '').not.toContain(token)
      }
    }
    expect(() =>
      loadConfig({ ...requiredEnv, LOCAL_VIDEO_GENERATOR: 'vpipe', VPIPE_API_TOKEN: GOOD_TOKEN }),
    ).not.toThrow()
  })

  it('32 文字ちょうどのトークンは受ける', () => {
    const token = 'a'.repeat(32)
    expect(loadConfig({ ...requiredEnv, VPIPE_API_TOKEN: token }).providers.vpipeApiToken).toBe(token)
    expect(() => loadConfig({ ...requiredEnv, VPIPE_API_TOKEN: 'a'.repeat(31) })).toThrow(
      /VPIPE_API_TOKEN/,
    )
  })

  it('既定は使わない。URL は既定でこのマシンだけ、トークンは未設定', () => {
    const config = loadConfig({ ...requiredEnv })
    expect(config.providers.localVideoGenerators).toEqual([])
    expect(config.providers.vpipeApiUrl).toBe('http://127.0.0.1:8765')
    expect(config.providers.vpipeApiToken).toBeNull()
    expect(config.providers.wanApiUrl).toBe('http://127.0.0.1:8766')
    expect(config.providers.wanApiToken).toBeNull()
  })

  it('トークンや URL を置いただけでは有効にならない', () => {
    const config = loadConfig({
      ...requiredEnv,
      VPIPE_API_URL: 'http://127.0.0.1:9999',
      VPIPE_API_TOKEN: GOOD_TOKEN,
      WAN_API_URL: 'http://127.0.0.1:9998',
      WAN_API_TOKEN: GOOD_TOKEN,
    })
    expect(config.providers.localVideoGenerators).toEqual([])
  })

  it('vpipe に切り替えられ、知らない値は弾く', () => {
    expect(
      loadConfig({ ...requiredEnv, LOCAL_VIDEO_GENERATOR: 'vpipe' }).providers.localVideoGenerators,
    ).toEqual(['vpipe'])
    expect(() => loadConfig({ ...requiredEnv, LOCAL_VIDEO_GENERATOR: 'comfy' })).toThrow(
      /LOCAL_VIDEO_GENERATOR/,
    )
  })

  /** ADR-0040。両方書けるのは、GPU の取り合いを worker が止めるという前提があるから。 */
  it('カンマ区切りで複数のサーバを有効にできる（空白は落とし、重複は 1 つにする）', () => {
    expect(
      loadConfig({ ...requiredEnv, LOCAL_VIDEO_GENERATOR: 'vpipe, wan' }).providers
        .localVideoGenerators,
    ).toEqual(['vpipe', 'wan'])
    expect(
      loadConfig({ ...requiredEnv, LOCAL_VIDEO_GENERATOR: 'wan,vpipe,wan' }).providers
        .localVideoGenerators,
    ).toEqual(['wan', 'vpipe'])
    expect(
      loadConfig({ ...requiredEnv, LOCAL_VIDEO_GENERATOR: 'wan' }).providers.localVideoGenerators,
    ).toEqual(['wan'])
  })

  it('空文字は「使わない」として扱う', () => {
    expect(
      loadConfig({ ...requiredEnv, LOCAL_VIDEO_GENERATOR: '' }).providers.localVideoGenerators,
    ).toEqual([])
    expect(
      loadConfig({ ...requiredEnv, LOCAL_VIDEO_GENERATOR: ' , ' }).providers.localVideoGenerators,
    ).toEqual([])
  })

  /** 「使わない」と「使う」を並べたら、どちらかを黙って採らずに止める。 */
  it('none をほかの値と並べたら弾く', () => {
    expect(() => loadConfig({ ...requiredEnv, LOCAL_VIDEO_GENERATOR: 'none,wan' })).toThrow(
      /LOCAL_VIDEO_GENERATOR/,
    )
    expect(() => loadConfig({ ...requiredEnv, LOCAL_VIDEO_GENERATOR: 'vpipe,none' })).toThrow(
      /LOCAL_VIDEO_GENERATOR/,
    )
  })

  /** 片方にしか検査が無いと、同じ設定ミスが wan では 401 になるまで分からない。 */
  it('wan も同じ規則で止める（形の違う合言葉・外のサーバでトークン無し・URL でない値）', () => {
    expect(() => loadConfig({ ...requiredEnv, WAN_API_TOKEN: 'a'.repeat(31) })).toThrow(
      /WAN_API_TOKEN の形が違います/,
    )
    expect(() => loadConfig({ ...requiredEnv, WAN_API_TOKEN: 'a'.repeat(32) })).not.toThrow()
    expect(() => loadConfig({ ...requiredEnv, WAN_API_URL: 'not-a-url' })).toThrow(/WAN_API_URL/)

    const remote = {
      ...requiredEnv,
      LOCAL_VIDEO_GENERATOR: 'wan',
      WAN_API_URL: 'http://192.168.1.21:8766',
    }
    expect(() => loadConfig(remote)).toThrow(/WAN_API_TOKEN/)
    try {
      loadConfig(remote)
    } catch (error) {
      expect(error instanceof Error ? error.message : '').not.toContain('192.168.1.21')
    }
    expect(() => loadConfig({ ...remote, WAN_API_TOKEN: GOOD_TOKEN })).not.toThrow()
  })

  /** 有効にしていないサーバの URL が外を指していても止めない（使わないので 401 にならない）。 */
  it('有効にしていないサーバの設定では止めない', () => {
    expect(() =>
      loadConfig({
        ...requiredEnv,
        LOCAL_VIDEO_GENERATOR: 'vpipe',
        WAN_API_URL: 'http://192.168.1.21:8766',
      }),
    ).not.toThrow()
  })

  it('トークンが空なら未設定として扱う', () => {
    expect(loadConfig({ ...requiredEnv, VPIPE_API_TOKEN: '  ' }).providers.vpipeApiToken).toBeNull()
    expect(loadConfig({ ...requiredEnv, VPIPE_API_TOKEN: GOOD_TOKEN }).providers.vpipeApiToken).toBe(
      GOOD_TOKEN,
    )
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
    expect(() => loadConfig({ ...env, VPIPE_API_TOKEN: GOOD_TOKEN })).not.toThrow()
  })

  it('使わない設定なら外の URL でも止めない', () => {
    expect(() => loadConfig({ ...requiredEnv, VPIPE_API_URL: 'http://192.168.1.20:8765' })).not.toThrow()
  })
})

describe('ローカルの画像生成（klein。ADR-0047）', () => {
  it('既定は使わない。URL は既定でこのマシンだけ、トークンは未設定', () => {
    const config = loadConfig({ ...requiredEnv })
    expect(config.providers.localImageGenerators).toEqual([])
    expect(config.providers.kleinApiUrl).toBe('http://127.0.0.1:8767')
    expect(config.providers.kleinApiToken).toBeNull()
  })

  it('klein に切り替えられ、動画のサーバや知らない値は弾く', () => {
    expect(
      loadConfig({ ...requiredEnv, LOCAL_IMAGE_GENERATOR: 'klein' }).providers.localImageGenerators,
    ).toEqual(['klein'])
    for (const value of ['vpipe', 'comfy', 'none,klein']) {
      expect(() => loadConfig({ ...requiredEnv, LOCAL_IMAGE_GENERATOR: value })).toThrow(
        /LOCAL_IMAGE_GENERATOR/,
      )
    }
  })

  it('画像のサーバを動画の一覧には書けない', () => {
    expect(() => loadConfig({ ...requiredEnv, LOCAL_VIDEO_GENERATOR: 'klein' })).toThrow(
      /LOCAL_VIDEO_GENERATOR/,
    )
  })

  it('トークンや URL を置いただけでは有効にならない', () => {
    const config = loadConfig({
      ...requiredEnv,
      KLEIN_API_URL: 'http://127.0.0.1:9997',
      KLEIN_API_TOKEN: GOOD_TOKEN,
    })
    expect(config.providers.localImageGenerators).toEqual([])
  })

  /** vpipe・wan と同じ表で検査する。klein だけ検査が無いと 401 まで分からない。 */
  it('vpipe・wan と同じ規則で止める（形の違う合言葉・外のサーバでトークン無し・URL でない値）', () => {
    expect(() => loadConfig({ ...requiredEnv, KLEIN_API_TOKEN: 'a'.repeat(31) })).toThrow(
      /KLEIN_API_TOKEN の形が違います/,
    )
    expect(() => loadConfig({ ...requiredEnv, KLEIN_API_URL: 'not-a-url' })).toThrow(/KLEIN_API_URL/)

    const remote = {
      ...requiredEnv,
      LOCAL_IMAGE_GENERATOR: 'klein',
      KLEIN_API_URL: 'http://192.168.1.22:8767',
    }
    expect(() => loadConfig(remote)).toThrow(/LOCAL_IMAGE_GENERATOR に klein があり.*KLEIN_API_TOKEN/)
    try {
      loadConfig(remote)
    } catch (error) {
      expect(error instanceof Error ? error.message : '').not.toContain('192.168.1.22')
    }
    expect(() => loadConfig({ ...remote, KLEIN_API_TOKEN: GOOD_TOKEN })).not.toThrow()
  })

  it('有効にしていなければ外の URL でも止めない', () => {
    expect(() =>
      loadConfig({ ...requiredEnv, KLEIN_API_URL: 'http://192.168.1.22:8767' }),
    ).not.toThrow()
  })
})

describe('ローカルの曲の生成（ace_step。ADR-0048）', () => {
  it('既定は使わない。URL は既定でこのマシンだけ、トークンは未設定', () => {
    const config = loadConfig({ ...requiredEnv })
    expect(config.providers.localMusicGenerators).toEqual([])
    expect(config.providers.aceStepApiUrl).toBe('http://127.0.0.1:8768')
    expect(config.providers.aceStepApiToken).toBeNull()
  })

  it('ace_step に切り替えられ、ほかのサーバや知らない値は弾く', () => {
    expect(
      loadConfig({ ...requiredEnv, LOCAL_MUSIC_GENERATOR: 'ace_step' }).providers.localMusicGenerators,
    ).toEqual(['ace_step'])
    for (const value of ['klein', 'vpipe', 'ace-step', 'none,ace_step']) {
      expect(() => loadConfig({ ...requiredEnv, LOCAL_MUSIC_GENERATOR: value })).toThrow(
        /LOCAL_MUSIC_GENERATOR/,
      )
    }
  })

  it('曲のサーバを画像・動画の一覧には書けない', () => {
    expect(() => loadConfig({ ...requiredEnv, LOCAL_IMAGE_GENERATOR: 'ace_step' })).toThrow(
      /LOCAL_IMAGE_GENERATOR/,
    )
    expect(() => loadConfig({ ...requiredEnv, LOCAL_VIDEO_GENERATOR: 'ace_step' })).toThrow(
      /LOCAL_VIDEO_GENERATOR/,
    )
  })

  it('トークンや URL を置いただけでは有効にならない', () => {
    const config = loadConfig({
      ...requiredEnv,
      ACE_STEP_API_URL: 'http://127.0.0.1:9996',
      ACE_STEP_API_TOKEN: GOOD_TOKEN,
    })
    expect(config.providers.localMusicGenerators).toEqual([])
  })

  /** vpipe・wan・klein と同じ表で検査する。ace_step だけ検査が無いと 401 まで分からない。 */
  it('ほかのサーバと同じ規則で止める（形の違う合言葉・外のサーバでトークン無し・URL でない値）', () => {
    expect(() => loadConfig({ ...requiredEnv, ACE_STEP_API_TOKEN: 'a'.repeat(31) })).toThrow(
      /ACE_STEP_API_TOKEN の形が違います/,
    )
    expect(() => loadConfig({ ...requiredEnv, ACE_STEP_API_URL: 'not-a-url' })).toThrow(/ACE_STEP_API_URL/)

    const remote = {
      ...requiredEnv,
      LOCAL_MUSIC_GENERATOR: 'ace_step',
      ACE_STEP_API_URL: 'http://192.168.1.22:8768',
    }
    expect(() => loadConfig(remote)).toThrow(/LOCAL_MUSIC_GENERATOR に ace_step があり.*ACE_STEP_API_TOKEN/)
    try {
      loadConfig(remote)
    } catch (error) {
      expect(error instanceof Error ? error.message : '').not.toContain('192.168.1.22')
    }
    expect(() => loadConfig({ ...remote, ACE_STEP_API_TOKEN: GOOD_TOKEN })).not.toThrow()
  })

  it('有効にしていなければ外の URL でも止めない', () => {
    expect(() =>
      loadConfig({ ...requiredEnv, ACE_STEP_API_URL: 'http://192.168.1.22:8768' }),
    ).not.toThrow()
  })
})

/** 書き出した動画を置くフォルダ（ADR-0036）。省略すれば null（API がホームの「ムービー」に決める）。 */
describe('書き出しフォルダ（RENDER_EXPORT_DIR）', () => {
  it('省略・空なら null', () => {
    expect(loadConfig(requiredEnv).renderExportDir).toBeNull()
    expect(loadConfig({ ...requiredEnv, RENDER_EXPORT_DIR: '  ' }).renderExportDir).toBeNull()
  })

  it('絶対パスならそのまま使う', () => {
    expect(loadConfig({ ...requiredEnv, RENDER_EXPORT_DIR: '/Volumes/外付け/書き出し' }).renderExportDir).toBe(
      '/Volumes/外付け/書き出し',
    )
  })

  it('相対パス・~ 始まりは起動時に止める（どこに書くかが動かし方で変わるため）', () => {
    expect(() => loadConfig({ ...requiredEnv, RENDER_EXPORT_DIR: 'exports' })).toThrow(/RENDER_EXPORT_DIR/)
    expect(() => loadConfig({ ...requiredEnv, RENDER_EXPORT_DIR: '~/Movies' })).toThrow(/RENDER_EXPORT_DIR/)
  })
})

/**
 * 置き場の設定（ADR-0041）。**既定は `fs`**（この機械のただのファイル）。
 */
describe('loadConfig の置き場（STORAGE_*）', () => {
  const SIGNING_SECRET = 'a'.repeat(32)

  it('既定は fs（この機械のただのファイル）', () => {
    expect(loadConfig({ ...requiredEnv }).storage.driver).toBe('fs')
  })

  it('fs にすると、この機械のフォルダを使う', () => {
    const config = loadConfig({
      ...requiredEnv,
      STORAGE_DRIVER: 'fs',
      STORAGE_SIGNING_SECRET: SIGNING_SECRET,
      STORAGE_DIR: '/tmp/ixa-storage',
    })

    expect(config.storage.driver).toBe('fs')
    expect(config.storage.root).toBe('/tmp/ixa-storage')
    expect(config.storage.signingSecret).toBe(SIGNING_SECRET)
  })

  it('STORAGE_DIR を省くとホームの下に決まる（API と worker で同じ場所になる）', () => {
    const config = loadConfig({
      ...requiredEnv,
      STORAGE_DRIVER: 'fs',
      STORAGE_SIGNING_SECRET: SIGNING_SECRET,
    })

    expect(config.storage.root).toBe(`${homedir()}/ixa-video-creator/storage`)
  })

  it('STORAGE_DIR は絶対パスだけ受ける', () => {
    expect(() =>
      loadConfig({
        ...requiredEnv,
        STORAGE_DRIVER: 'fs',
        STORAGE_SIGNING_SECRET: SIGNING_SECRET,
        STORAGE_DIR: 'relative/storage',
      }),
    ).toThrow(/STORAGE_DIR/)
  })

  it('署名の宛先を省くと API の待ち受けポートに従う', () => {
    const config = loadConfig({
      ...requiredEnv,
      STORAGE_DRIVER: 'fs',
      STORAGE_SIGNING_SECRET: SIGNING_SECRET,
      API_PORT: '4001',
    })

    expect(config.storage.publicBaseUrl).toBe('http://127.0.0.1:4001')
  })

  /**
   * 2026-10-07: 画面を LAN の別の端末から開くと、素材が 1 つも見えなくなった。
   * API は `macbookpro.local:3001` で呼ばれているのに、素材の URL だけ `127.0.0.1:3001` を
   * 指していたため（その端末の中を指してしまう）。**画面が API を呼ぶ場所と同じにする。**
   */
  it('画面から見た API の場所があれば、素材の URL もそこを指す', () => {
    const config = loadConfig({
      ...requiredEnv,
      STORAGE_DRIVER: 'fs',
      STORAGE_SIGNING_SECRET: SIGNING_SECRET,
      NEXT_PUBLIC_API_URL: 'http://macbookpro.local:3001',
    })

    expect(config.storage.publicBaseUrl).toBe('http://macbookpro.local:3001')
  })

  it('素材の URL の宛先を書けば、そちらが勝つ', () => {
    const config = loadConfig({
      ...requiredEnv,
      STORAGE_DRIVER: 'fs',
      STORAGE_SIGNING_SECRET: SIGNING_SECRET,
      NEXT_PUBLIC_API_URL: 'http://macbookpro.local:3001',
      STORAGE_PUBLIC_BASE_URL: 'http://192.168.0.42:3001',
    })

    expect(config.storage.publicBaseUrl).toBe('http://192.168.0.42:3001')
  })

  /** 署名の鍵が無いまま fs で起動すると、素材を 1 つも返せない。**使う瞬間まで持ち越さない。** */
  it('fs で署名の鍵が無ければ起動しない', () => {
    const env = { ...requiredEnv }
    delete env.STORAGE_SIGNING_SECRET

    expect(() => loadConfig(env)).toThrow(/STORAGE_SIGNING_SECRET/)
  })

  /** 制約を足したら、それを破る値の検査も置く（短い鍵は署名があるのに破れる）。 */
  it('fs で署名の鍵が 32 文字未満なら起動しない', () => {
    expect(() =>
      loadConfig({
        ...requiredEnv,
        STORAGE_DRIVER: 'fs',
        STORAGE_SIGNING_SECRET: 'a'.repeat(31),
      }),
    ).toThrow(/STORAGE_SIGNING_SECRET/)
  })

  it('署名の鍵はエラーの文に出ない', () => {
    try {
      loadConfig({ ...requiredEnv, STORAGE_DRIVER: 'fs', STORAGE_SIGNING_SECRET: 'short-secret' })
      expect.unreachable('throw するはず')
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).not.toContain('short-secret')
    }
  })

  it.each(['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])(
    's3 なのに %s が無ければ起動しない',
    (name) => {
      const env: NodeJS.ProcessEnv = { ...requiredEnv, STORAGE_DRIVER: 's3' }
      delete env[name]

      expect(() => loadConfig(env)).toThrow(new RegExp(name))
    },
  )

  it('fs なら S3_* は要らない', () => {
    const config = loadConfig({
      DATABASE_URL: requiredEnv.DATABASE_URL,
      REDIS_URL: requiredEnv.REDIS_URL,
      STORAGE_DRIVER: 'fs',
      STORAGE_SIGNING_SECRET: SIGNING_SECRET,
    })

    expect(config.storage.s3).toBeNull()
  })
})

/**
 * 外から使える形なのに素材の URL だけ手元を指している、という形を見つける（2026-10-07 に実際に起きた）。
 * **止めはしない。** 手元だけで使うなら正しい設定なので、言葉で残すだけにする。
 */
describe('loopbackAssetUrlWarning', () => {
  it('外に出していて素材だけ手元を指していたら知らせる', () => {
    expect(loopbackAssetUrlWarning('0.0.0.0', 'http://127.0.0.1:3001')).toContain('ほかの端末')
  })

  it.each([
    { name: 'どちらも外向き', host: '0.0.0.0', url: 'http://macbookpro.local:3001' },
    { name: 'どちらも手元', host: '127.0.0.1', url: 'http://127.0.0.1:3001' },
    { name: '手元だけで使う（素材の宛先が外向きでも口が開いていない）', host: 'localhost', url: 'http://macbookpro.local:3001' },
  ])('$name なら知らせない', ({ host, url }) => {
    expect(loopbackAssetUrlWarning(host, url)).toBeNull()
  })
})

/** 認証（2026-10-09）。合言葉は API だけが使う。worker は持たなくても起動する。 */
describe('合言葉（IXA_PASSPHRASE）', () => {
  it('書けば API の設定に入る', () => {
    expect(loadConfig({ ...requiredEnv, IXA_PASSPHRASE: 'correct horse battery' }).api.passphrase).toBe(
      'correct horse battery',
    )
  })

  it('書かなければ null（設定の読み込みは止めない。止めるのは API の起動）', () => {
    expect(loadConfig({ ...requiredEnv }).api.passphrase).toBeNull()
    expect(loadConfig({ ...requiredEnv, IXA_PASSPHRASE: '   ' }).api.passphrase).toBeNull()
  })

  it('12 文字より短い合言葉は受けない', () => {
    // 理由の文は他の鍵と同じく「不正な値」にまとめて出る（値そのものは出さない）。
    expect(() => loadConfig({ ...requiredEnv, IXA_PASSPHRASE: 'short-11ch' })).toThrow(/IXA_PASSPHRASE/)
  })
})

describe('ローカルの効果音の生成（sfx_api。ADR-0052）', () => {
  it('既定は使わない。URL は既定でこのマシンの 8769、トークンは未設定', () => {
    const config = loadConfig({ ...requiredEnv })
    expect(config.providers.localSfxGenerators).toEqual([])
    expect(config.providers.sfxApiUrl).toBe('http://127.0.0.1:8769')
    expect(config.providers.sfxApiToken).toBeNull()
  })

  it('sfx_api に切り替えられ、ほかのサーバや知らない値は弾く', () => {
    expect(loadConfig({ ...requiredEnv, LOCAL_SFX_GENERATOR: 'sfx_api' }).providers.localSfxGenerators).toEqual([
      'sfx_api',
    ])
    for (const value of ['ace_step', 'stable_audio_sfx', 'sfx-api', 'none,sfx_api']) {
      expect(() => loadConfig({ ...requiredEnv, LOCAL_SFX_GENERATOR: value })).toThrow(/LOCAL_SFX_GENERATOR/)
    }
    expect(() => loadConfig({ ...requiredEnv, LOCAL_MUSIC_GENERATOR: 'sfx_api' })).toThrow(/LOCAL_MUSIC_GENERATOR/)
  })

  it('トークンや URL を置いただけでは有効にならない', () => {
    const config = loadConfig({ ...requiredEnv, SFX_API_URL: 'http://127.0.0.1:9995', SFX_API_TOKEN: GOOD_TOKEN })
    expect(config.providers.localSfxGenerators).toEqual([])
  })

  it('ほかのサーバと同じ規則で止める（形の違う合言葉・外のサーバでトークン無し・URL でない値）', () => {
    expect(() => loadConfig({ ...requiredEnv, SFX_API_TOKEN: 'a'.repeat(31) })).toThrow(/SFX_API_TOKEN の形が違います/)
    expect(() => loadConfig({ ...requiredEnv, SFX_API_URL: 'not-a-url' })).toThrow(/SFX_API_URL/)
    const remote = { ...requiredEnv, LOCAL_SFX_GENERATOR: 'sfx_api', SFX_API_URL: 'http://192.168.1.23:8769' }
    expect(() => loadConfig(remote)).toThrow(/LOCAL_SFX_GENERATOR に sfx_api があり.*SFX_API_TOKEN/)
    expect(() => loadConfig({ ...remote, SFX_API_TOKEN: GOOD_TOKEN })).not.toThrow()
  })
})

/** 作った画像を自動でやり直す上限（ADR-0055）。手元の GPU を占有しないよう、上限の上限を置く。 */
describe('IMAGE_CHECK_MAX_RETRIES', () => {
  it('既定は 2。0〜5 の整数だけ受ける', () => {
    expect(loadConfig(requiredEnv).imageCheckMaxRetries).toBe(2)
    expect(loadConfig({ ...requiredEnv, IMAGE_CHECK_MAX_RETRIES: '0' }).imageCheckMaxRetries).toBe(0)
    expect(loadConfig({ ...requiredEnv, IMAGE_CHECK_MAX_RETRIES: '5' }).imageCheckMaxRetries).toBe(5)
    expect(() => loadConfig({ ...requiredEnv, IMAGE_CHECK_MAX_RETRIES: '6' })).toThrow()
    expect(() => loadConfig({ ...requiredEnv, IMAGE_CHECK_MAX_RETRIES: '-1' })).toThrow()
    expect(() => loadConfig({ ...requiredEnv, IMAGE_CHECK_MAX_RETRIES: '1.5' })).toThrow()
  })
})

/**
 * 画像のチェックに使う Claude のモデル（ADR-0055 追記。制作者の了承 2026-10-19）。
 * 既定は**モデル ID**（claude-sonnet-5-5）。別名 `sonnet` は、この Mac の Claude Code の設定
 * （ANTHROPIC_DEFAULT_SONNET_MODEL）で Opus に向いていて、実測で Opus の単価のままだった。
 */
describe('IMAGE_CHECK_MODEL', () => {
  it('既定は Sonnet のモデル ID。別名やモデル ID を受ける', () => {
    expect(loadConfig(requiredEnv).imageCheckModel).toBe('claude-sonnet-5-5')
    expect(loadConfig({ ...requiredEnv, IMAGE_CHECK_MODEL: 'opus' }).imageCheckModel).toBe('opus')
    expect(loadConfig({ ...requiredEnv, IMAGE_CHECK_MODEL: 'claude-sonnet-5-5' }).imageCheckModel).toBe('claude-sonnet-5-5')
    expect(loadConfig({ ...requiredEnv, IMAGE_CHECK_MODEL: ' sonnet ' }).imageCheckModel).toBe('sonnet')
  })

  it('空・空白入り・記号入り・長すぎる値は受けない（CLI の引数に渡すため）', () => {
    for (const bad of ['', '   ', 'son net', 'sonnet;rm', '--model', 'a'.repeat(101)]) {
      expect(() => loadConfig({ ...requiredEnv, IMAGE_CHECK_MODEL: bad })).toThrow()
    }
  })
})

/**
 * 動きの分析に使う Claude のモデル（ADR-0054 追記。制作者の了承 2026-10-19）。
 * 画像のチェックと同じく、既定は Sonnet の**モデル ID**（別名 `sonnet` はこの Mac で Opus に向く）。
 */
describe('MOTION_ANALYSIS_MODEL', () => {
  it('既定は Sonnet のモデル ID。別名やモデル ID を受ける', () => {
    expect(loadConfig(requiredEnv).motionAnalysisModel).toBe('claude-sonnet-5-5')
    expect(loadConfig({ ...requiredEnv, MOTION_ANALYSIS_MODEL: 'claude-opus-5-5' }).motionAnalysisModel).toBe('claude-opus-5-5')
    expect(loadConfig({ ...requiredEnv, MOTION_ANALYSIS_MODEL: ' opus ' }).motionAnalysisModel).toBe('opus')
  })

  it('空・空白入り・記号入り・長すぎる値は受けない（CLI の引数に渡すため）', () => {
    for (const bad of ['', '   ', 'son net', 'sonnet;rm', '--model', 'a'.repeat(101)]) {
      expect(() => loadConfig({ ...requiredEnv, MOTION_ANALYSIS_MODEL: bad })).toThrow()
    }
  })
})

/**
 * AI エージェントのタブ（ADR-0058）の既定のモデル。画面で会話ごとに選び直せる。
 * **モデル ID だけを受ける。** 別名は設定によって別のモデルに向く（IMAGE_CHECK_MODEL の教訓）。
 */
describe('AGENT_MODEL_DEFAULT', () => {
  it('既定は Sonnet のモデル ID。ほかのモデル ID も受ける', () => {
    expect(loadConfig(requiredEnv).agentModelDefault).toBe('claude-sonnet-5-5')
    expect(loadConfig({ ...requiredEnv, AGENT_MODEL_DEFAULT: 'claude-opus-5-5' }).agentModelDefault).toBe('claude-opus-5-5')
  })

  it('別名・空・空白入り・記号入り・長すぎる値は受けない（CLI の引数に渡すため）', () => {
    for (const bad of ['sonnet', 'opus', '', '   ', 'claude son', 'claude-x;rm', '--model', `claude-${'a'.repeat(100)}`]) {
      expect(() => loadConfig({ ...requiredEnv, AGENT_MODEL_DEFAULT: bad }), bad).toThrow()
    }
  })
})
