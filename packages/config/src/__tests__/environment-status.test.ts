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

const aConfig = (overrides: Partial<AppConfig> = {}): AppConfig =>
  ({
    database: { url: 'postgres://x' },
    redis: { url: 'redis://x' },
    s3: {
      endpoint: 'http://s3',
      region: 'ap-northeast-1',
      bucket: 'ixa',
      accessKeyId: 'AKIA-SECRET-ID',
      secretAccessKey: 'S3-SUPERSECRET',
      forcePathStyle: true,
    },
    api: { port: 3001 },
    corsOrigins: [],
    web: { port: 3000 },
    audio: { url: 'http://audio' },
    storyboardDrafter: 'stub',
    logLevel: 'info',
    nodeEnv: 'development',
    providers: {
      falApiKey: SECRET,
      stubVideoFailureRate: 0,
      stubVideoCostPerSecUsd: 0,
      videoProvider: 'stub',
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
      providers: { falApiKey: null, stubVideoFailureRate: 0, stubVideoCostPerSecUsd: 0, videoProvider: 'stub' },
    })
    const fal = describeEnvironment(config).secrets.find((s) => s.envName === 'FAL_API_KEY')
    expect(fal?.configured).toBe(false)
    expect(fal?.length).toBeNull()
  })

  it('空白だけの値は未設定として扱う', () => {
    const config = aConfig({
      providers: { falApiKey: '   ', stubVideoFailureRate: 0, stubVideoCostPerSecUsd: 0, videoProvider: 'stub' },
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

    it('スタブの既定（stub / 0 / 0）は目立たせない', () => {
      const status = describeEnvironment(aConfig())
      expect(status.settings.every((s) => !s.notable)).toBe(true)
    })

    it('検証用の口が開いていたら目立たせる', () => {
      const status = describeEnvironment(
        aConfig({
          providers: { falApiKey: null, stubVideoFailureRate: 1, stubVideoCostPerSecUsd: 0.3, videoProvider: 'stub' },
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
      },
    })
    expect(JSON.stringify(describeEnvironment(config))).not.toContain(SECRET)
  })
})
