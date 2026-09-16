import {
  AngleHorizontal,
  AngleVertical,
  CameraMovement,
  ShotCamera,
  ShotSize,
  type ShotCamera as ShotCameraValue,
} from '@ixa/domain'

/**
 * カメラ指定の選択肢。値は必ずドメインの enum から生成し、UI 側で文字列を並べない。
 * ラベルだけを union をキーにした Record で持つため、enum が増えれば型エラーで気付ける。
 */

export type Option = {
  readonly value: string
  readonly label: string
}

/** 「未指定」を表す select の値。カメラの多くの列は nullable なため必要。 */
export const NONE_VALUE = ''
const NONE_OPTION: Option = { value: NONE_VALUE, label: '未指定' }

const SIZE_LABELS: Readonly<Record<ShotSize, string>> = {
  extreme_wide: 'エクストリームワイド',
  wide: 'ワイド',
  medium_wide: 'ミディアムワイド',
  medium: 'ミディアム',
  medium_closeup: 'ミディアムクローズアップ',
  closeup: 'クローズアップ',
  extreme_closeup: 'エクストリームクローズアップ',
  insert: 'インサート',
}

const ANGLE_H_LABELS: Readonly<Record<AngleHorizontal, string>> = {
  front: '正面',
  front_left: '正面やや左',
  front_right: '正面やや右',
  side_left: '左真横',
  side_right: '右真横',
  back_left: '後方やや左',
  back_right: '後方やや右',
  back: '真後ろ',
}

const ANGLE_V_LABELS: Readonly<Record<AngleVertical, string>> = {
  eye: 'アイレベル',
  low: 'ロー',
  high: 'ハイ',
  overhead: 'オーバーヘッド',
  dutch: 'ダッチ',
}

const MOVEMENT_LABELS: Readonly<Record<CameraMovement, string>> = {
  static: 'フィックス',
  pan: 'パン',
  tilt: 'ティルト',
  push_in: 'プッシュイン',
  pull_out: 'プルアウト',
  tracking: 'トラッキング',
  handheld: '手持ち',
  crane: 'クレーン',
  orbit: 'オービット',
}

const MovementIntensity = ShotCamera.shape.movementIntensity.unwrap()
export type MovementIntensity = NonNullable<ShotCameraValue['movementIntensity']>

const INTENSITY_LABELS: Readonly<Record<MovementIntensity, string>> = {
  subtle: '弱',
  moderate: '中',
  strong: '強',
}

const toOptions = <T extends string>(
  values: readonly T[],
  labels: Readonly<Record<T, string>>,
): readonly Option[] => values.map((value) => ({ value, label: labels[value] }))

const withNone = (options: readonly Option[]): readonly Option[] => [NONE_OPTION, ...options]

export const SHOT_SIZE_OPTIONS: readonly Option[] = toOptions(ShotSize.options, SIZE_LABELS)

export const ANGLE_HORIZONTAL_OPTIONS: readonly Option[] = withNone(
  toOptions(AngleHorizontal.options, ANGLE_H_LABELS),
)

export const ANGLE_VERTICAL_OPTIONS: readonly Option[] = withNone(
  toOptions(AngleVertical.options, ANGLE_V_LABELS),
)

export const CAMERA_MOVEMENT_OPTIONS: readonly Option[] = withNone(
  toOptions(CameraMovement.options, MOVEMENT_LABELS),
)

export const MOVEMENT_INTENSITY_OPTIONS: readonly Option[] = withNone(
  toOptions(MovementIntensity.options, INTENSITY_LABELS),
)

/** 既定のカメラ。景別だけは必須なので enum の先頭ではなく中庸な値を選ぶ。 */
export const DEFAULT_SHOT_SIZE: ShotSize = ShotSize.enum.medium
