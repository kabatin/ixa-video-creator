import { ShotId, TakeId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { SHOT_ID, TAKE_ID } from '@/__tests__/fixtures'
import {
  NOT_FETCHED_REASON,
  NO_SHOTS_REASON,
  describeMissingPoster,
  pickProjectCover,
  posterByShotId,
  startFrameKnownFor,
  posterRetryDelayMs,
  posterViewFor,
  MAX_POSTER_RETRIES,
  POSTER_RETRY_MS,
  POSTER_RENEW_AFTER_MS,
  postersStale,
} from '@/lib/shot-posters'
import type { WireShotPoster } from '@/lib/shot-posters-api'

const OTHER_SHOT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FC0'
const THIRD_SHOT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FC1'

const shotId = ShotId.parse(SHOT_ID)
const otherShotId = ShotId.parse(OTHER_SHOT_ID)

const withPoster = (id: string, url: string): WireShotPoster => ({
  shotId: ShotId.parse(id),
  takeId: TakeId.parse(TAKE_ID),
  thumbnailUrl: url,
  reason: null,
  pending: false,
  hasStartFrame: false,
})

const withoutPoster = (id: string, reason: string): WireShotPoster => ({
  shotId: ShotId.parse(id),
  takeId: null,
  thumbnailUrl: null,
  reason,
  pending: false,
  hasStartFrame: false,
})

describe('posterByShotId', () => {
  it('Shot ごとに引ける形へ直す', () => {
    const map = posterByShotId([
      withPoster(SHOT_ID, 'https://example.invalid/a.jpg'),
      withoutPoster(OTHER_SHOT_ID, 'no_take'),
    ])

    expect(map.get(shotId)).toEqual({
      url: 'https://example.invalid/a.jpg',
      reason: null,
      hasStartFrame: false,
      pending: false,
    })
    expect(map.get(otherShotId)).toEqual({ url: null, reason: 'no_take', hasStartFrame: false, pending: false })
  })

  it('作っている最中か（待てば出るか）を運ぶ。サムネに回る印を出すのに使う', () => {
    const map = posterByShotId([{ ...withoutPoster(SHOT_ID, '絵コンテの画像を作っています'), pending: true }])

    expect(map.get(shotId)?.pending).toBe(true)
  })
})

describe('startFrameKnownFor', () => {
  it('最初のフレームがあるかを返し、まだ引いていない Shot は「無い」ではなく null', () => {
    const map = posterByShotId([{ ...withPoster(SHOT_ID, 'https://example.invalid/a.jpg'), hasStartFrame: true }])

    expect(startFrameKnownFor(map, shotId)).toBe(true)
    expect(startFrameKnownFor(map, otherShotId)).toBeNull()
  })
})

describe('posterViewFor', () => {
  it('Map に無い Shot は「無い」ではなく「まだ引いていない」にする', () => {
    const map = posterByShotId([withPoster(SHOT_ID, 'https://example.invalid/a.jpg')])

    // 取得前の行に「Take がありません」と出すと、生成をやり直させてしまう（L-021）。
    expect(posterViewFor(map, otherShotId)).toEqual({ url: null, reason: NOT_FETCHED_REASON, pending: false })
  })
})

describe('describeMissingPoster', () => {
  it('画面が自分で作った理由だけを言い換える', () => {
    expect(describeMissingPoster(NOT_FETCHED_REASON)).toBe('サムネイルを読み込み中')
    expect(describeMissingPoster(NO_SHOTS_REASON)).toBe('Shot がありません')
  })

  it('API が返す文はそのまま出す（言い換えを二重に持たない）', () => {
    // 同じ文を web 側にも書き写すと、API が直しても画面だけ古い文を出し続ける。
    expect(describeMissingPoster('Take が選ばれていません')).toBe('Take が選ばれていません')
    expect(describeMissingPoster('メディアが見つかりません')).toBe('メディアが見つかりません')
  })

  it('理由が無いときは「分からない」と言う（空欄で隠さない）', () => {
    expect(describeMissingPoster(null)).toBe('理由が分かりません')
    expect(describeMissingPoster('  ')).toBe('理由が分かりません')
  })
})

describe('pickProjectCover', () => {
  it('サムネイルがある先頭の Shot を選ぶ', () => {
    const cover = pickProjectCover([
      withoutPoster(SHOT_ID, 'no_take'),
      withPoster(OTHER_SHOT_ID, 'https://example.invalid/b.jpg'),
      withPoster(THIRD_SHOT_ID, 'https://example.invalid/c.jpg'),
    ])

    expect(cover).toEqual({ url: 'https://example.invalid/b.jpg', reason: null })
  })

  it('1 枚も無いときは先頭の理由を返す', () => {
    const cover = pickProjectCover([
      withoutPoster(SHOT_ID, 'no_thumbnail'),
      withoutPoster(OTHER_SHOT_ID, 'no_take'),
    ])

    expect(cover).toEqual({ url: null, reason: 'no_thumbnail' })
  })

  it('Shot が 1 件も無いときは Shot が無いことを理由にする', () => {
    expect(pickProjectCover([])).toEqual({ url: null, reason: NO_SHOTS_REASON })
  })

  it('選んだ表紙は必ず理由が null（絵と理由を同時に持たない）', () => {
    const cover = pickProjectCover([withPoster(SHOT_ID, 'https://example.invalid/a.jpg')])

    expect(cover.url).not.toBeNull()
    expect(cover.reason).toBeNull()
  })

  it('選べなかった表紙は必ず理由を持つ', () => {
    const cover = pickProjectCover([withoutPoster(SHOT_ID, 'no_take')])

    expect(cover.url).toBeNull()
    expect(cover.reason).not.toBeNull()
  })
})

/**
 * サムネイルを作っている間だけ取り直す（2026-09-27）。以前は生成が終わった瞬間に 1 回取るだけで、
 * サムネイルがその後にできても出ず、読み直すまで「作られていません」のままだった。
 */
describe('posterRetryDelayMs', () => {
  const making = (id: string): WireShotPoster => ({ ...withoutPoster(id, 'サムネイルを作っています'), pending: true })

  it('作っている行があれば、少し待って取り直す', () => {
    expect(posterRetryDelayMs([withPoster(SHOT_ID, 'https://example.invalid/a.jpg'), making(OTHER_SHOT_ID)], 0)).toBe(POSTER_RETRY_MS)
  })

  it('待っても出ない行（Take が無いなど）だけなら取り直さない', () => {
    expect(posterRetryDelayMs([withoutPoster(SHOT_ID, 'まだ Take がありません')], 0)).toBeNull()
  })

  it('上限まで取り直したら止める（出ないまま回り続けない）', () => {
    expect(posterRetryDelayMs([making(SHOT_ID)], MAX_POSTER_RETRIES)).toBeNull()
  })
})

/**
 * 読めなかった絵の引き直し（制作者 2026-10-02「サムネが表示されなくなった」）。
 * 取ったばかりの一覧で読めないなら、URL の期限ではなく絵そのものが無い。引き直しても直らないので頼まない（回り続けない）。
 */
describe('postersStale', () => {
  it('取ってから一定の時間が経った一覧だけを引き直す', () => {
    expect(postersStale(1_000, 1_000 + POSTER_RENEW_AFTER_MS + 1)).toBe(true)
    expect(postersStale(1_000, 1_000 + POSTER_RENEW_AFTER_MS - 1)).toBe(false)
  })

  it('まだ一度も取れていなければ頼まない（取りにいっている最中）', () => {
    expect(postersStale(null, 10 * POSTER_RENEW_AFTER_MS)).toBe(false)
  })
})
