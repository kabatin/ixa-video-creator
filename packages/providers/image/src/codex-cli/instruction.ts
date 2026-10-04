import type { ReferenceRole } from '@ixa/domain'
import type { CodexFrame } from './descriptor.js'

/** Codex に保存させるファイル名（作業ディレクトリの中）。 */
export const CODEX_OUTPUT_FILE = 'frame.png'

/** 参照画像が何の手本かの言い方。 */
const ROLE_LABELS: Readonly<Record<ReferenceRole, string>> = {
  subject: '登場人物の見た目（顔・髪・体つき）',
  wardrobe: '衣装',
  location: '場所',
  style: '画風・色調',
  brand: 'ブランドのロゴや色',
  start_frame: '最初の 1 コマ',
  end_frame: '最後の 1 コマ',
  previous_shot_last_frame: '前のカットの最後の 1 コマ',
}

/**
 * Codex へ渡す指示（stdin）。**中身の説明（`prompt`）は呼び出し側が作る。** ここで足すのは
 * Codex に画像を作らせる手順だけ: 画像生成ツールで 1 枚、形と大きさ、参照画像の意味、保存先。
 *
 * 場面の絵は切り抜いて使う（`codexFrameFor`）ので、主題が端に寄らないよう伝える。
 * キャラクターシート（`composition: 'sheet'`。ADR-0035）は 1 枚の中に並べる絵で切り抜かないので、
 * 「中央に寄せる」「候補を並べない」は言わない（4 つの向きを並べる指示とぶつかる）。
 */
export const buildCodexImageInstruction = (input: {
  readonly prompt: string
  readonly frame: CodexFrame
  readonly referenceRoles: readonly ReferenceRole[]
  readonly composition?: 'frame' | 'sheet'
}): string => {
  const { frame } = input
  const references = input.referenceRoles.map(
    (role, index) => `- 参照画像 ${String(index + 1)}: ${ROLE_LABELS[role]}の手本。形や色を保つ`,
  )
  return [
    `画像生成ツールで、${frame.label}（${String(frame.width)}x${String(frame.height)}）の画像を 1 枚だけ作ってください。`,
    '',
    '# 描くもの',
    input.prompt,
    '',
    ...(references.length === 0 ? [] : ['# 添えた参照画像', ...references, '']),
    '# 守ること',
    '- 文字・字幕・ロゴの透かしを入れない（参照画像にあるブランドのロゴは除く）',
    ...(input.composition === 'sheet'
      ? [
          '- 切り抜かないので、画像の端まで使ってよい。並べ方は「描くもの」に従う',
          '- 1 枚の画像として仕上げる（別の案の画像を何枚も作らない）',
        ]
      : [
          '- 主題は中央寄りに置く。上下または左右が少し切り取られても成り立つ構図にする',
          '- 1 枚だけ作る。候補を並べない',
        ]),
    '',
    `できた画像は、この作業ディレクトリに ${CODEX_OUTPUT_FILE} という名前で保存してください。説明の文章は不要です。`,
  ].join('\n')
}
