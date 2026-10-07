import { describe, expect, it } from 'vitest'
import { describeEnvironment } from '../environment-status.js'
import type { AppConfig } from '../schema.js'

/**
 * 画面へ出す環境の状態。
 *
 * **秘密の値が混ざらないことが最優先。** API は無認証で全インターフェースに
 * 待ち受けている（`TCP *:3001`）ので、ここに値が入ると同じ網にいる誰でも
 * 課金される鍵を読める。規約 6 が env に限っている理由そのもの。
 */

const SECRET = 'fal-live-SUPERSECRET-0123456789'

/** ローカルの動画生成（ADR-0031 / 0040）の既定。どちらのサーバも使わない。 */
const LOCAL_VIDEO_OFF = {
  localVideoGenerators: [],
  vpipeApiUrl: 'http://127.0.0.1:8765',
  vpipeApiToken: null,
  wanApiUrl: 'http://127.0.0.1:8766',
  wanApiToken: null,
} as const

const aConfig = (overrides: Partial<AppConfig> = {}): AppConfig =>
  ({
    database: { url: 'postgres://x' },
    redis: { url: 'redis://x' },
    storage: {
      driver: 's3',
      root: '/tmp/ixa-storage',
      publicBaseUrl: 'http://127.0.0.1:3001',
      signingSecret: null,
      s3: {
        endpoint: 'http://s3',
        region: 'ap-northeast-1',
        bucket: 'ixa',
        accessKeyId: 'AKIA-SECRET-ID',
        secretAccessKey: 'S3-SUPERSECRET',
        forcePathStyle: true,
      },
    },
    api: { port: 3001, host: '127.0.0.1' },
    corsOrigins: [],
    audio: { url: 'http://audio' },
    storyboardDrafter: 'stub',
    imageProvider: 'stub',
    logLevel: 'info',
    nodeEnv: 'development',
    providers: {
      falApiKey: SECRET,
      stubVideoFailureRate: 0,
      stubVideoCostPerSecUsd: 0,
      videoProvider: 'stub',
      ...LOCAL_VIDEO_OFF,
    },
    renderExportDir: null,
    voiceAi: {
      apiProviders: [],
      geminiApiKey: null,
      elevenLabsApiKey: null,
      geminiBilling: 'free',
      elevenLabsUsdPer1kChars: 0.08,
      whisperCppModel: null,
    },
    ...overrides,
  })

/** 出力のどこかに秘密が混ざっていないか、丸ごと文字列にして探す。 */
const serialized = (config: AppConfig): string => JSON.stringify(describeEnvironment(config))

