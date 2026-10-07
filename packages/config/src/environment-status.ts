import { isLoopbackUrl } from './local-video.js'
import type { AppConfig } from './schema.js'

/**
 * この環境が何につながっていて、何にお金が掛かるかを画面へ出すための形（純粋関数）。
 *
 * **秘密の値そのものは絶対に入れない。** API は無認証で全インターフェースに
 * 待ち受けているので（`TCP *:3001`）、ここに値を入れると同じ網にいる誰でも
 * 課金される鍵を読める。規約 6 が「シークレットは env のみ」と言っているのは
 * そのためで、**画面に出すのは「設定されているか」までにする**。
 *
 * 下 4 桁も出さない。鍵の一部でも HTTP に乗せない。
 * 代わりに文字数を出して「貼り漏れ」だけ分かるようにする。
 */

export type SecretStatus = {
  /** 画面に出す名前。 */
  readonly label: string
  /** `.env` に書く名前。未設定のとき貼る行を作るのに使う。 */
  readonly envName: string
  readonly configured: boolean
  /**
   * 設定されている場合の文字数。**値は返さない。**
   * 貼り損ねて途中で切れていないかを確かめるためだけに出す。
   */
  readonly length: number | null
  /** 何に使う鍵か。未設定のときに困ることを書く。 */
  readonly purpose: string
}

/** お金や外部への接続に効く、秘密ではない設定。**値をそのまま出してよいもの。** */
export type EnvironmentSetting = {
  readonly label: string
  readonly envName: string
  readonly value: string
  /** 既定から外れていて、意図しないと危ないもの。画面で目立たせる。 */
  readonly notable: boolean
  readonly note: string
}

export type EnvironmentStatus = {
  readonly secrets: readonly SecretStatus[]
  readonly settings: readonly EnvironmentSetting[]
}

const secretStatus = (
  label: string,
  envName: string,
  value: string | null,
  purpose: string,
): SecretStatus => {
  const trimmed = value?.trim() ?? ''
  const configured = trimmed !== ''
  return { label, envName, configured, length: configured ? trimmed.length : null, purpose }
}

/**
 * ローカルの動画生成の説明。**サーバがこのマシンの外にあり http なら、そう書く。**
 * 合言葉も最初のフレームの画像も暗号化されずに流れるので、信頼できる LAN の中だけで使う。
 * URL そのものは出さない（画面に URL を出さない）。
 */
const LOCAL_VIDEO_NOTES: Readonly<Record<'vpipe' | 'wan', string>> = Object.freeze({
  vpipe: 'このマシンの動画生成サーバ（vpipe-api）で MiniMax H3 を動かす。1 本に 7〜25 分かかる。',
  wan: 'このマシンの動画生成サーバ（wan-api）で Wan 2.2 5B を動かす。所要時間はまだ実測していない。',
})

/** そのサーバの URL が、このマシンの外へ暗号化せずに出ているか。 */
const plainOverNetwork = (url: string): boolean =>
  !isLoopbackUrl(url) && url.toLowerCase().startsWith('http://')

const localVideoNote = (config: AppConfig): string => {
  const { localVideoGenerators, vpipeApiUrl, wanApiUrl } = config.providers
  if (localVideoGenerators.length === 0) return '使わない。'

  const notes = localVideoGenerators.map((id) => LOCAL_VIDEO_NOTES[id]).join('')
  const shared =
    localVideoGenerators.length > 1
      ? '両方を有効にしていても、この機械の GPU を取り合わないよう、どちらか 1 本ずつしか作らない。'
      : ''
  const urls = [
    ...(localVideoGenerators.includes('vpipe') ? [vpipeApiUrl] : []),
    ...(localVideoGenerators.includes('wan') ? [wanApiUrl] : []),
  ]
  const overNetwork = urls.some(plainOverNetwork)
    ? 'サーバが別のマシンにあり、合言葉と画像が暗号化されずに流れる。信頼できる LAN の中だけで使うこと。'
    : ''
  return `${notes}費用は掛からないが 1 本ずつ順に作り、作っている間はこの機械の GPU とメモリを占める。${shared}${overNetwork}`
}

/**
 * 置き場によって要る秘密が変わる（ADR-0041）。
 * **使わない方を「未設定」として並べない。** 設定し忘れに見えてしまう。
 */
const storageSecrets = (config: AppConfig): readonly SecretStatus[] =>
  config.storage.driver === 'fs'
    ? [
        secretStatus(
          '素材を見せる URL の署名の鍵',
          'STORAGE_SIGNING_SECRET',
          config.storage.signingSecret,
          'この機械に置いた素材を画面へ見せるのに使う。未設定だと素材を 1 つも返せない。',
        ),
      ]
    : [
        secretStatus(
          'ストレージのアクセスキー',
          'S3_ACCESS_KEY_ID',
          config.storage.s3?.accessKeyId ?? null,
          '生成物と素材の置き場。未設定だと読み書きができない。',
        ),
        secretStatus(
          'ストレージの秘密鍵',
          'S3_SECRET_ACCESS_KEY',
          config.storage.s3?.secretAccessKey ?? null,
          '同上。',
        ),
      ]

