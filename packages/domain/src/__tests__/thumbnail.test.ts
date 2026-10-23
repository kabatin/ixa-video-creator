import { describe, expect, it } from 'vitest'
import {
  MediaAssetId,
  MediaOrigin,
  ProjectId,
  THUMBNAIL_SUBTITLE_MAX_LENGTH,
  THUMBNAIL_LAYOUTS,
  THUMBNAIL_SUBTITLE_SIZE_MAX,
  THUMBNAIL_SUBTITLE_SIZE_MIN,
  THUMBNAIL_TITLE_MAX_LENGTH,
  THUMBNAIL_TITLE_SIZE_MAX,
  THUMBNAIL_TITLE_SIZE_MIN,
  Thumbnail,
  ThumbnailId,
  ThumbnailJobData,
  ThumbnailSpec,
  thumbnailExportFileName,
  thumbnailViolation,
} from '../index.js'

/**
 * YouTube のサムネイル（ADR-0051）。仕様の上限は **破る値で落ちること**まで確かめる
 * （上限を緩めても 0 件しか落ちない検査は素通りしている。L-027）。
 */

const assetId = MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW')
const frame = { kind: 'timeline_frame', atSec: 12.5 } as const

const parse = (patch: Record<string, unknown>) =>
  ThumbnailSpec.safeParse({ background: frame, title: '新曲', ...patch })

describe('ThumbnailSpec', () => {
  it('省いた項目に既定値が入る', () => {
    expect(ThumbnailSpec.parse({ background: frame, title: '新曲' })).toEqual({
      background: frame,
      zoom: 1,
      focusX: 0.5,
      focusY: 0.5,
      title: '新曲',
      subtitle: null,
      layout: 'middle_left',
      titleSize: null,
      subtitleSize: null,
      titleColor: '#ffffff',
      subtitleColor: '#ffffff',
      accentBar: true,
      accentColor: '#ffcc00',
      font: 'gothic',
    })
  })

  it('3 マスだった頃の配置は 9 マスの値に読み替える（保存済みの spec・古い入力）', () => {
    expect(ThumbnailSpec.parse({ background: frame, title: '新曲', layout: 'left' }).layout).toBe('middle_left')
    expect(ThumbnailSpec.parse({ background: frame, title: '新曲', layout: 'center' }).layout).toBe('middle_center')
    expect(ThumbnailSpec.parse({ background: frame, title: '新曲', layout: 'bottom' }).layout).toBe('bottom_left')
  })

  it('9 マスの配置はそのまま通す', () => {
    for (const layout of THUMBNAIL_LAYOUTS) {
      expect(ThumbnailSpec.parse({ background: frame, title: '新曲', layout }).layout).toBe(layout)
    }
  })

  it('題名の大きさは 28〜200 の整数か null（自動）。外は落とす', () => {
    expect(parse({ titleSize: THUMBNAIL_TITLE_SIZE_MIN }).success).toBe(true)
    expect(parse({ titleSize: THUMBNAIL_TITLE_SIZE_MAX }).success).toBe(true)
    expect(parse({ titleSize: null }).success).toBe(true)
    expect(parse({ titleSize: 27 }).success).toBe(false)
    expect(parse({ titleSize: 201 }).success).toBe(false)
    expect(parse({ titleSize: 80.5 }).success).toBe(false)
  })

  it('副題の大きさは 20〜120 の整数か null（自動）。外は落とす', () => {
    expect(parse({ subtitleSize: THUMBNAIL_SUBTITLE_SIZE_MIN }).success).toBe(true)
    expect(parse({ subtitleSize: THUMBNAIL_SUBTITLE_SIZE_MAX }).success).toBe(true)
    expect(parse({ subtitleSize: 19 }).success).toBe(false)
    expect(parse({ subtitleSize: 121 }).success).toBe(false)
  })

  it('差し色のバーは真偽値だけ', () => {
    expect(ThumbnailSpec.parse({ background: frame, title: '新曲', accentBar: false }).accentBar).toBe(false)
    expect(parse({ accentBar: 'no' }).success).toBe(false)
  })

  it('背景は素材の画像でもよい', () => {
    expect(parse({ background: { kind: 'image', mediaAssetId: assetId } }).success).toBe(true)
  })

  it('拡大は 1〜2 倍。端の値は通し、外は落とす', () => {
    expect(parse({ zoom: 1 }).success).toBe(true)
    expect(parse({ zoom: 2 }).success).toBe(true)
    expect(parse({ zoom: 0.99 }).success).toBe(false)
    expect(parse({ zoom: 2.01 }).success).toBe(false)
    expect(parse({ zoom: Number.NaN }).success).toBe(false)
  })

  it('寄せは 0〜1。外は落とす', () => {
    expect(parse({ focusX: 0, focusY: 1 }).success).toBe(true)
    expect(parse({ focusX: -0.01 }).success).toBe(false)
    expect(parse({ focusY: 1.01 }).success).toBe(false)
  })

  it('題名は 1〜40 字（前後の空白は数えない）', () => {
    expect(parse({ title: 'あ'.repeat(THUMBNAIL_TITLE_MAX_LENGTH) }).success).toBe(true)
    expect(parse({ title: 'あ'.repeat(THUMBNAIL_TITLE_MAX_LENGTH + 1) }).success).toBe(false)
    expect(parse({ title: '' }).success).toBe(false)
    expect(parse({ title: '   ' }).success).toBe(false)
    expect(ThumbnailSpec.parse({ background: frame, title: '  新曲  ' }).title).toBe('新曲')
  })

  it('絵文字は 1 字と数える（UTF-16 の長さで数えない）', () => {
    expect(parse({ title: '🎵'.repeat(THUMBNAIL_TITLE_MAX_LENGTH) }).success).toBe(true)
  })

  it('副題は 60 字まで。空は「副題なし」（null）にする', () => {
    expect(parse({ subtitle: 'い'.repeat(THUMBNAIL_SUBTITLE_MAX_LENGTH) }).success).toBe(true)
    expect(parse({ subtitle: 'い'.repeat(THUMBNAIL_SUBTITLE_MAX_LENGTH + 1) }).success).toBe(false)
    expect(ThumbnailSpec.parse({ background: frame, title: '新曲', subtitle: ' ' }).subtitle).toBeNull()
  })

  it('色は #RRGGBB だけ', () => {
    expect(parse({ titleColor: '#A1b2C3', accentColor: '#000000' }).success).toBe(true)
    expect(parse({ titleColor: 'red' }).success).toBe(false)
    expect(parse({ accentColor: '#fff' }).success).toBe(false)
    expect(parse({ subtitleColor: '#00ff88' }).success).toBe(true)
    expect(parse({ subtitleColor: 'white' }).success).toBe(false)
    expect(parse({ subtitleColor: '#ffff' }).success).toBe(false)
  })

  it('知らない配置・書体・背景は落とす', () => {
    expect(parse({ layout: 'right' }).success).toBe(false)
    expect(parse({ layout: 'middle' }).success).toBe(false)
    expect(parse({ font: 'comic' }).success).toBe(false)
    expect(parse({ background: { kind: 'video', mediaAssetId: assetId } }).success).toBe(false)
    expect(parse({ background: { kind: 'timeline_frame', atSec: -1 } }).success).toBe(false)
  })
})

