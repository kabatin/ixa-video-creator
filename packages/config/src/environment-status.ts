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

export const describeEnvironment = (config: AppConfig): EnvironmentStatus => ({
  secrets: [
    secretStatus(
      'fal.ai（映像生成）',
      'FAL_API_KEY',
      config.providers.falApiKey,
      '実際の映像生成に使う。未設定のあいだはスタブだけが動き、費用は発生しない。',
    ),
    secretStatus(
      'ストレージのアクセスキー',
      'S3_ACCESS_KEY_ID',
      config.s3.accessKeyId,
      '生成物と素材の置き場。未設定だと読み書きができない。',
    ),
    secretStatus(
      'ストレージの秘密鍵',
      'S3_SECRET_ACCESS_KEY',
      config.s3.secretAccessKey,
      '同上。',
    ),
  ],
  settings: [
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
