import { Shot, ShotId, THUMBNAIL_LAYOUTS, TakeId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { TAKE_ID, shotJson } from '@/__tests__/fixtures'
import type { ShotPosterMap, ShotPosterView } from '@/lib/shot-posters'
import {
  NO_BACKGROUND_MESSAGE,
  checkThumbnailForm,
  clampFraction,
  LAYOUT_LABELS,
  initialThumbnailForm,
  layoutCell,
  previewSpec,
  shotPictureChoices,
} from '@/lib/thumbnail-form'

/** サムネイルの書き出し画面の判定（ADR-0051）。上限は domain の `ThumbnailSpec` が正。 */

const frame = { kind: 'timeline_frame', atSec: 3 } as const
const form = (patch: Partial<ReturnType<typeof initialThumbnailForm>> = {}) => ({
  ...initialThumbnailForm('iXA CUP'),
  background: frame,
  ...patch,
})

describe('checkThumbnailForm', () => {
  it('背景を選んでいなければ送らない', () => {
    expect(checkThumbnailForm(initialThumbnailForm('iXA CUP'))).toEqual({ ok: false, messages: [NO_BACKGROUND_MESSAGE] })
  })

  it('domain の検査を通した仕様を返す（空の副題は null）', () => {
    const check = checkThumbnailForm(form({ subtitle: '  ' }))
    expect(check.ok && check.spec).toMatchObject({ title: 'iXA CUP', subtitle: null, background: frame })
  })

  it('題名が長すぎ・空なら domain の言葉で止める', () => {
    const tooLong = checkThumbnailForm(form({ title: 'あ'.repeat(41) }))
    expect(tooLong.ok ? [] : tooLong.messages).toEqual(['題名は 40 字までにしてください'])
    const empty = checkThumbnailForm(form({ title: ' ' }))
    expect(empty.ok ? [] : empty.messages).toEqual(['題名を入れてください'])
  })
})

describe('大きさ・副題の色・差し色のバー・9 つの配置', () => {
  it('既定は自動の大きさ・白い副題・差し色のバーあり・左', () => {
    expect(initialThumbnailForm('iXA CUP')).toMatchObject({
      titleSize: null,
      subtitleSize: null,
      subtitleColor: '#ffffff',
      accentBar: true,
      layout: 'middle_left',
    })
  })

  it('決めた値はそのまま仕様に入る', () => {
    const check = checkThumbnailForm(
      form({ titleSize: 160, subtitleSize: 90, subtitleColor: '#00ff88', accentBar: false, layout: 'top_right' }),
    )
    expect(check.ok && check.spec).toMatchObject({
      titleSize: 160,
      subtitleSize: 90,
      subtitleColor: '#00ff88',
      accentBar: false,
      layout: 'top_right',
    })
  })

  it('範囲の外の大きさは domain の検査で止める（画面に上限を書き写さない）', () => {
    expect(checkThumbnailForm(form({ titleSize: 201 })).ok).toBe(false)
    expect(checkThumbnailForm(form({ subtitleSize: 19 })).ok).toBe(false)
    expect(previewSpec(form({ titleSize: 27 }))).toBeNull()
  })

  it('配置は domain の 9 つすべてに名前があり、3×3 のマスに並ぶ', () => {
    expect(Object.keys(LAYOUT_LABELS)).toEqual([...THUMBNAIL_LAYOUTS])
    expect(layoutCell('top_left')).toEqual({ row: 0, column: 0 })
    expect(layoutCell('middle_right')).toEqual({ row: 1, column: 2 })
    expect(layoutCell('bottom_center')).toEqual({ row: 2, column: 1 })
  })
})

describe('previewSpec', () => {
  it('打っている途中の題名（空・長すぎ）でも背景と配置は見せる', () => {
    expect(previewSpec(form({ title: '' }))?.title).toBe('')
    expect(previewSpec(form({ title: 'あ'.repeat(45) }))?.title).toHaveLength(45)
  })

  it('背景が無ければ null', () => {
    expect(previewSpec(initialThumbnailForm('x'))).toBeNull()
  })
})

describe('shotPictureChoices', () => {
  const shot = (n: number, startSec: number, selectedTakeId: string | null): Shot =>
    Shot.parse({
      ...shotJson,
      id: ShotId.parse(`01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, '0')}`),
      code: `S01-${String(n).padStart(3, '0')}`,
      startSec,
      selectedTakeId: selectedTakeId === null ? null : TakeId.parse(selectedTakeId),
      createdAt: new Date(shotJson.createdAt),
      updatedAt: new Date(shotJson.updatedAt),
    })
  const poster = (hasStartFrame: boolean): ShotPosterView => ({
    url: 'https://example.test/p.jpg',
    reason: null,
    pending: false,
    hasStartFrame,
    drawing: false,
  })

  it('採用 Take があればタイムラインの真ん中のコマ、無ければ最初のフレーム。どちらも無い Shot は出さない', () => {
    const shots = [shot(3, 8, null), shot(1, 0, TAKE_ID), shot(2, 4, null)]
    const posters: ShotPosterMap = new Map([
      [shots[0]?.id ?? ShotId.parse(shotJson.id), poster(true)],
      [shots[2]?.id ?? ShotId.parse(shotJson.id), poster(false)],
    ])
    expect(shotPictureChoices(shots, posters).map(({ code, kind, atSec }) => ({ code, kind, atSec }))).toEqual([
      { code: 'S01-001', kind: 'take', atSec: (shots[1]?.durationSec ?? 0) / 2 },
      { code: 'S01-003', kind: 'start_frame', atSec: 8 + (shots[0]?.durationSec ?? 0) / 2 },
    ])
  })
})

describe('clampFraction', () => {
  it('0〜1 に丸め、数でなければ真ん中', () => {
    expect(clampFraction(-1)).toBe(0)
    expect(clampFraction(2)).toBe(1)
    expect(clampFraction(Number.NaN)).toBe(0.5)
  })
})
