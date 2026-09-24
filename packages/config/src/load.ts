import type { ZodIssue } from 'zod'
import { EnvSchema, type AppConfig } from './schema.js'

/**
 * zod の issue を、変数名のみを含む読みやすい文へ変換する。
 * 秘密値が含まれ得る「実際に渡された値」は出力しない。
 */
const describeIssue = (issue: ZodIssue): string => {
  const field = issue.path.join('.') || '(root)'

  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined'
        ? `${field}: 必須の環境変数が設定されていません`
        : `${field}: 型が不正です（${issue.expected} が必要です）`
    case 'invalid_string': {
      // zod の validation は 'url' のような文字列のこともあれば { includes: '...' } のような
      // オブジェクトのこともある。そのまま埋め込むと '[object Object]' になるため分岐する。
      const kind = typeof issue.validation === 'string' ? issue.validation : 'フォーマット'
      return `${field}: 形式が不正です（${kind} 形式が必要です）`
    }
    case 'invalid_enum_value':
      return `${field}: 値が不正です（${issue.options.join(' | ')} のいずれかが必要です）`
    case 'too_small':
      return `${field}: 値が短すぎます、または小さすぎます`
    case 'too_big':
      return `${field}: 値が大きすぎます`
    default:
      return `${field}: 不正な値です`
  }
}

const formatIssues = (issues: readonly ZodIssue[]): string =>
  [
    '環境変数の検証に失敗しました:',
    ...issues.map((issue) => `  - ${describeIssue(issue)}`),
  ].join('\n')

/**
 * 環境変数を検証し、ネストされた AppConfig を返す。
 * モジュール読み込み時には実行されない（呼ばれたときだけ検証する）。
 */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const result = EnvSchema.safeParse(env)

  if (!result.success) {
    throw new Error(formatIssues(result.error.issues))
  }

  const parsed = result.data

  return {
    nodeEnv: parsed.NODE_ENV,
    storyboardDrafter: parsed.STORYBOARD_DRAFTER,
    logLevel: parsed.LOG_LEVEL,
    corsOrigins: parsed.CORS_ORIGINS,
    database: {
      url: parsed.DATABASE_URL,
    },
    redis: {
      url: parsed.REDIS_URL,
    },
    s3: {
      endpoint: parsed.S3_ENDPOINT,
      region: parsed.S3_REGION,
      bucket: parsed.S3_BUCKET,
      accessKeyId: parsed.S3_ACCESS_KEY_ID,
      secretAccessKey: parsed.S3_SECRET_ACCESS_KEY,
      forcePathStyle: parsed.S3_FORCE_PATH_STYLE,
    },
    api: {
      port: parsed.API_PORT,
      host: parsed.API_HOST,
    },
    web: {
      port: parsed.WEB_PORT,
    },
    audio: {
      url: parsed.AUDIO_SERVICE_URL,
    },
    providers: {
      falApiKey: parsed.FAL_API_KEY ?? null,
      /** スタブをわざと失敗させる割合。既定 0。本番では 0 のままにする。 */
      stubVideoFailureRate: parsed.STUB_VIDEO_FAILURE_RATE,
      stubVideoCostPerSecUsd: parsed.STUB_VIDEO_COST_PER_SEC,
      videoProvider: parsed.VIDEO_PROVIDER,
    },
  }
}

let cachedConfig: AppConfig | undefined

/** 初回だけ検証し、以降はキャッシュを返す。 */
export const getConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  if (cachedConfig === undefined) {
    cachedConfig = loadConfig(env)
  }
  return cachedConfig
}

/** テスト用にキャッシュを解除する。 */
export const resetConfigCache = (): void => {
  cachedConfig = undefined
}
