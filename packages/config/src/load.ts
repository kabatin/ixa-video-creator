import os from 'node:os'
import path from 'node:path'
import type { ZodIssue } from 'zod'
import { audioApiProblem } from './audio-api.js'
import { localVideoGeneratorProblem } from './local-video.js'
import { storageProblem } from './storage.js'
import { EnvSchema, type AppConfig, type Env } from './schema.js'

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
 * `fs` の置き場。**既定はここで決める**（API と worker が別々に決めると食い違う）。
 * ホームの下にするのは、Time Machine に乗り、Finder から開けるため（ADR-0041）。
 */
const storageRoot = (env: Env): string =>
  env.STORAGE_DIR ?? path.join(os.homedir(), 'ixa-video-creator', 'storage')

/**
 * 署名付き URL の宛先。
 *
 * **既定は画面が API を呼ぶ場所（`NEXT_PUBLIC_API_URL`）。** 素材の URL を読むのは画面なので、
 * ここが画面と違う場所を指していると、その端末からは素材が 1 つも見えない。
 * どちらも無ければこのマシンの API。
 */
const storagePublicBaseUrl = (env: Env): string =>
  env.STORAGE_PUBLIC_BASE_URL ?? env.NEXT_PUBLIC_API_URL ?? `http://127.0.0.1:${String(env.API_PORT)}`

/**
 * `s3` の接続先。**1 つでも欠けていれば null**（半端な設定で接続して分かりにくく失敗しない）。
 * `STORAGE_DRIVER=s3` で欠けている場合は、ここへ来る前に `storageProblem` が止める。
 */
const s3Settings = (env: Env): AppConfig['storage']['s3'] => {
  const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env
  if (
    S3_ENDPOINT === undefined ||
    S3_REGION === undefined ||
    S3_BUCKET === undefined ||
    S3_ACCESS_KEY_ID === undefined ||
    S3_SECRET_ACCESS_KEY === undefined
  ) {
    return null
  }
  return {
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  }
}

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

  /**
   * 形は正しくても組み合わせが成り立たない設定。**黙って動かさず起動時に止める**
   * （`VIDEO_PROVIDER=fal` で鍵が無いときと同じ考え方）。
   */
  const problem =
    localVideoGeneratorProblem(parsed) ?? audioApiProblem(parsed) ?? storageProblem(parsed)
  if (problem !== null) throw new Error(problem)

  return {
    nodeEnv: parsed.NODE_ENV,
    storyboardDrafter: parsed.STORYBOARD_DRAFTER,
    imageProvider: parsed.IMAGE_PROVIDER,
    logLevel: parsed.LOG_LEVEL,
    corsOrigins: parsed.CORS_ORIGINS,
    database: {
      url: parsed.DATABASE_URL,
    },
    redis: {
      url: parsed.REDIS_URL,
    },
    storage: {
      driver: parsed.STORAGE_DRIVER,
      root: storageRoot(parsed),
      publicBaseUrl: storagePublicBaseUrl(parsed),
      signingSecret: parsed.STORAGE_SIGNING_SECRET ?? null,
      s3: s3Settings(parsed),
    },
    api: {
      port: parsed.API_PORT,
      host: parsed.API_HOST,
      passphrase: parsed.IXA_PASSPHRASE ?? null,
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
      localVideoGenerators: parsed.LOCAL_VIDEO_GENERATOR,
      vpipeApiUrl: parsed.VPIPE_API_URL,
      vpipeApiToken: parsed.VPIPE_API_TOKEN ?? null,
      wanApiUrl: parsed.WAN_API_URL,
      wanApiToken: parsed.WAN_API_TOKEN ?? null,
    },
    renderExportDir: parsed.RENDER_EXPORT_DIR ?? null,
    voiceAi: {
      apiProviders: parsed.AUDIO_API_PROVIDERS,
      geminiApiKey: parsed.GEMINI_API_KEY ?? null,
      elevenLabsApiKey: parsed.ELEVENLABS_API_KEY ?? null,
      geminiBilling: parsed.GEMINI_API_BILLING,
      elevenLabsUsdPer1kChars: parsed.ELEVENLABS_USD_PER_1K_CHARS,
      whisperCppModel: parsed.WHISPER_CPP_MODEL ?? null,
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