export const describeEnvironment = (config: AppConfig): EnvironmentStatus => ({
  secrets: [
    secretStatus(
      'fal.ai（映像生成）',
      'FAL_API_KEY',
      config.providers.falApiKey,
      '実際の映像生成に使う。未設定のあいだはスタブだけが動き、費用は発生しない。',
    ),
    secretStatus(
      'Gemini（声・文字起こし）',
      'GEMINI_API_KEY',
      config.voiceAi.geminiApiKey,
      'ナレーションの声と録音の文字起こしに使う。AUDIO_API_PROVIDERS に gemini_api と書いたときだけ使う。',
    ),
    secretStatus(
      'ElevenLabs（声・文字起こし）',
      'ELEVENLABS_API_KEY',
      config.voiceAi.elevenLabsApiKey,
      'ナレーションの声と録音の文字起こしに使う（有料）。AUDIO_API_PROVIDERS に elevenlabs と書いたときだけ使う。',
    ),
    secretStatus(
      'ローカルの動画生成（vpipe）の合言葉',
      'VPIPE_API_TOKEN',
      config.providers.vpipeApiToken,
      '別のマシンの動画生成サーバを使うときだけ要る。このマシンのサーバなら未設定でよい。',
    ),
    secretStatus(
      'ローカルの動画生成（Wan）の合言葉',
      'WAN_API_TOKEN',
      config.providers.wanApiToken,
      '別のマシンの動画生成サーバを使うときだけ要る。このマシンのサーバなら未設定でよい。',
    ),
    ...storageSecrets(config),
  ],
  settings: [
    {
      label: '素材の置き場',
      envName: 'STORAGE_DRIVER',
      value: config.storage.driver,
      // 既定から外れていること自体は危なくない。どちらでも意図通りなら目立たせない。
      notable: false,
      note:
        config.storage.driver === 'fs'
          ? `この機械のフォルダにそのまま置く（${config.storage.root}）。Finder から開けて、Time Machine に乗る。`
          : 'S3 互換の置き場（MinIO など）に置く。この機械のフォルダからは開けない。',
    },
    {
      label: '映像生成',
      envName: 'VIDEO_PROVIDER',
      value: config.providers.videoProvider,
      // **お金が動くのはここ。** 既定から外れていることが一目で分かるようにする。
      notable: config.providers.videoProvider !== 'stub',
      note:
        config.providers.videoProvider === 'stub'
          ? '色の四角を作るだけ。費用は発生しない。'
          : '実際に fal.ai へ投げる。1 生成ごとに費用が発生する。',
    },
    {
      label: 'ローカルの動画生成',
      envName: 'LOCAL_VIDEO_GENERATOR',
      // 書いていなければ `none`（`.env` に書く値と同じ形で見せる）。
      value:
        config.providers.localVideoGenerators.length === 0
          ? 'none'
          : config.providers.localVideoGenerators.join(','),
      // 費用は掛からないが、この機械の GPU とメモリを長く占める。使っていることが見えるようにする。
      notable: config.providers.localVideoGenerators.length > 0,
      note: localVideoNote(config),
    },
    {
      label: '絵コンテの下書き',
      envName: 'STORYBOARD_DRAFTER',
      value: config.storyboardDrafter,
      // 実行モードは契約の利用枠を使う。画面から見えないと、押した人が気づけない。
      notable: config.storyboardDrafter !== 'stub',
      note:
        config.storyboardDrafter === 'stub'
          ? '仮の文を返す。費用は発生しない。'
          : 'Claude を実際に呼ぶ。契約の利用枠を使う。',
    },
    {
      label: '絵コンテの画像',
      envName: 'IMAGE_PROVIDER',
      value: config.imageProvider,
      notable: config.imageProvider !== 'stub',
      note:
        config.imageProvider === 'stub'
          ? '仮の絵（色の面）を作る。費用は発生しない。'
          : 'Codex CLI を実際に呼ぶ。契約の利用枠を使う（1 枚 70 秒ほど）。',
    },
    {
      label: 'スタブをわざと失敗させる割合',
      envName: 'STUB_VIDEO_FAILURE_RATE',
      value: config.providers.stubVideoFailureRate.toFixed(2),
      notable: config.providers.stubVideoFailureRate > 0,
      note: '失敗したときの画面を確かめるための口。本番では 0。',
    },
    {
      label: 'スタブの見かけの単価',
      envName: 'STUB_VIDEO_COST_PER_SEC',
      value: `$${config.providers.stubVideoCostPerSecUsd.toFixed(4)}/秒`,
      notable: config.providers.stubVideoCostPerSecUsd > 0,
      note: '予算の上限で止まることを確かめるための口。本番では 0。',
    },
  ],
})

/** 未設定の鍵を `.env` に書くための 1 行。**値は空のまま**（ここで作らない）。 */
export const envLineFor = (secret: SecretStatus): string => `${secret.envName}=`
