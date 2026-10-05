import { z } from 'zod'

/**
 * 使う AI（ADR-0032）。この環境で見つかった AI から、テキスト・画像・動画・声・文字起こしごとに 1 つ選ぶ
 * （声と文字起こしは ADR-0038）。
 *
 * **何に使えるかは、アダプタが実際にある用途だけを書く。** 入っていても口が無い用途は選ばせない
 * （Gemini・Grok は見つけて見せるが、テキストの口ができるまでは選べない）。
 * 選べるかの規則は `aiChoiceProblem` の 1 か所で、API の検証と画面の灰色が同じ理由を言う。
 */

export const AiPurpose = z.enum(['text', 'image', 'video', 'voice', 'transcribe'])
export type AiPurpose = z.infer<typeof AiPurpose>

export const AI_PURPOSE_LABELS: Readonly<Record<AiPurpose, string>> = Object.freeze({
  text: 'テキスト',
  image: '画像',
  video: '動画',
  voice: '声',
  transcribe: '文字起こし',
})

export const AiToolId = z.enum([
  'stub',
  'claude_cli',
  'codex_cli',
  'gemini_cli',
  'grok_cli',
  'local',
  'vpipe',
  'fal',
  'macos_say',
  'gemini_api',
  'elevenlabs',
  'whisper_cpp',
])
export type AiToolId = z.infer<typeof AiToolId>

/** 見つけ方。叩いてよい CLI の名前はこの表にあるものだけ。 */
export type AiToolDetection =
  /** アプリに入っている。いつでも使える。 */
  | { readonly kind: 'builtin' }
  /** この名前の CLI が入っているか（`args` で叩く。既定は `--version`）。 */
  | {
      readonly kind: 'cli'
      readonly command: 'claude' | 'codex' | 'gemini' | 'grok' | 'say' | 'whisper-cli'
      readonly args?: readonly string[]
    }
  /** API キーが設定され、`.env` で使ってよいと明示されているか（値は見ない）。 */
  | { readonly kind: 'api_key'; readonly key: 'FAL_API_KEY' | 'GEMINI_API_KEY' | 'ELEVENLABS_API_KEY' }
  /** whisper.cpp（`whisper-cli`）が入っていて、モデルのファイル（`WHISPER_CPP_MODEL`）があるか。 */
  | { readonly kind: 'whisper_cpp' }
  /** 手元の生成サーバが応答するか（vpipe-api の `GET /v1/health`。ADR-0031）。 */
  | { readonly kind: 'local_server' }

export type AiToolSpec = {
  readonly id: AiToolId
  readonly label: string
  readonly detect: AiToolDetection
  /** 今この用途の口（アダプタ）がある用途。 */
  readonly purposes: readonly AiPurpose[]
  /** 使う前に知っておくこと（無料枠の扱い・料金・商用の可否）。選ぶ画面にそのまま出す。無ければ null。 */
  readonly notice: string | null
}

const tool = (spec: Omit<AiToolSpec, 'notice'> & { readonly notice?: string }): AiToolSpec =>
  Object.freeze({ ...spec, notice: spec.notice ?? null })

export const AI_TOOLS: Readonly<Record<AiToolId, AiToolSpec>> = Object.freeze({
  stub: tool({
    id: 'stub',
    label: 'お試し（AI を使わない仮のもの）',
    detect: { kind: 'builtin' },
    purposes: ['text', 'image', 'video', 'voice', 'transcribe'],
  }),
  claude_cli: tool({
    id: 'claude_cli',
    label: 'Claude Code',
    detect: { kind: 'cli', command: 'claude' },
    purposes: ['text'],
  }),
  codex_cli: tool({
    id: 'codex_cli',
    label: 'Codex',
    detect: { kind: 'cli', command: 'codex' },
    // テキストは 2 段目（2026-10-02）。絵コンテの案と入力の手伝い（`text-cli.ts`）。
    purposes: ['text', 'image'],
  }),
  gemini_cli: tool({
    id: 'gemini_cli',
    label: 'Gemini CLI',
    detect: { kind: 'cli', command: 'gemini' },
    // Gemini CLI は廃止されたので対応しない（制作者 2026-10-02）。入っていても「使えない」と出す。
    purposes: [],
  }),
  grok_cli: tool({
    id: 'grok_cli',
    label: 'Grok',
    detect: { kind: 'cli', command: 'grok' },
    // テキストは 4 段目（2026-10-02）。サインインしていないと、使ったときに理由を言う。
    purposes: ['text'],
  }),
  local: tool({
    id: 'local',
    label: '静止画を動かす（無料）',
    detect: { kind: 'builtin' },
    purposes: ['video'],
  }),
  vpipe: tool({
    id: 'vpipe',
    label: '手元の MiniMax H3（vpipe・無料・1 本ずつ）',
    detect: { kind: 'local_server' },
    purposes: ['video'],
  }),
  fal: tool({
    id: 'fal',
    label: 'fal（Seedance・従量課金）',
    detect: { kind: 'api_key', key: 'FAL_API_KEY' },
    purposes: ['video'],
  }),
  macos_say: tool({
    id: 'macos_say',
    label: 'Mac の声（無料・この Mac で読む）',
    // `say -v ?` は声の一覧を出すだけで、読み上げない。
    detect: { kind: 'cli', command: 'say', args: ['-v', '?'] },
    purposes: ['voice'],
    notice: '機械的な声です。間や長さを決める仮のナレーションに向いています。',
  }),
  gemini_api: tool({
    id: 'gemini_api',
    label: 'Gemini（Google の API・無料枠あり）',
    detect: { kind: 'api_key', key: 'GEMINI_API_KEY' },
    purposes: ['voice', 'transcribe'],
    notice:
      '原稿は Google に送られます。無料枠では送った内容が製品の改善に使われ、人が見ることがあります。' +
      '作った声には透かし（SynthID）が入ります。声の料金は 2027-01-01 から倍になります。',
  }),
  elevenlabs: tool({
    id: 'elevenlabs',
    label: 'ElevenLabs（有料）',
    detect: { kind: 'api_key', key: 'ELEVENLABS_API_KEY' },
    purposes: ['voice', 'transcribe'],
    notice:
      '原稿は ElevenLabs に送られます。Free プランは商用に使えず、公開するときはクレジット表記（elevenlabs.io）が要ります。' +
      '有料プランは商用に使えます。',
  }),
  whisper_cpp: tool({
    id: 'whisper_cpp',
    label: 'whisper.cpp（無料・この Mac で聞き取る）',
    detect: { kind: 'whisper_cpp' },
    purposes: ['transcribe'],
  }),
})

