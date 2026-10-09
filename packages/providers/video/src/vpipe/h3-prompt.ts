import type { ShotCamera, ShotGenerationSpec } from '@ixa/domain'

/**
 * MiniMax H3 の公式の書き方へ組み直す（ADR-0042。公式ガイド
 * `VIDEO_PROMPT_WRITING_GUIDE_base_en.md`）。
 *
 * **ここは H3 だけの事情。** 共通の `compileSpec` / `assemblePrompt`（domain）は変えない。
 * 変えると specHash が動いて、既にある Take との同一判定が壊れる。
 *
 * 実測（2026-10-07・同じ開始画像と同じシードで 1 か所ずつ変えた）:
 * - いまの書き方（日本語の羅列）2.333 秒 … **立ち上がらない**（髪が揺れるだけ）
 * - 公式の書き方 2.333 秒 … 指示どおり立ち上がる
 * - 公式の構造のまま、カット説明だけ日本語 … 英語版と見分けが付かない
 *
 * だから**カット説明は日本語のまま入れる**（英訳の仕組みは要らない）。
 * 構造と、構造化された値から作る文（画風・景別・カメラ・音）だけを英語で組み立てる。
 */

/**
 * 組み立ての版。**一度出した版の文面は変えない。**
 *
 * 送った文面は Take に保存していない（`poll` はジョブ ID しか受け取らない）。
 * 代わりにこの版を記録し、**同じ仕様と同じ版からいつでも同じ文面を組み直せる**ようにしてある。
 * 文面を変えたくなったら次の版を足す。`__tests__` のゴールデンがここを守る。
 *
 * ### 版の履歴（組み直すときはこの表に従う）
 *
 * | 版 | 1 行目（参照の定型文） | 組み直し方 |
 * |---|---|---|
 * | `h3-official-v1` | **常に無し**（開始画像を送っていても） | `hasStartImage: false` で組む |
 * | `h3-official-v2` | 開始画像を送ったときだけ有り | 記録の `startImage` の有無で組む |
 *
 * v1 は**取り違えのまま出していた版**（2026-10-07〜10-09）。投入では画像を取り寄せる前に本文を組むため、
 * 文面がいつも「画像なし」で組まれていた。v1 の Take（113 本）は「1 行目無し」が送った文面そのものなので、
 * 記録どおりに組み直せるよう版を分けた（文面の関数は同じで、渡す条件だけが違う）。
 */
export const H3_PROMPT_FORMAT = 'h3-official-v2'

/** 1 行目（開始画像だけ）。**一字一句この通り**（公式ガイド）。 */
const IMAGE_TO_VIDEO_LINE =
  'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'

/** 1 行目（開始画像と最後の画像）。`S.SS` は動画の長さ。 */
const firstLastLine = (durationSec: number): string =>
  'How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the ' +
  `0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the ${durationSec.toFixed(2)}-second mark ` +
  'of the target video.'

const SHOT_SIZES: Readonly<Record<ShotCamera['size'], string>> = Object.freeze({
  extreme_wide: 'an extreme wide shot',
  wide: 'a wide shot',
  medium_wide: 'a medium wide shot',
  medium: 'a medium shot',
  medium_closeup: 'a medium close-up',
  closeup: 'a close-up',
  extreme_closeup: 'an extreme close-up',
  insert: 'an insert shot',
})

const HORIZONTAL_ANGLES: Readonly<Record<NonNullable<ShotCamera['angleH']>, string>> = Object.freeze({
  front: 'from the front',
  front_left: 'from the front left',
  front_right: 'from the front right',
  side_left: 'from the left side',
  side_right: 'from the right side',
  back_left: 'from behind on the left',
  back_right: 'from behind on the right',
  back: 'from behind',
})

const VERTICAL_ANGLES: Readonly<Record<NonNullable<ShotCamera['angle']>, string>> = Object.freeze({
  eye: 'at eye level',
  low: 'from a low angle',
  high: 'from a high angle',
  overhead: 'from directly overhead',
  dutch: 'with a dutch tilt',
})

/**
 * カメラの動き（資料 3.3 の表）。**タグを末尾に並べず、1 文にする。**
 * `{motion}` に振れ幅と速さが入る。`movementIntensity` が無ければ、その部分ごと省く
 * （**強さを決めつけない**）。
 */
const CAMERA_MOVEMENTS: Readonly<Record<NonNullable<ShotCamera['movement']>, string>> = Object.freeze({
  static: 'The camera holds a static shot',
  pan: 'The camera pans',
  tilt: 'The camera tilts',
  push_in: 'The camera pushes in',
  pull_out: 'The camera pulls out',
  tracking: 'The camera follows the subject in a tracking shot',
  handheld: 'The camera shakes, handheld',
  crane: 'The camera cranes',
  orbit: 'The camera arcs around the subject',
})

