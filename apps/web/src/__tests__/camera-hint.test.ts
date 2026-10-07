import { describe, expect, it } from 'vitest'
import { CAMERA_MOVEMENT_HINT, cameraMovementBulkLine } from '@/lib/camera-hint'

/**
 * カメラの動きが決まっていない Shot への一言（ADR-0042）。
 * **0 件のときに出さない**（毎回出ると読まれなくなる）。
 */
describe('cameraMovementBulkLine', () => {
  it('0 件なら出さない', () => {
    expect(cameraMovementBulkLine(0)).toBe('')
  })

  it('件数を数で言う', () => {
    expect(cameraMovementBulkLine(39)).toContain('39 件')
  })

  it('どこで直すかまで言う', () => {
    expect(cameraMovementBulkLine(1)).toContain('カメラの動き')
  })
})

describe('CAMERA_MOVEMENT_HINT', () => {
  /** 画面に実装の名前（provider 名）や HTTP の番号を出さない（CLAUDE.md「画面の言葉」）。 */
  it('直し方と、動かない Shot の選び方の両方を言う', () => {
    expect(CAMERA_MOVEMENT_HINT).toContain('ティルト')
    expect(CAMERA_MOVEMENT_HINT).toContain('フィックス')
    expect(CAMERA_MOVEMENT_HINT).toContain('詳しい設定')
  })
})