/** 見つかったか。見つからないときは理由（入っていない・起動していない・キーが無い）を持つ。 */
export type AiToolStatus =
  | { readonly state: 'ready'; readonly version: string | null }
  | { readonly state: 'missing'; readonly reason: string }

export const AiSettings = z.object({
  text: AiToolId,
  image: AiToolId,
  video: AiToolId,
  voice: AiToolId,
  transcribe: AiToolId,
})
export type AiSettings = z.infer<typeof AiSettings>

/** 選べない理由。選べるなら null。 */
export const aiChoiceProblem = (
  purpose: AiPurpose,
  id: AiToolId,
  status: AiToolStatus,
): string | null => {
  const spec = AI_TOOLS[id]
  if (!spec.purposes.includes(purpose)) {
    return `${spec.label} は${AI_PURPOSE_LABELS[purpose]}にはまだ使えません`
  }
  return status.state === 'missing' ? `${spec.label} を使えません: ${status.reason}` : null
}

/**
 * 勧める順。**お金が掛かるもの（fal・ElevenLabs）と、原稿が外に出るもの（Gemini）は入れない**
 * （キーがあっても、使うかは人が選ぶ）。
 */
const RECOMMENDATION_ORDER: Readonly<Record<AiPurpose, readonly AiToolId[]>> = Object.freeze({
  text: ['claude_cli', 'codex_cli', 'grok_cli'],
  image: ['codex_cli'],
  video: ['vpipe', 'local'],
  voice: ['macos_say'],
  transcribe: ['whisper_cpp'],
})

/** 初めて選ぶときの初期の組み合わせ。見つかって使えるものから選び、無ければお試し。 */
export const recommendAiSettings = (
  statuses: Readonly<Record<AiToolId, AiToolStatus>>,
): AiSettings => {
  const pick = (purpose: AiPurpose): AiToolId =>
    RECOMMENDATION_ORDER[purpose].find(
      (id) => aiChoiceProblem(purpose, id, statuses[id]) === null,
    ) ?? 'stub'
  return {
    text: pick('text'),
    image: pick('image'),
    video: pick('video'),
    voice: pick('voice'),
    transcribe: pick('transcribe'),
  }
}

/** 選んであれば選んだもの、まだなら初期値（環境変数）。どちらかを名乗る。 */
export const resolveAiSettings = (
  saved: AiSettings | null,
  defaults: AiSettings,
): { readonly settings: AiSettings; readonly source: 'saved' | 'default' } =>
  saved === null ? { settings: defaults, source: 'default' } : { settings: saved, source: 'saved' }

/** 環境変数の値（`@ixa/config` の `AppConfig` から渡す）。 */
export type AiEnvChoices = {
  readonly storyboardDrafter: 'stub' | 'claude_cli'
  readonly imageProvider: 'stub' | 'codex_cli'
}

/**
 * まだ画面で選んでいない間の初期値。**今までどおりに動く**（既存の `.env` と CI を壊さない）。
 * テキストと画像は環境変数のまま。動画の AUTO は今まで、`VIDEO_PROVIDER=fal` でも
 * `LOCAL_VIDEO_GENERATOR=vpipe` でもお試しを選んでいた（fal は API に登録されず、vpipe は AUTO に出ない）
 * ので、お試しにする。**選ぶ前に、黙ってお金の掛かる口へ変えない。**
 */
export const aiDefaultsFromEnv = (env: AiEnvChoices): AiSettings => ({
  text: env.storyboardDrafter,
  image: env.imageProvider,
  video: 'stub',
  // 声と文字起こしは新しい用途。選ぶまではお試し（音を作らない・外に出さない）。
  voice: 'stub',
  transcribe: 'stub',
})
