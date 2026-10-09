import { z } from 'zod'

/**
 * 環境変数の zod スキーマ。
 * 数値・真偽値は文字列で渡ってくる前提で `z.coerce` / 変換で正規化する。
 */

const urlString = z.string().url()

/** 署名の鍵の最低の長さ。`packages/storage` の `MIN_SIGNING_SECRET_LENGTH` と同じ値。 */
export const MIN_STORAGE_SIGNING_SECRET_LENGTH = 32

/** 合言葉の最短の長さ（認証）。短いと LAN の中で当てられる。 */
export const MIN_PASSPHRASE_LENGTH = 12

/** "true" / "false" の文字列を boolean へ変換する。 */
const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true')

export const EnvSchema = z.object({
  // 必須
  DATABASE_URL: urlString,
  REDIS_URL: urlString,

  /**
   * 素材・書き出し・波形の置き場（ADR-0041）。
   *
   * - `fs` … この機械のただのファイル（`STORAGE_DIR` の下）。Finder で開ける
   * - `s3` … S3 互換のサーバ（MinIO など）。`S3_*` が必要
   *
   * **既定は `fs`。** 1 人が 1 台の Mac で使う道具に、S3 互換のサーバを抱える理由はもう無い
   * （MinIO はコミュニティ版のイメージ配布が止まり、版を固定できない）。
   * `s3` は残してある。別の機械に分ける日が来たら戻せる。
   */
  STORAGE_DRIVER: z.enum(['fs', 's3']).default('fs'),
  /**
   * `fs` のときの置き場（絶対パスだけ）。省略すると `~/ixa-video-creator/storage`。
   * **相対パスや `~` は受けない。** どこに置くかが起動のしかたで変わってしまう（`RENDER_EXPORT_DIR` と同じ）。
   */
  STORAGE_DIR: z
    .string()
    .transform((v) => (v.trim() === '' ? undefined : v.trim()))
    .refine((v) => v === undefined || v.startsWith('/'), {
      message: '絶対パス（/ で始まる）で書いてください',
    })
    .optional(),
  /**
   * `fs` のときに署名付き URL を作る鍵。**32 文字以上。** 空なら未設定。
   *
   * 短い鍵のまま動かすと、署名があるのに破れる。`fs` で未設定なら起動時に止める（storage.ts）。
   */
  /**
   * API に入る合言葉（認証）。**12 文字以上。** 空なら未設定。
   *
   * worker は API を通らないので要らない。**API は未設定なら起動しない**（`apps/api/src/main.ts`）。
   * 画面で入れると、その端末は 30 日入ったままになる。
   */
  IXA_PASSPHRASE: z
    .string()
    .transform((v) => (v.trim() === '' ? undefined : v))
    .refine((v) => v === undefined || v.length >= MIN_PASSPHRASE_LENGTH, {
      message: `${String(MIN_PASSPHRASE_LENGTH)} 文字以上で書いてください`,
    })
    .optional(),
  STORAGE_SIGNING_SECRET: z
    .string()
    .transform((v) => (v.trim() === '' ? undefined : v))
    .refine((v) => v === undefined || v.length >= MIN_STORAGE_SIGNING_SECRET_LENGTH, {
      message: `${String(MIN_STORAGE_SIGNING_SECRET_LENGTH)} 文字以上で書いてください`,
    })
    .optional(),
  /**
   * 署名付き URL の宛先（ブラウザから見た API の場所）。
   *
   * 省略すると **`NEXT_PUBLIC_API_URL`**、それも無ければ `http://127.0.0.1:<API_PORT>`。
   * 素材の URL を使うのは画面なので、**画面が API を呼ぶ場所と同じでなければ届かない**。
   * 2026-10-07 に、ここが `127.0.0.1` のままで LAN の別の端末から素材が 1 つも見えなくなった。
   */
  STORAGE_PUBLIC_BASE_URL: urlString.optional(),
  /**
   * 画面から見た API の場所（`apps/web` が使う変数）。**API 側はこれを既定の決定にだけ使う。**
   *
   * 「ブラウザが API に届く場所」はこの 1 つに書いてあるので、素材の URL の宛先も同じものを読む。
   * 別々に持つと、片方だけ LAN 向きになって素材だけが見えなくなる。
   */
  NEXT_PUBLIC_API_URL: urlString.optional(),

  // 任意（既定値あり。`s3` のときだけ要る）
  S3_ENDPOINT: urlString.optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
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
  /**
   * 手元の生成サーバで動画を作るか（ADR-0031 / 0040）。**既定は `none`（使わない）。**
   * カンマ区切りで複数書ける（例: `vpipe,wan`）。`AUDIO_API_PROVIDERS` と同じ形。
   *
   * - `vpipe` … vpipe-api の MiniMax H3 Turbo（ADR-0031）
   * - `wan` … wan-api の Wan 2.2 TI2V-5B（ADR-0040）
   *
   * **URL やトークンの有無で切り替えない**（LESSONS「鍵があることを、実行の合図にしない」）。
   * 書いたものだけモデルが選択肢に出る。費用は掛からないが、1 本に数分〜数十分かかり、
   * その間この機械の GPU とメモリを占める。AUTO には選ばれない（明示して選んだときだけ動く）。
   *
   * **両方書いても同時には作らない。** worker が「この機械の GPU」を 1 本ずつに揃える（ADR-0040）。
   */
  LOCAL_VIDEO_GENERATOR: z
    .string()
    .default('none')
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== ''),
    )
    .superRefine((items, ctx) => {
      // `none` は「使わない」なので、ほかと並べると意味が決まらない。黙ってどちらかを採らない。
      if (items.includes('none') && items.length > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'none はほかの値と並べて書けません（使わないなら none だけにしてください）',
        })
      }
    })
    .transform((items) => items.filter((item) => item !== 'none'))
    .pipe(z.array(z.enum(['vpipe', 'wan'])))
    // 同じサーバを 2 回書いても 1 回として扱う（同じモデル ID を 2 度登録できない）。
    .transform((items) => [...new Set(items)]),
  /** vpipe-api の場所。**既定はこのマシンだけ**（`127.0.0.1`）。 */
  VPIPE_API_URL: urlString.default('http://127.0.0.1:8765'),
  /** wan-api の場所。**既定はこのマシンだけ**（`127.0.0.1`。vpipe-api とポートを分ける）。 */
  WAN_API_URL: urlString.default('http://127.0.0.1:8766'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * 声と文字起こしで使ってよい外部の API（ADR-0038）。カンマ区切り（例: `gemini_api,elevenlabs`）。**既定は空（使わない）。**
   *
   * **鍵の有無で切り替えない。** 原稿が外に出て、ElevenLabs はお金が掛かる。この API は無認証で網に出ることがあるため、
   * 画面の選択だけで外部の口を開けられないようにする（`VIDEO_PROVIDER=fal` と同じ考え方）。
   */
  AUDIO_API_PROVIDERS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== ''),
    )
    .pipe(z.array(z.enum(['gemini_api', 'elevenlabs']))),
  /** Gemini を無料枠で使うか（費用の見積もりに使う。無料枠なら 0）。 */
  GEMINI_API_BILLING: z.enum(['free', 'paid']).default('free'),
  /** ElevenLabs の 1000 字あたりの単価（USD）。プランで違う。既定は従量課金の値。 */
  ELEVENLABS_USD_PER_1K_CHARS: z.coerce.number().min(0).default(0.08),

  // 任意（既定値なし・nullable）
  /** Gemini の API キー（声・文字起こし）。空なら未設定。 */
  GEMINI_API_KEY: z
    .string()
    .transform((v) => (v.trim() === '' ? undefined : v))
    .optional(),
  /** ElevenLabs の API キー（声・文字起こし）。空なら未設定。 */
  ELEVENLABS_API_KEY: z
    .string()
    .transform((v) => (v.trim() === '' ? undefined : v))
    .optional(),
  /** whisper.cpp のモデルのファイル（絶対パス。例: ggml-large-v3-turbo.bin）。無ければ whisper.cpp を選べない。 */
  WHISPER_CPP_MODEL: z
    .string()
    .transform((v) => (v.trim() === '' ? undefined : v.trim()))
    .refine((v) => v === undefined || v.startsWith('/'), {
      message: '絶対パス（/ で始まる）で書いてください',
    })
    .optional(),
  /**
   * .env に `FAL_API_KEY=` と空で書かれた場合は「未設定」として扱う。
   * 空文字を値として受け取ると、キー未取得のまま API を叩いて分かりにくい失敗をするため。
   */
  FAL_API_KEY: z
    .string()
    .transform((v) => (v.trim() === '' ? undefined : v))
    .optional(),
  /**
   * vpipe-api の合言葉（`Authorization: Bearer`）。空なら未設定（FAL_API_KEY と同じ扱い）。
   * このマシンのサーバ（ループバック）なら要らない。別のマシンのサーバを使うときは必須。
   */
  VPIPE_API_TOKEN: z
    .string()
    .transform((v) => (v.trim() === '' ? undefined : v))
    .optional(),
  /**
   * wan-api の合言葉（`Authorization: Bearer`）。空なら未設定（`VPIPE_API_TOKEN` と同じ扱い）。
   * このマシンのサーバ（ループバック）なら要らない。別のマシンのサーバを使うときは必須。
   */
  WAN_API_TOKEN: z
    .string()
    .transform((v) => (v.trim() === '' ? undefined : v))
    .optional(),
  /**
   * 書き出した動画を置くフォルダ（ADR-0036）。省略すると API がホームの「ムービー」の下に決める。
   * **絶対パスだけ受ける。** 相対パスや `~` は、どこに書くかが起動のしかたで変わってしまう。
   */
  RENDER_EXPORT_DIR: z
    .string()
    .transform((v) => (v.trim() === '' ? undefined : v.trim()))
    .refine((v) => v === undefined || v.startsWith('/'), {
      message: '絶対パス（/ で始まる）で書いてください',
    })
    .optional(),
})

