import { AI_TOOLS, type AiToolId, type SentPrompt, type Take, type VoiceSpec, type VoiceToolId } from '@ixa/domain'
import { formatDuration } from '@/lib/format-time'
import type { MusicForm } from '@/lib/music-job-form'
import { cueRowFromCue, type SfxCueLike, type SfxCueRow } from '@/lib/sfx-cue-rows'
import { takeModelLabel } from '@/lib/take-display'
import { VOICE_TOOL_LABELS } from '@/lib/voice-defaults'

/**
 * プロンプトビューア（制作者 2026-10-25）の中身。**React を含まない。**
 * 生成物ごとの記録を、同じ形（`PromptView`）へ揃える。記録が無いときの扱いもここで決める
 * （ボタンを出すか・代わりに何を出すか）。画面はこの形を描くだけ。
 */

/** 本文の 1 欄（プロンプト・除外する内容・歌詞・声の演技指示）。`mono` は送った文そのもの（等幅で出す）。 */
export type PromptSection = { readonly label: string; readonly text: string; readonly mono: boolean }

/** 同じものをもう一度作るのに要る値（シード・長さなど）。 */
export type PromptFact = { readonly label: string; readonly value: string }

/** 「これを元に作る」で作成画面へ渡す初期値。楽曲と効果音だけ（動画と画像は今回の外）。 */
export type PromptReuse =
  | { readonly kind: 'music'; readonly form: MusicForm }
  | { readonly kind: 'sfx'; readonly rows: readonly SfxCueRow[] }

export type PromptView = {
  /** 何のプロンプトか（例「CUT-03 の Take #2」）。 */
  readonly title: string
  /** 使った AI。分からなければ null。 */
  readonly tool: string | null
  readonly createdAt: Date | null
  readonly sections: readonly PromptSection[]
  readonly facts: readonly PromptFact[]
  /** 本文に添える注意（記録が無い・組み立て直した文など）。 */
  readonly note?: string
  readonly reuse?: PromptReuse
}

export const REBUILT_TAKE_NOTE = '送った文と細部が違うことがあります'
export const UNRECORDED_IMAGE_NOTE = 'この絵は送った文を記録していません'
export const UNRECORDED_VOICE_NOTE = '送った指示は記録していません。声の設定から出しています'

const SEED_UNSET = '決めずに作った（毎回違う）'

/** 曲・効果音の AI の名前。知らない ID はそのまま出す（推測で名前を付けない）。 */
const aiToolLabel = (tool: string): string =>
  tool in AI_TOOLS ? AI_TOOLS[tool as AiToolId].label : tool

const voiceToolLabel = (tool: VoiceToolId, model: string | null): string =>
  model === null ? VOICE_TOOL_LABELS[tool] : `${VOICE_TOOL_LABELS[tool]}（${model}）`

const sentSections = (sent: SentPrompt): readonly PromptSection[] => [
  { label: 'プロンプト', text: sent.prompt, mono: true },
  ...(sent.negativePrompt === undefined || sent.negativePrompt === ''
    ? []
    : [{ label: '除外する内容', text: sent.negativePrompt, mono: true }]),
]

const seedFact = (seed: number | null): PromptFact => ({ label: 'シード', value: seed === null ? SEED_UNSET : String(seed) })

export type TakeLike = Pick<
  Take,
  'index' | 'spec' | 'sentPrompt' | 'seedUsed' | 'modelId' | 'providerParams' | 'createdAt'
>

/**
 * 動画の Take。送った文があればそれを、無ければ材料から組んだ文（`spec.prompt`）を注記つきで出す。
 * 持ち込んだ動画はアプリの外で作ったので出さない（null）。
 */
export const promptViewFromTake = (take: TakeLike, shotCode: string | null): PromptView | null => {
  if (take.providerParams.kind === 'import') return null
  const sent: SentPrompt =
    take.sentPrompt ?? {
      prompt: take.spec.prompt,
      ...(take.spec.negativePrompt === null ? {} : { negativePrompt: take.spec.negativePrompt }),
    }
  return {
    title: shotCode === null ? `Take #${String(take.index)}` : `${shotCode} の Take #${String(take.index)}`,
    tool: takeModelLabel(take),
    createdAt: take.createdAt,
    sections: sentSections(sent),
    facts: [{ label: '長さ', value: formatDuration(take.spec.durationSec) }, seedFact(take.seedUsed ?? take.spec.seed)],
    ...(take.sentPrompt === null ? { note: REBUILT_TAKE_NOTE } : {}),
  }
}

export type ImageJobLike = {
  /** 送った指示の本文。記録する前の絵・古い API は null か無し。 */
  readonly sentPrompt?: string | null
  readonly modelId?: string | null
  readonly queuedAt: Date
}