/** `movementIntensity` を振れ幅と速さにする（subtle/moderate/strong → small/medium/large）。 */
const MOVEMENT_INTENSITIES: Readonly<
  Record<NonNullable<ShotCamera['movementIntensity']>, string>
> = Object.freeze({
  subtle: 'with small amplitude at slow speed',
  moderate: 'with medium amplitude at moderate speed',
  strong: 'with large amplitude at fast speed',
})

/** 文の終わりに `.` を 1 つだけ付ける（日本語の `。` で終わっていればそのまま）。 */
const asSentence = (text: string): string => {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  return /[.。!?！？]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

const framingSentence = (camera: ShotCamera): string => {
  const parts = [
    SHOT_SIZES[camera.size],
    camera.angleH === null ? '' : HORIZONTAL_ANGLES[camera.angleH],
    camera.angle === null ? '' : VERTICAL_ANGLES[camera.angle],
    camera.lensMm === null ? '' : `on a ${String(camera.lensMm)}mm lens`,
  ].filter((part) => part !== '')
  return `Framed as ${parts.join(', ')}`
}

/**
 * カメラの動きの文。**`movement` が無ければ 1 文も書かない。**
 * 書かないことで「指定なし」がそのまま伝わる（勝手に static にしない）。
 */
export const cameraMovementSentence = (camera: ShotCamera): string | null => {
  if (camera.movement === null) return null
  const motion = CAMERA_MOVEMENTS[camera.movement]
  // static に振れ幅と速さを付けない（止めているものの速さは無い）。
  if (camera.movement === 'static' || camera.movementIntensity === null) return `${motion}.`
  return `${motion} ${MOVEMENT_INTENSITIES[camera.movementIntensity]}.`
}

export type H3PromptInput = {
  readonly spec: ShotGenerationSpec
  /** 開始画像を付けて投げるか（`chooseStartImage` の結果）。 */
  readonly hasStartImage: boolean
  /** 最後の画像を付けて投げるか。**いまは常に false**（付ける画面がまだ無い）。 */
  readonly hasEndImage: boolean
}

/**
 * 公式の構造へ組み直した本文を返す。**純関数**（同じ仕様からは必ず同じ文字列）。
 *
 * 1 行目（参照画像の対応）→ `integrated_multimodal_description` → `overall_soundscape`
 * → `non_diegetic_music` の順。音の 2 欄は vpipe-api が捨てるが、書式として必須。
 */
export const buildH3Prompt = (input: H3PromptInput): string => {
  const { spec, hasStartImage, hasEndImage } = input
  const parts = spec.promptParts

  const referenceLine = hasEndImage
    ? firstLastLine(spec.durationSec)
    : hasStartImage
      ? IMAGE_TO_VIDEO_LINE
      : null

  const firstFrame = [...parts.identityAnchors, ...parts.wardrobeTokens]
  const description = [
    // 画風（最初の 1 文にまとめる。末尾のタグ列にしない）
    asSentence(parts.styleGuide),
    parts.styleTokens.length === 0 ? '' : asSentence(parts.styleTokens.join(', ')),
    parts.colorPalette.length === 0 ? '' : asSentence(`Color palette: ${parts.colorPalette.join(', ')}`),
    // 景別・角度・レンズ
    asSentence(framingSentence(spec.camera)),
    // 1 コマ目の状態（キャラクターの見た目と衣装。空なら書かない）
    firstFrame.length === 0 ? '' : asSentence(`At the first frame: ${firstFrame.join(', ')}`),
    // 動作（カット説明。**日本語のまま入れる**）
    asSentence(parts.shotDescription),
    parts.moodFragment === null ? '' : asSentence(`Mood: ${parts.moodFragment}`),
    // レビューの指摘から人が選んだ直し。**落とすと直しが届かない。**
    ...(spec.corrections ?? []).map(asSentence),
    // カメラの動き（最後）
    cameraMovementSentence(spec.camera) ?? '',
  ]
    .filter((sentence) => sentence !== '')
    .join(' ')

  return [
    ...(referenceLine === null ? [] : [referenceLine, '']),
    `integrated_multimodal_description: [Shot 1] ${description}`,
    '',
    // 音は使わないが、書式として必須（vpipe-api は音声を捨てる）。
    'overall_soundscape: Natural ambience that matches the scene.',
    '',
    'non_diegetic_music: None.',
  ].join('\n')
}