export type Env = z.infer<typeof EnvSchema>

/** 有効にできる手元の生成サーバ（`LOCAL_VIDEO_GENERATOR` に書ける値）。 */
export type LocalVideoGeneratorId = Env['LOCAL_VIDEO_GENERATOR'][number]

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
  /**
   * 素材・書き出し・波形の置き場（ADR-0041）。
   *
   * **この形は `packages/storage` の `StorageSettings` へそのまま渡せるようにしてある。**
   * 型を合わせておくことで、片方だけ変えたときに呼び出し側の型が落ちる（配線を 2 箇所に書き写さない）。
   */
  storage: {
    driver: Env['STORAGE_DRIVER']
    /** `fs` の根（絶対パス）。`s3` のときは使われない。 */
    root: string
    /** 署名付き URL の宛先。 */
    publicBaseUrl: string
    /** `fs` の署名の鍵。未設定は null（`fs` では起動時に止まるので、実際には `fs` なら必ず入る）。 */
    signingSecret: string | null
    /** `s3` の接続先。1 つでも欠けていれば null。 */
    s3: {
      endpoint: string
      region: string
      bucket: string
      accessKeyId: string
      secretAccessKey: string
      forcePathStyle: boolean
    } | null
  }
  api: {
    port: number
    /** 待ち受けアドレス。既定は `127.0.0.1`（LAN の中は HTTP なので、使わないときは広げない）。 */
    host: string
    /** 合言葉。**null なら API は起動しない。** */
    passphrase: string | null
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
    /**
     * 手元の生成サーバのうち、有効にしたもの（ADR-0031 / 0040）。既定は空（使わない）。
     * 複数あっても同時には作らない（worker が 1 本ずつに揃える）。
     */
    localVideoGenerators: readonly LocalVideoGeneratorId[]
    /** vpipe-api の場所。 */
    vpipeApiUrl: string
    /** vpipe-api の合言葉。未設定は null。 */
    vpipeApiToken: string | null
    /** wan-api の場所。 */
    wanApiUrl: string
    /** wan-api の合言葉。未設定は null。 */
    wanApiToken: string | null
  }
  /** 書き出した動画を置くフォルダ（絶対パス）。未設定は null（API が既定を決める）。 */
  renderExportDir: string | null
  /** 声と文字起こしの AI（ADR-0038）。 */
  voiceAi: {
    /** 使ってよい外部の API。ここに無いものは鍵があっても選べない。 */
    apiProviders: Env['AUDIO_API_PROVIDERS']
    geminiApiKey: string | null
    elevenLabsApiKey: string | null
    geminiBilling: Env['GEMINI_API_BILLING']
    elevenLabsUsdPer1kChars: number
    whisperCppModel: string | null
  }
}
