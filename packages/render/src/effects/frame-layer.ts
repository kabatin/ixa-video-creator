/**
 * あるコマでの絵（VIDEO1・VIDEO2）の動かし方（ADR-0050）。位置・ぼかし・色ずれは映像の幅（縦は高さ）に
 * 対する割合で持ち、出力の大きさが変わっても同じ見た目になるようにする。
 */
export type FrameLayerState = {
  readonly translateX: number
  readonly translateY: number
  readonly scale: number
  readonly rotateDeg: number
  /** 横向きのぼかし（whip_pan の流れ）。 */
  readonly blurX: number
  /** 赤と青を左右へずらす幅（glitch）。 */
  readonly rgbSplit: number
  readonly brightness: number
}

export const IDENTITY_FRAME_LAYER: FrameLayerState = Object.freeze({
  translateX: 0, translateY: 0, scale: 1, rotateDeg: 0, blurX: 0, rgbSplit: 0, brightness: 1,
})

/** 1 つの型が足す分。書かない項目は何もしない。 */
export type FrameContribution = Partial<FrameLayerState>