describe('describeEnvironment', () => {
  it('秘密の値をどこにも含めない', () => {
    const text = serialized(aConfig())
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain('S3-SUPERSECRET')
    expect(text).not.toContain('AKIA-SECRET-ID')
  })

  /** 下 4 桁も出さない。鍵の一部でも HTTP に乗せない。 */
  it('鍵の断片も含めない', () => {
    const text = serialized(aConfig())
    expect(text).not.toContain(SECRET.slice(-4))
    expect(text).not.toContain(SECRET.slice(0, 8))
  })

  it('設定されているかと文字数は出す（貼り漏れが分かる）', () => {
    const fal = describeEnvironment(aConfig()).secrets.find((s) => s.envName === 'FAL_API_KEY')
    expect(fal?.configured).toBe(true)
    expect(fal?.length).toBe(SECRET.length)
  })

  it('未設定なら文字数を出さない（0 と書かない）', () => {
    const config = aConfig({
      providers: { falApiKey: null, stubVideoFailureRate: 0, stubVideoCostPerSecUsd: 0, videoProvider: 'stub', ...LOCAL_VIDEO_OFF },
    })
    const fal = describeEnvironment(config).secrets.find((s) => s.envName === 'FAL_API_KEY')
    expect(fal?.configured).toBe(false)
    expect(fal?.length).toBeNull()
  })

  it('空白だけの値は未設定として扱う', () => {
    const config = aConfig({
      providers: { falApiKey: '   ', stubVideoFailureRate: 0, stubVideoCostPerSecUsd: 0, videoProvider: 'stub', ...LOCAL_VIDEO_OFF },
    })
    const fal = describeEnvironment(config).secrets.find((s) => s.envName === 'FAL_API_KEY')
    expect(fal?.configured).toBe(false)
  })

  describe('お金と外部接続に効く設定', () => {
    it('絵コンテの下書きが実行モードなら目立たせる', () => {
      const status = describeEnvironment(aConfig({ storyboardDrafter: 'claude_cli' }))
      const drafter = status.settings.find((s) => s.envName === 'STORYBOARD_DRAFTER')
      expect(drafter?.notable).toBe(true)
      expect(drafter?.note).toContain('利用枠')
    })

    it('絵コンテの画像が Codex CLI なら目立たせる（契約の利用枠を使う）', () => {
      const status = describeEnvironment(aConfig({ imageProvider: 'codex_cli' }))
      const image = status.settings.find((s) => s.envName === 'IMAGE_PROVIDER')
      expect(image?.notable).toBe(true)
      expect(image?.note).toContain('利用枠')
    })

    it('スタブの既定（stub / 0 / 0）は目立たせない', () => {
      const status = describeEnvironment(aConfig())
      expect(status.settings.every((s) => !s.notable)).toBe(true)
    })

    it('検証用の口が開いていたら目立たせる', () => {
      const status = describeEnvironment(
        aConfig({
          providers: { falApiKey: null, stubVideoFailureRate: 1, stubVideoCostPerSecUsd: 0.3, videoProvider: 'stub', ...LOCAL_VIDEO_OFF },
        }),
      )
      const notable = status.settings.filter((s) => s.notable).map((s) => s.envName)
      expect(notable).toContain('STUB_VIDEO_FAILURE_RATE')
      expect(notable).toContain('STUB_VIDEO_COST_PER_SEC')
    })
  })
})

/**
 * 映像生成の切り替え。**お金が動くのはここだけ。**
 * 鍵の有無で暗黙に切り替えない（別の理由で鍵を置いた瞬間に課金経路が開く）。
 */
describe('映像生成の切り替え', () => {
  const settingFor = (config: AppConfig) =>
    describeEnvironment(config).settings.find((s) => s.envName === 'VIDEO_PROVIDER')

  it('既定（stub）は目立たせず、費用が出ないと書く', () => {
    const setting = settingFor(aConfig())
    expect(setting?.value).toBe('stub')
    expect(setting?.notable).toBe(false)
    expect(setting?.note).toContain('費用は発生しない')
  })

  it('fal のときは目立たせ、費用が出ると書く', () => {
    const config = aConfig({
      providers: {
        falApiKey: SECRET,
        stubVideoFailureRate: 0,
        stubVideoCostPerSecUsd: 0,
        videoProvider: 'fal',
        ...LOCAL_VIDEO_OFF,
      },
    })
    const setting = settingFor(config)
    expect(setting?.value).toBe('fal')
    expect(setting?.notable).toBe(true)
    expect(setting?.note).toContain('費用が発生')
  })

  it('切り替えの表示に鍵の値は混ざらない', () => {
    const config = aConfig({
      providers: {
        falApiKey: SECRET,
        stubVideoFailureRate: 0,
        stubVideoCostPerSecUsd: 0,
        videoProvider: 'fal',
        ...LOCAL_VIDEO_OFF,
      },
    })
    expect(JSON.stringify(describeEnvironment(config))).not.toContain(SECRET)
  })
})

/**
 * ローカルの動画生成（ADR-0031）。費用は掛からないが、機械を長く占めるので使っていることを見せる。
 */
