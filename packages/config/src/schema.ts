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
  AUDIO_SERVICE_URL: urlString.default('http://127.0.0.1:8100'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // 任意（既定値なし・nullable）
  FAL_API_KEY: z.string().min(1).optional(),
})

export type Env = z.infer<typeof EnvSchema>

export interface AppConfig {
  nodeEnv: Env['NODE_ENV']
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
