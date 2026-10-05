import { z } from 'zod'
import { MAX_DRAFT_DESCRIPTION_LENGTH } from '../storyboard/draft.js'

/**
 * 入力を AI が手伝う欄（ADR-0032 の 3 段目。制作者 2026-09-30「コンセプトとか世界観とかを入力するところで、
 * LLM で入力を補助してもらえるような機能」「各カットのプロンプトとか動画のクオリティに関係してくるテキストを入力する箇所全般で」）。
 *
 * 欄の横の「✦ AI」で案を出し、**使うかは人が決める**（勝手に書き換えない。ARCHITECTURE §11）。
 * 何に効く欄か・どう書くかはここに 1 か所。プロンプト（`provider-llm`）と画面が同じ値を読む。
 */
export const AssistField = z.enum([
  'concept',
  'look',
  'avoid',
  'shot_description',
  'shot_mood',
  'identity_anchors',
  'wardrobe',
  'location_description',
  'narration_script',
])
export type AssistField = z.infer<typeof AssistField>

export type AssistFieldSpec = {
  /** 画面の欄の名前。 */
  readonly label: string
  /** その欄がどこに効くか。AI に書き方を伝える。 */
  readonly purpose: string
  /**
   * prose = 文章、short = 短い語や句、tags = 読点で区切った語の並び（欄が読点で分ける）、
   * lines = 1 行 1 フレーズの並び（欄が改行で分ける）。
   */
  readonly format: 'prose' | 'short' | 'tags' | 'lines'
  /** 目安の上限（文字）。 */
  readonly maxLength: number
}

export const ASSIST_FIELDS: Readonly<Record<AssistField, AssistFieldSpec>> = {
  concept: {
    label: 'コンセプト・あらすじ',
    purpose: '作品全体のあらすじと世界観。AI が各 Shot の説明を書くとき（絵コンテの案）の材料になる',
    format: 'prose',
    maxLength: 1200,
  },
  look: {
    label: 'ルック（画風・光・質感）',
    purpose: '全 Shot の映像と絵の生成指示の最後に入る。画風・光・色・質感・レンズ感を短い句で並べる',
    format: 'short',
    maxLength: 200,
  },
  avoid: {
    label: '避けたいもの',
    purpose: '絵の生成と AI の下書きに「避けること」として入る。避けたい物・表現を読点で並べる',
    format: 'tags',
    maxLength: 200,
  },
  shot_description: {
    label: 'Shot の説明',
    purpose: 'その Shot で何を映すか。映像と絵の生成指示の中心になる。被写体・動き・場所・光を具体的に',
    format: 'prose',
    maxLength: MAX_DRAFT_DESCRIPTION_LENGTH,
  },
  shot_mood: {
    label: '雰囲気（mood）',
    purpose: 'その Shot の雰囲気を表す短い語。生成指示に添える',
    format: 'short',
    maxLength: 40,
  },
  identity_anchors: {
    label: '識別アンカー',
    purpose: 'その人物だと分かる見た目の特徴（顔立ち・髪・体格・印になる持ち物）。どの Shot でも同じ人物に見せるために入る',
    format: 'tags',
    maxLength: 300,
  },
  wardrobe: {
    label: '衣装',
    purpose: 'その Look の服装と小物。色・素材・形を具体的に',
    format: 'tags',
    maxLength: 300,
  },
  location_description: {
    label: 'ロケーションの説明',
    purpose: 'その場所の見た目（広さ・素材・光・時間帯の印象）。その場所が出る Shot の生成に入る',
    format: 'prose',
    maxLength: 400,
  },
  narration_script: {
    label: 'ナレーションの原稿',
    purpose: '読み上げる言葉そのもの（ADR-0038）。1 行が 1 フレーズになり、行ごとに声を作って映像に載せる',
    format: 'lines',
    maxLength: 2000,
  },
}
