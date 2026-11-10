import { describe, expect, it } from 'vitest'
import { ProjectActivity } from '../index.js'

/**
 * 作品一覧の「どこまで進んだか・最後にいつ触ったか」。一覧の行ごとに API が数えて返す。
 * 採用した Shot は生きている Shot の一部なので、Shot の数を超えない。
 */

const base = {
  lastActivityAt: new Date('2026-11-10T05:02:00Z'),
  shotCount: 27,
  adoptedTakeCount: 20,
  hasRender: true,
}

describe('ProjectActivity', () => {
  it('数と日時を読む', () => {
    expect(ProjectActivity.parse(base)).toEqual(base)
  })

  it('Shot が 0 件で何も採用していない作品も読む', () => {
    expect(ProjectActivity.parse({ ...base, shotCount: 0, adoptedTakeCount: 0, hasRender: false }).shotCount).toBe(0)
  })

  it('採用した Shot の数は Shot の数と同じまでなら通す', () => {
    expect(ProjectActivity.safeParse({ ...base, adoptedTakeCount: 27 }).success).toBe(true)
  })

  it('採用した Shot が Shot の数を超えたら断る', () => {
    expect(ProjectActivity.safeParse({ ...base, adoptedTakeCount: 28 }).success).toBe(false)
  })

  it('負の数・小数の数は断る', () => {
    expect(ProjectActivity.safeParse({ ...base, shotCount: -1 }).success).toBe(false)
    expect(ProjectActivity.safeParse({ ...base, adoptedTakeCount: -1 }).success).toBe(false)
    expect(ProjectActivity.safeParse({ ...base, shotCount: 1.5 }).success).toBe(false)
  })

  it('日時でない最終更新は断る', () => {
    expect(ProjectActivity.safeParse({ ...base, lastActivityAt: 'yesterday' }).success).toBe(false)
  })
})