/** 絵（開始画像・キーアート・四面図）。記録する前に作った絵は本文の代わりに注記を出す。 */
export const promptViewFromImageJob = (job: ImageJobLike, title: string): PromptView => {
  const sent = job.sentPrompt ?? null
  return {
    title,
    tool: job.modelId ?? null,
    createdAt: job.queuedAt,
    sections: sent === null ? [] : [{ label: 'プロンプト', text: sent, mono: true }],
    facts: [],
    ...(sent === null ? { note: UNRECORDED_IMAGE_NOTE } : {}),
  }
}

export type MusicSourceLike = {
  readonly prompt: string
  readonly lyrics: string
  readonly instrumental: boolean
  readonly seed: number | null
  readonly durationSec: number
  readonly tool: string
  readonly model: string | null
  readonly createdAt: Date
}

/** 楽曲。AI で作った曲だけ（持ち込んだ曲は null）。「これを元に作る」は同じ頼み方を 1 曲で入れる。 */
export const promptViewFromMusic = (title: string, source: MusicSourceLike | null): PromptView | null => {
  if (source === null) return null
  const lyrics = source.instrumental ? '' : source.lyrics
  return {
    title,
    tool: source.model === null ? aiToolLabel(source.tool) : `${aiToolLabel(source.tool)}（${source.model}）`,
    createdAt: source.createdAt,
    sections: [
      { label: '曲調', text: source.prompt, mono: true },
      ...(lyrics === '' ? [] : [{ label: '歌詞', text: lyrics, mono: true }]),
    ],
    facts: [
      { label: '長さ', value: formatDuration(source.durationSec) },
      { label: '歌', value: source.instrumental ? '入れない' : '入れる' },
      seedFact(source.seed),
    ],
    reuse: {
      kind: 'music',
      form: {
        prompt: source.prompt,
        lyrics,
        durationSec: String(source.durationSec),
        instrumental: source.instrumental,
        count: '1',
      },
    },
  }
}

export type SfxSourceLike = {
  readonly cue: SfxCueLike & { readonly negativePrompt?: string }
  readonly seed: number | null
  readonly tool: string | null
  readonly createdAt: Date | null
}

/** 効果音。AI で作った音だけ（取り込んだ音は null）。「これを元に作る」は同じきっかけを 1 行で入れる。 */
export const promptViewFromSfx = (title: string, source: SfxSourceLike | null): PromptView | null => {
  if (source === null) return null
  const { cue } = source
  return {
    title,
    tool: source.tool === null ? null : aiToolLabel(source.tool),
    createdAt: source.createdAt,
    sections: sentSections({ prompt: cue.prompt, ...(cue.negativePrompt === undefined ? {} : { negativePrompt: cue.negativePrompt }) }),
    facts: [{ label: '長さ', value: formatDuration(cue.durationSec) }, seedFact(source.seed)],
    reuse: { kind: 'sfx', rows: [cueRowFromCue(cue)] },
  }
}

export type VoiceTakeLike = {
  readonly index: number
  readonly voiceSpec?: VoiceSpec | null
  readonly sentStyle?: string | null
  readonly createdAt: Date
}

const styleSections = (spec: VoiceSpec): readonly PromptSection[] => [
  ...(spec.styleNote.trim() === '' ? [] : [{ label: '声のイメージ', text: spec.styleNote, mono: false }]),
  ...(spec.direction.trim() === '' ? [] : [{ label: '演出', text: spec.direction, mono: false }]),
]

/**
 * ナレーションの Take。AI で作った Take だけ（録音・複製は null）。
 * 送った読み方の指示があればそれを、無ければ声の設定（声のイメージ・演出）を注記つきで出す。
 */
export const promptViewFromVoice = (take: VoiceTakeLike, lineLabel: string): PromptView | null => {
  const spec = take.voiceSpec ?? null
  if (spec === null) return null
  const sentStyle = take.sentStyle ?? null
  const style = sentStyle === null ? styleSections(spec) : [{ label: '声の演技指示', text: sentStyle, mono: true }]
  return {
    title: `${lineLabel} の Take #${String(take.index)}`,
    tool: voiceToolLabel(spec.tool, spec.model),
    createdAt: take.createdAt,
    sections: [{ label: '読み', text: spec.reading, mono: true }, ...style],
    facts: [
      { label: '声', value: spec.voiceName },
      { label: '速さ', value: `×${spec.speed.toFixed(2)}` },
    ],
    ...(sentStyle === null && style.length > 0 ? { note: UNRECORDED_VOICE_NOTE } : {}),
  }
}

/** 「全部コピー」の文。欄ごとに見出しを付け、空行で区切る。補足は最後にまとめる。 */
export const promptViewCopyText = (view: PromptView): string =>
  [
    ...view.sections.map((section) => `${section.label}\n${section.text}`),
    ...(view.facts.length === 0 ? [] : [view.facts.map((fact) => `${fact.label}: ${fact.value}`).join('\n')]),
  ].join('\n\n')