describe('Thumbnail（書き出しの記録）', () => {
  const base = {
    id: ThumbnailId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
    projectId: ProjectId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAX'),
    spec: ThumbnailSpec.parse({ background: frame, title: '新曲' }),
    status: 'queued',
    outputAssetId: null,
    fileName: 'a サムネ 2026-10-17 10.00.00.jpg',
    error: null,
    createdAt: new Date(),
    finishedAt: null,
  } as const

  it('待っている行を読める', () => {
    expect(Thumbnail.parse(base).status).toBe('queued')
  })

  it('状態と中身が食い違わない', () => {
    expect(thumbnailViolation(base)).toBeNull()
    expect(thumbnailViolation({ ...base, status: 'done', outputAssetId: assetId })).toBeNull()
    expect(thumbnailViolation({ ...base, status: 'failed', error: '描けませんでした' })).toBeNull()
  })

  it('終わったのに JPEG が無い・失敗なのに理由が無い・途中なのに JPEG がある、は破れ', () => {
    expect(thumbnailViolation({ ...base, status: 'done' })).toMatch(/JPEG/)
    expect(thumbnailViolation({ ...base, status: 'failed' })).toMatch(/理由/)
    expect(thumbnailViolation({ ...base, status: 'rendering', outputAssetId: assetId })).toMatch(/JPEG/)
    expect(thumbnailViolation({ ...base, error: '描けませんでした' })).toMatch(/理由/)
  })

  it('知らない状態は落とす', () => {
    expect(Thumbnail.safeParse({ ...base, status: 'succeeded' }).success).toBe(false)
  })

  it('ジョブの中身は画像の背景なら文書を持たない', () => {
    expect(ThumbnailJobData.parse({ thumbnailId: base.id, timeline: null })).toEqual({ thumbnailId: base.id, timeline: null })
    expect(ThumbnailJobData.safeParse({ thumbnailId: base.id }).success).toBe(false)
  })

  it('できた JPEG の出どころはサムネイル', () => {
    expect(MediaOrigin.parse({ type: 'thumbnail', thumbnailId: base.id })).toEqual({ type: 'thumbnail', thumbnailId: base.id })
  })
})

describe('thumbnailExportFileName', () => {
  const at = new Date('2026-10-02T13:52:31.400Z')

  it('作品名・サムネ・日時（その地域の時刻）・ID の終わりの .jpg', () => {
    expect(
      thumbnailExportFileName({
        projectName: 'ぼくははると',
        createdAt: at,
        timeZone: 'Asia/Tokyo',
        thumbnailId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      }),
    ).toBe('ぼくははると サムネ 2026-10-02 22.52.31 9g5fav.jpg')
  })

  it('同じ秒に頼んだ 2 枚は別の名前になる（フォルダで 2 枚目が飛ばされない）', () => {
    const name = (thumbnailId: string) =>
      thumbnailExportFileName({ projectName: 'a', createdAt: at, timeZone: 'UTC', thumbnailId })
    expect(name('01ARZ3NDEKTSV4RRFFQ69G5FAV')).not.toBe(name('01ARZ3NDEKTSV4RRFFQ69G5FAW'))
  })

  it('フォルダの外を指せない名前にする（動画と同じ門を通す）', () => {
    const name = thumbnailExportFileName({
      projectName: '../a/b',
      createdAt: new Date(0),
      timeZone: 'UTC',
      thumbnailId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    })
    expect(name).not.toContain('/')
  })
})
