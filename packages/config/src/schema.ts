import { z } from 'zod'

/**
 * 環境変数の zod スキーマ。
 * 数値・真偽値は文字列で渡ってくる前提で `z.coerce` / 変換で正規化する。
 */

const urlString = z.string().url()

/** "true" / "false" の文字列を boolean へ変換する。 */
const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true')

export const EnvSchema = z.object({
  // 必須
  DATABASE_URL: urlString,
  REDIS_URL: urlString,
  S3_ENDPOINT: urlString,
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),

  // 任意（既定値あり）
  S3_FORCE_PATH_STYLE: booleanFromString.default('true'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  /**
   * API の待ち受けアドレス。**既定は `127.0.0.1`（このマシンからのみ）。**
   *
   * この API には認証が無い。全インターフェース（`0.0.0.0`）で待ち受けると、
   * 同じネットワークにいる誰でも Project を消せて、課金される生成を投げられる。
   * LAN から触りたいときだけ明示的に `0.0.0.0` にし、**終わったら戻すこと。**
   */
  API_HOST: z.string().min(1).default('127.0.0.1'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /**
   * CORS で許可するオリジン。カンマ区切り。
   * ブラウザから API を直接叩く経路（署名付き URL の取得など）に必要。
   * **ワイルドカードを既定にしない。** 許可先を明示する。
   */
  CORS_ORIGINS: z
    .string()
    .default('http://127.0.0.1:3000,http://localhost:3000')
    .transform((v) => v.split(',').map((o) => o.trim()).filter((o) => o.length > 0)),
  AUDIO_SERVICE_URL: urlString.default('http://127.0.0.1:8100'),
  /**
   * スタブ映像 Provider をわざと失敗させる割合（0〜1）。既定 0。
   *
   * **開発と検証のための口。** 生成が失敗したときの経路（Shot を生成中から戻す・
   * 理由を画面まで運ぶ）は、これが無いと実 Provider を有料で回すまで一度も走らない。
   * 1 で全部落ち、0.34 なら 3 本に 1 本ほど落ちて部分失敗も試せる。
   */
  STUB_VIDEO_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
  /**
   * スタブ映像 Provider の見かけの単価（USD/秒）。既定 0。
   *
   * **開発と検証のための口。** スタブは本来ただなので見積が必ず 0 になり、
   * 予算ガード（`checkCostLimits`）は構造上ぜったいに発火しない。
   * 0 以外にすると、上限で止まることを無料で確かめられる。
   */
  STUB_VIDEO_COST_PER_SEC: z.coerce.number().min(0).default(0),
  /**
   * 映像生成に実 Provider を使うか。**既定は `stub`（無料）。**
   *
   * **鍵の有無で切り替えない。** 別の理由で `FAL_API_KEY` を置いた瞬間に
   * 課金経路が開くのは事故のもと。金が動く切り替えは明示にする。
   * `fal` にしたのに鍵が無ければ、黙ってスタブへ落とさず起動時に止める
   * （落とすと「実 Provider で作ったつもりがスタブだった」に気付けない）。
   */
  VIDEO_PROVIDER: z.enum(['stub', 'fal']).default('stub'),
  /**
   * 絵コンテ下書きに使う口（PHASE 6.3）。
   *
   * **既定はスタブ。** `claude_cli` にすると実際に Claude CLI を起動し、
   * 制作者の契約の利用枠を消費する。生成 API のような従量課金ではないが
   * 無制限でもないので、明示的に切り替えたときだけ走らせる。
   */
  STORYBOARD_DRAFTER: z.enum(['stub', 'claude_cli']).default('stub'),
  /**
   * 絵コンテの画像（Shot の最初のフレーム）を作る口（ADR-0029）。
   *
   * **既定はスタブ。** `codex_cli` にすると手元の Codex CLI を起動し、契約の利用枠を使う。
   * 従量課金ではないが無制限でもないので、明示的に切り替えたときだけ走らせる。
   */
  IMAGE_PROVIDER: z.enum(['stub', 'codex_cli']).default('stub'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // 任意（既定値なし・nullable）
  /**
   * .env に `FAL_API_KEY=` と空で書かれた場合は「未設定」として扱う。
   * 空文字を値として受け取ると、キー未取得のまま API を叩いて分かりにくい失敗をするため。
   */
  FAL_API_KEY: z
    .string()
    .transform((v) => (v.trim() === '' ? undefined : v))
    .optional(),
})

export type Env = z.infer<typeof EnvSchema>

export interface AppConfig {
  nodeEnv: Env['NODE_ENV']
  /** 絵コンテ下書きに使う口。既定はスタブ。 */
  storyboardDrafter: Env['STORYBOARD_DRAFTER']
  /** 絵コンテの画像を作る口（ADR-0029）。既定はスタブ。 */
  imageProvider: Env['IMAGE_PROVIDER']
  logLevel: Env['LOG_LEVEL']
  database: {
    url: string
  }
  redis: {
    url: string
  }
  s3: {
    endpoint: string
    region: string
    bucket: string
    accessKeyId: string
    secretAccessKey: string
    forcePathStyle: boolean
  }
  api: {
    port: number
    /** 待ち受けアドレス。既定は `127.0.0.1`。認証が無いので既定を広げない。 */
    host: string
  }
  corsOrigins: readonly string[]
  audio: {
    url: string
  }
  providers: {
    falApiKey: string | null
    /** スタブ映像 Provider をわざと失敗させる割合（0〜1）。本番では 0。 */
    stubVideoFailureRate: number
    /** スタブ映像 Provider の見かけの単価（USD/秒）。本番では 0。 */
    stubVideoCostPerSecUsd: number
    /** 映像生成に実 Provider を使うか。既定は `stub`（無料）。 */
    videoProvider: Env['VIDEO_PROVIDER']
  }
}
