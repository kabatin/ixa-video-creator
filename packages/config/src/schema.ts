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
  WEB_PORT: z.coerce.number().int().positive().default(3000),
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
   * 絵コンテ下書きに使う口（PHASE 6.3）。
   *
   * **既定はスタブ。** `claude_cli` にすると実際に Claude CLI を起動し、
   * 制作者の契約の利用枠を消費する。生成 API のような従量課金ではないが
   * 無制限でもないので、明示的に切り替えたときだけ走らせる。
   */
  STORYBOARD_DRAFTER: z.enum(['stub', 'claude_cli']).default('stub'),
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
  }
  corsOrigins: readonly string[]
  web: {
    port: number
  }
  audio: {
    url: string
  }
  providers: {
    falApiKey: string | null
  }
}
