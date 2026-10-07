import { z } from 'zod'

export const ShotSize = z.enum([
  'extreme_wide', 'wide', 'medium_wide', 'medium', 'medium_closeup',
  'closeup', 'extreme_closeup', 'insert',
])
export type ShotSize = z.infer<typeof ShotSize>

/** 水平位置。景別(size)・俯仰(angle)と合わせて三軸でアングルを表す。 */
export const AngleHorizontal = z.enum([
  'front', 'front_left', 'front_right', 'side_left', 'side_right',
  'back_left', 'back_right', 'back',
])
export type AngleHorizontal = z.infer<typeof AngleHorizontal>

export const AngleVertical = z.enum(['eye', 'low', 'high', 'overhead', 'dutch'])
export type AngleVertical = z.infer<typeof AngleVertical>

export const CameraMovement = z.enum([
  'static', 'pan', 'tilt', 'push_in', 'pull_out', 'tracking',
  'handheld', 'crane', 'orbit',
])
export type CameraMovement = z.infer<typeof CameraMovement>

/** 動きの強さ。**名前を付けて出す**（絵コンテの案も画面も同じ値の一覧を読む）。 */
export const MovementIntensity = z.enum(['subtle', 'moderate', 'strong'])
export type MovementIntensity = z.infer<typeof MovementIntensity>

export const ShotCamera = z.object({
  size: ShotSize,
  angleH: AngleHorizontal.nullable(),
  angle: AngleVertical.nullable(),
  lensMm: z.number().positive().nullable(),
  movement: CameraMovement.nullable(),
  movementIntensity: MovementIntensity.nullable(),
})
export type ShotCamera = z.infer<typeof ShotCamera>

/**
 * 一部だけ決まった値を、いまのカメラへ**重ねる**。
 *
 * **全体の置換にしない。** 「景別だけ変える」で置き換えると、触っていない動きや高さが消える。
 * 一括変更（`PATCH /shots/bulk`）と絵コンテの案の採用（ADR-0043）が同じ規則を読む。
 */
export const mergeShotCamera = (
  current: ShotCamera,
  patch: Partial<ShotCamera>,
): ShotCamera => ({ ...current, ...patch })

/**
 * カメラ指定をプロンプト断片へ落とす。
 * 構造化カメラ制御を持つのは Kling のみ（ARCHITECTURE.md §9）。
 * 非対応モデルではこの文字列をプロンプトに混ぜて縮退させる。
 */
export const cameraToPromptFragment = (camera: ShotCamera): string => {
  const parts: string[] = [camera.size.replace(/_/g, ' ')]
  if (camera.angleH) parts.push(`from ${camera.angleH.replace(/_/g, ' ')}`)
  if (camera.angle) parts.push(`${camera.angle} angle`)
  if (camera.lensMm) parts.push(`${camera.lensMm}mm lens`)
  if (camera.movement && camera.movement !== 'static') {
    const intensity = camera.movementIntensity ? `${camera.movementIntensity} ` : ''
    parts.push(`${intensity}${camera.movement.replace(/_/g, ' ')}`)
  }
  return parts.join(', ')
}
