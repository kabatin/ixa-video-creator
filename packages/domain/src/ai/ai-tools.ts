import { z } from 'zod'

/**
 * 使う AI（ADR-0032）。この環境で見つかった AI から、テキスト・画像・動画・声・文字起こし・曲ごとに 1 つ選ぶ
 * （声と文字起こしは ADR-0038、曲は ADR-0048）。
 *
 * **何に使えるかは、アダプタが実際にある用途だけを書く。** 入っていても口が無い用途は選ばせない
 * （Gemini・Grok は見つけて見せるが、テキストの口ができるまでは選べない）。
 * 選べるかの規則は `aiChoiceProblem` の 1 か所で、API の検証と画面の灰色が同じ理由を言う。
 */

export const AiPurpose = z.enum(['text', 'image', 'video', 'voice', 'transcribe', 'music'])
export type AiPurpose = z.infer<typeof AiPurpose>

export const AI_PURPOSE_LABELS: Readonly<Record<AiPurpose, string>> = Object.freeze({
  text: 'テキスト',
  image: '画像',
  video: '動画',
  voice: '声',
  transcribe: '文字起こし',
  music: '曲',
})

export const AiToolId = z.enum([
  'stub',
  'claude_cli',
  'codex_cli',
  'gemini_cli',
  'grok_cli',
  'local',
  'vpipe',
  'wan',
  'klein',
  'ace_step',
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
  /**
   * 手元の生成サーバが応答するか（`GET /v1/health`。ADR-0031 / 0040 / 0047 / 0048）。
   * **どのサーバかを持つ。** 4 台（vpipe-api・wan-api・klein-api・ace-step-api）あるので、持たないと
   * 1 台の起動でほかが「使える」と出てしまう。
   */
  | { readonly kind: 'local_server'; readonly server: 'vpipe' | 'wan' | 'klein' | 'ace_step' }

export type AiToolSpec = {
  readonly id: AiToolId
  readonly label: string
  readonly detect: AiToolDetection
  /** 今この用途の口（アダプタ）がある用途。 */
  readonly purposes: readonly AiPurpose[]
  /** 選ぶ画面で名前の横に出す短い札（どこで動くか・お金）。名前に括弧で詰め込まない。 */
  readonly tags: readonly string[]
  /** 使う前に知っておくこと（無料枠の扱い・料金・商用の可否）。選ぶ画面にそのまま出す。無ければ null。 */
  readonly notice: string | null
}

const tool = (
  spec: Omit<AiToolSpec, 'notice' | 'tags'> & { readonly notice?: string; readonly tags?: readonly string[] },
): AiToolSpec => Object.freeze({ ...spec, tags: Object.freeze([...(spec.tags ?? [])]), notice: spec.notice ?? null })

const ON_THIS_MAC_FREE = ['この Mac', '無料'] as const
/** 手元の動画・絵・曲は同じ GPU を使う（ADR-0040・0047・0048）。 */
const SHARED_GPU_NOTICE = '手元の動画・絵・曲で GPU を分け合うので、順番待ちがあります。'

export const AI_TOOLS: Readonly<Record<AiToolId, AiToolSpec>> = Object.freeze({
  stub: tool({
    id: 'stub',
    label: 'お試し',
    tags: ['AI を使わない仮のもの'],
    detect: { kind: 'builtin' },
    // 曲は作れない（選ぶと「曲を作る AI を選んでください」と断る）。選び直すまでの置き場。
    purposes: ['text', 'image', 'video', 'voice', 'transcribe', 'music'],
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
    label: '静止画を動かす',
    tags: ['無料'],
    detect: { kind: 'builtin' },
    purposes: ['video'],
  }),
  vpipe: tool({
    id: 'vpipe',
    label: 'MiniMax H3',
    tags: ON_THIS_MAC_FREE,
    notice: SHARED_GPU_NOTICE,
    detect: { kind: 'local_server', server: 'vpipe' },
    purposes: ['video'],
  }),
  wan: tool({
    id: 'wan',
    label: 'Wan 2.2 5B',
    tags: ON_THIS_MAC_FREE,
    detect: { kind: 'local_server', server: 'wan' },
    purposes: ['video'],
    // **どちらも同じ機械の GPU を使う。** 片方が作っている間、もう片方は順番待ちになる（ADR-0040）。
    notice: SHARED_GPU_NOTICE,
  }),
  klein: tool({
    id: 'klein',
    label: 'FLUX.2 [klein]',
    tags: ON_THIS_MAC_FREE,
    detect: { kind: 'local_server', server: 'klein' },
    purposes: ['image'],
    // 動画と同じ機械の GPU を使う（ADR-0047）。動画を作っている間は絵も順番待ちになる。
    notice: SHARED_GPU_NOTICE,
  }),
  ace_step: tool({
    id: 'ace_step',
    label: 'ACE-Step 1.5',
    tags: ON_THIS_MAC_FREE,
    detect: { kind: 'local_server', server: 'ace_step' },
    purposes: ['music'],
    // 動画と同じ機械の GPU を使う（ADR-0048）。動画や絵を作っている間は曲も順番待ちになる。
    notice: SHARED_GPU_NOTICE,
  }),
  fal: tool({
    id: 'fal',
    label: 'Seedance（fal）',
    tags: ['従量課金'],
    detect: { kind: 'api_key', key: 'FAL_API_KEY' },
    purposes: ['video'],
  }),
  macos_say: tool({
    id: 'macos_say',
    label: 'Mac の声',
    tags: ON_THIS_MAC_FREE,
    // `say -v ?` は声の一覧を出すだけで、読み上げない。
    detect: { kind: 'cli', command: 'say', args: ['-v', '?'] },
    purposes: ['voice'],
    notice: '機械的な声です。仮のナレーション向き。',
  }),
  gemini_api: tool({
    id: 'gemini_api',
    label: 'Gemini API',
    tags: ['Google', '無料枠あり'],
    detect: { kind: 'api_key', key: 'GEMINI_API_KEY' },
    purposes: ['voice', 'transcribe'],
    notice:
      '原稿は Google に送られます（無料枠では製品の改善に使われ、人が見ることあり）。' +
      '声に透かし（SynthID）が入り、声の料金は 2027-01-01 から倍になります。',
  }),
  elevenlabs: tool({
    id: 'elevenlabs',
    label: 'ElevenLabs',
    tags: ['有料'],
    detect: { kind: 'api_key', key: 'ELEVENLABS_API_KEY' },
    purposes: ['voice', 'transcribe'],
    notice: '原稿は ElevenLabs に送られます。Free プランは商用不可で、公開時にクレジット表記が要ります。',
  }),
  whisper_cpp: tool({
    id: 'whisper_cpp',
    label: 'whisper.cpp',
    tags: ON_THIS_MAC_FREE,
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
  music: AiToolId,
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
  // klein は実測が揃うまで初期値にしない（ADR-0047）。選べば使える。
  image: ['codex_cli', 'klein'],
  // vpipe を先に置くのは、実測のある（速さと出来の分かっている）方を初期値にするため（ADR-0040）。
  video: ['vpipe', 'wan', 'local'],
  voice: ['macos_say'],
  transcribe: ['whisper_cpp'],
  music: ['ace_step'],
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
    music: pick('music'),
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
  // 曲も新しい用途。選ぶまではお試し（作らない）。
  music: 'stub',
})