describe('ローカルの動画生成', () => {
  const VPIPE_TOKEN = 'vpipe-SUPERSECRET-token-42'
  const vpipeOn = (token: string | null): AppConfig =>
    aConfig({
      providers: {
        ...aConfig().providers,
        localVideoGenerators: ['vpipe'],
        vpipeApiToken: token,
      },
    })

  const settingFor = (config: AppConfig) =>
    describeEnvironment(config).settings.find((s) => s.envName === 'LOCAL_VIDEO_GENERATOR')

  it('既定（none）は目立たせない', () => {
    expect(settingFor(aConfig())).toMatchObject({ value: 'none', notable: false })
  })

  it('vpipe のときは目立たせ、無料だが遅く 1 本ずつだと書く', () => {
    const setting = settingFor(vpipeOn(null))
    expect(setting).toMatchObject({ value: 'vpipe', notable: true })
    expect(setting?.note).toContain('費用は掛からない')
    expect(setting?.note).toContain('1 本ずつ')
  })

  /** ADR-0040。両方有効なら、GPU を取り合わないことを書く（押した人が「同時に作れない」と分かる）。 */
  it('vpipe と wan を両方有効にしたら、両方を挙げて 1 本ずつだと書く', () => {
    const both = aConfig({
      providers: { ...aConfig().providers, localVideoGenerators: ['vpipe', 'wan'] },
    })
    const setting = settingFor(both)
    expect(setting).toMatchObject({ value: 'vpipe,wan', notable: true })
    expect(setting?.note).toContain('MiniMax H3')
    expect(setting?.note).toContain('Wan 2.2 5B')
    expect(setting?.note).toContain('1 本ずつ')
  })

  it('wan だけなら wan のことだけ書く', () => {
    const wan = aConfig({ providers: { ...aConfig().providers, localVideoGenerators: ['wan'] } })
    const setting = settingFor(wan)
    expect(setting).toMatchObject({ value: 'wan', notable: true })
    expect(setting?.note).toContain('Wan 2.2 5B')
    expect(setting?.note).not.toContain('MiniMax H3')
  })

  it('wan の合言葉も、設定されているかと文字数だけ出す', () => {
    const wanToken = 'wan-SUPERSECRET-token-0123456789'
    const status = describeEnvironment(
      aConfig({
        providers: {
          ...aConfig().providers,
          localVideoGenerators: ['wan'],
          wanApiToken: wanToken,
        },
      }),
    )
    const token = status.secrets.find((s) => s.envName === 'WAN_API_TOKEN')
    expect(token).toMatchObject({ configured: true, length: wanToken.length })
    expect(JSON.stringify(status)).not.toContain(wanToken)
  })

  /** wan のサーバが別のマシンにあるときも、同じ注意を出す（片方だけに検査を置かない）。 */
  it('wan が別のマシンの http なら、暗号化されないことを書く（URL は出さない）', () => {
    const remote = aConfig({
      providers: {
        ...aConfig().providers,
        localVideoGenerators: ['wan'],
        wanApiUrl: 'http://192.168.1.21:8766',
        wanApiToken: 'wan-SUPERSECRET-token-0123456789',
      },
    })
    expect(settingFor(remote)?.note).toContain('暗号化されずに')
    expect(JSON.stringify(describeEnvironment(remote))).not.toContain('192.168.1.21')
  })

  it('合言葉は設定されているかと文字数だけ出し、値は出さない', () => {
    const status = describeEnvironment(vpipeOn(VPIPE_TOKEN))
    const token = status.secrets.find((s) => s.envName === 'VPIPE_API_TOKEN')
    expect(token).toMatchObject({ configured: true, length: VPIPE_TOKEN.length })
    expect(JSON.stringify(status)).not.toContain(VPIPE_TOKEN)
    expect(JSON.stringify(status)).not.toContain(VPIPE_TOKEN.slice(-4))
  })

  it('別のマシンのサーバを http で使うなら、暗号化されないことを書く（URL は出さない）', () => {
    const remote = aConfig({
      providers: {
        ...aConfig().providers,
        localVideoGenerators: ['vpipe'],
        vpipeApiUrl: 'http://192.168.1.20:8765',
        vpipeApiToken: VPIPE_TOKEN,
      },
    })
    const note = settingFor(remote)?.note ?? ''
    expect(note).toContain('暗号化されずに')
    expect(note).toContain('LAN')
    expect(JSON.stringify(describeEnvironment(remote))).not.toContain('192.168.1.20')
    // このマシンのサーバ・https なら書かない。
    expect(settingFor(vpipeOn(null))?.note).not.toContain('暗号化')
    const https = aConfig({
      providers: { ...remote.providers, vpipeApiUrl: 'https://gpu.example.lan:8765' },
    })
    expect(settingFor(https)?.note).not.toContain('暗号化')
  })

  it('サーバの URL は画面に出さない', () => {
    expect(JSON.stringify(describeEnvironment(vpipeOn(null)))).not.toContain('127.0.0.1:8765')
  })
})
