import { z } from 'zod'

/**
 * 使う AI（ADR-0032）。この環境で見つかった AI から、テキスト・画像・動画ごとに 1 つ選ぶ。
 *
 * **何に使えるかは、アダプタが実際にある用途だけを書く。** 入っていても口が無い用途は選ばせない
 * （Gemini・Grok は見つけて見せるが、テキストの口ができるまでは選べない）。
 * 選べるかの規則は `aiChoiceProblem` の 1 か所で、API の検証と画面の灰色が同じ理由を言う。
 */

export const AiPurpose = z.enum(['text', 'image', 'video'])
export type AiPurpose = z.infer<typeof AiPurpose>

export const AI_PURPOSE_LABELS: Readonly<Record<AiPurpose, string>> = Object.freeze({
  text: 'テキスト',
  image: '画像',
  video: '動画',
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
])
export type AiToolId = z.infer<typeof AiToolId>

/** 見つけ方。叩いてよい CLI の名前はこの表にあるものだけ。 */
export type AiToolDetection =
  /** アプリに入っている。いつでも使える。 */
  | { readonly kind: 'builtin' }
  /** この名前の CLI が入っているか（`--version`）。 */
  | { readonly kind: 'cli'; readonly command: 'claude' | 'codex' | 'gemini' | 'grok' }
  /** API キーが設定されているか（値は見ない）。 */
  | { readonly kind: 'api_key'; readonly key: 'FAL_API_KEY' }
  /** 手元の生成サーバが応答するか（vpipe-api の `GET /v1/health`。ADR-0031）。 */
  | { readonly kind: 'local_server' }

export type AiToolSpec = {
  readonly id: AiToolId
  readonly label: string
  readonly detect: AiToolDetection
  /** 今この用途の口（アダプタ）がある用途。 */
  readonly purposes: readonly AiPurpose[]
}

const tool = (spec: AiToolSpec): AiToolSpec => Object.freeze(spec)

export const AI_TOOLS: Readonly<Record<AiToolId, AiToolSpec>> = Object.freeze({
  stub: tool({
    id: 'stub',
    label: 'お試し（AI を使わない仮のもの）',
    detect: { kind: 'builtin' },
    purposes: ['text', 'image', 'video'],
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
})

/** 見つかったか。見つからないときは理由（入っていない・起動していない・キーが無い）を持つ。 */
export type AiToolStatus =
  | { readonly state: 'ready'; readonly version: string | null }
  | { readonly state: 'missing'; readonly reason: string }

export const AiSettings = z.object({
  text: AiToolId,
  image: AiToolId,
  video: AiToolId,
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

/** 勧める順。**お金が掛かるもの（fal）は入れない**（キーがあっても、使うかは人が選ぶ）。 */
const RECOMMENDATION_ORDER: Readonly<Record<AiPurpose, readonly AiToolId[]>> = Object.freeze({
  text: ['claude_cli', 'codex_cli', 'grok_cli'],
  image: ['codex_cli'],
  video: ['vpipe', 'local'],
})

/** 初めて選ぶときの初期の組み合わせ。見つかって使えるものから選び、無ければお試し。 */
export const recommendAiSettings = (
  statuses: Readonly<Record<AiToolId, AiToolStatus>>,
): AiSettings => {
  const pick = (purpose: AiPurpose): AiToolId =>
    RECOMMENDATION_ORDER[purpose].find(
      (id) => aiChoiceProblem(purpose, id, statuses[id]) === null,
    ) ?? 'stub'
  return { text: pick('text'), image: pick('image'), video: pick('video') }
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
})
