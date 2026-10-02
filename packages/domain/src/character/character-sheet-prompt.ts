import type { CharacterIdentityImageId } from '../common/ids.js'
import type { Character, CharacterIdentityImage } from './character.js'

/**
 * キャラクターシート（四面図）を作る指示（ADR-0035。制作者 2026-10-03「動画生成に役立つ形式のキャラクターシートを
 * 1 枚の画像から作れるといい。正面などの画像を用意したら、それを基に Codex CLI で作る」）。**純粋な関数のみ。**
 *
 * できたシートは識別画像の「四面図」になり、動画・絵コンテの参照で優先して使われる（`reference-resolver.ts`）。
 * そのため、4 つの向きの全身を**同じ縮尺**で並べ、**文字を入れない**（文字は動画にも写り込む）。
 * 手本の画像（参照の `subject`）の人物をそのまま描かせる。特徴の言葉は手本を補うだけ。
 * Codex への包み（大きさ・保存先）は `providers/image` の `instruction.ts` が足す。
 */

export type CharacterSheetPromptInput = Pick<
  Character,
  'displayName' | 'description' | 'identityAnchors' | 'styleTokens' | 'colorPalette'
>

const line = (label: string, values: readonly string[]): readonly string[] =>
  values.length === 0 ? [] : [`${label}: ${values.join('、')}`]

export const compileCharacterSheetPrompt = (character: CharacterSheetPromptInput): string =>
  [
    `これは「${character.displayName}」のキャラクターシート（四面図）。character turnaround sheet。`,
    '手本の画像の人物と同じ人物を、1 枚の横長の画像に描く。',
    '- 左から 正面・横（右向き）・背面・斜め前 の 4 つの全身を、同じ縮尺・同じ足の高さで横一列に並べる',
    '- 立ち姿は自然な A ポーズ（腕を体から少し離す）。表情は穏やかに',
    '- 顔・髪型・体型・服装・色は手本の画像に合わせ、4 つの間で変えない',
    '- 背景は無地の明るい灰色。影・小物・ほかの人物は描かない',
    '- 文字・ラベル・矢印・枠線・署名は入れない',
    ...line('人物の特徴', character.identityAnchors),
    ...line('説明', character.description.trim() === '' ? [] : [character.description.trim()]),
    ...line('色', character.colorPalette),
    ...line('画風', character.styleTokens),
  ].join('\n')

/**
 * シートの手本にする識別画像。指定があればそれ、無ければ四面図以外の主の画像、主が無ければ順番が最初の 1 枚。
 * **四面図は手本にしない**（シートからシートを作っても、手本の人物に寄らない）。使えなければ null。
 */
export const pickSheetReference = (
  images: readonly CharacterIdentityImage[],
  chosenId?: CharacterIdentityImageId,
): CharacterIdentityImage | null => {
  const usable = images.filter((image) => image.role !== 'four_view')
  if (chosenId !== undefined) return usable.find((image) => image.id === chosenId) ?? null
  const byOrder = [...usable].sort((a, b) => a.order - b.order)
  return byOrder.find((image) => image.isPrimary) ?? byOrder[0] ?? null
}
