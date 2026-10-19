import { ProjectEvent } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  CONSOLE_LIMIT,
  appendConsoleEntry,
  createConsoleLog,
  formatConsoleClock,
  jobEventEntry,
  type ConsoleEntry,
} from '@/lib/console-log'
import { SHOT_ID } from './fixtures'

/**
 * コンソール（下の区画のタブ）の記録。画面を開いてから起きた出来事を新しい順に持つ。
 * ブラウザのメモリだけに置くので、上限を超えたら古いものから捨てる。
 */

const entry = (id: number, text = `出来事 ${String(id)}`): ConsoleEntry => ({
  id,
  at: 0,
  level: 'info',
  text,
})

describe('appendConsoleEntry', () => {
  it('新しいものを先頭に足す。元の配列は変えない', () => {
    const before = [entry(1)]
    const after = appendConsoleEntry(before, entry(2))
    expect(after.map((each) => each.id)).toEqual([2, 1])
    expect(before.map((each) => each.id)).toEqual([1])
  })

  it(`上限（${String(CONSOLE_LIMIT)} 件）を超えたら古いものを捨てる`, () => {
    expect(CONSOLE_LIMIT).toBe(200)
    const full = Array.from({ length: CONSOLE_LIMIT }, (_, index) => entry(CONSOLE_LIMIT - index))
    const after = appendConsoleEntry(full, entry(CONSOLE_LIMIT + 1))
    expect(after).toHaveLength(CONSOLE_LIMIT)
    expect(after[0]?.id).toBe(CONSOLE_LIMIT + 1)
    // いちばん古い 1 件（id 1）が落ちる。
    expect(after.some((each) => each.id === 1)).toBe(false)
  })

  it('上限は差し替えられる', () => {
    const after = appendConsoleEntry([entry(2), entry(1)], entry(3), 2)
    expect(after.map((each) => each.id)).toEqual([3, 2])
  })
})

describe('createConsoleLog', () => {
  it('足すと知らせ、新しい順に読める。空文字は記録しない', () => {
    const log = createConsoleLog()
    let calls = 0
    const unsubscribe = log.subscribe(() => {
      calls += 1
    })
    log.push('info', '一つ目', 1000)
    log.push('error', '二つ目', 2000)
    log.push('warn', '   ', 3000)
    expect(log.getSnapshot().map((each) => [each.level, each.text, each.at])).toEqual([
      ['error', '二つ目', 2000],
      ['info', '一つ目', 1000],
    ])
    expect(calls).toBe(2)
    unsubscribe()
    log.push('info', '三つ目', 4000)
    expect(calls).toBe(2)
  })

  it('同じ文が続いても別の行として残す（id は毎回違う）', () => {
    const log = createConsoleLog()
    log.push('info', '同じ', 1)
    log.push('info', '同じ', 2)
    const ids = log.getSnapshot().map((each) => each.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('消去すると空になる。何も無いときに消去しても知らせない', () => {
    const log = createConsoleLog()
    let calls = 0
    log.subscribe(() => {
      calls += 1
    })
    log.clear()
    expect(calls).toBe(0)
    log.push('info', 'あ', 1)
    log.clear()
    expect(log.getSnapshot()).toEqual([])
    expect(calls).toBe(2)
  })

  it('読むたびに同じ配列を返す（変わるまでは）', () => {
    const log = createConsoleLog()
    log.push('info', 'あ', 1)
    expect(log.getSnapshot()).toBe(log.getSnapshot())
  })
})

describe('formatConsoleClock', () => {
  it('その日の時刻を 時:分:秒 で出す', () => {
    const at = new Date(2026, 9, 19, 9, 5, 7).getTime()
    expect(formatConsoleClock(at)).toBe('09:05:07')
  })
})

const event = (value: unknown): ProjectEvent => ProjectEvent.parse(value)
const base = { projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAW', at: '2026-10-19T00:00:00.000Z' }

describe('jobEventEntry', () => {
  const shotLabel = (id: string): string | null => (id === SHOT_ID ? 'S01' : null)

  it('動画の生成の完了と失敗を Shot の名前付きで記録する', () => {
    const done = event({
      ...base,
      type: 'generation_job.status',
      shotId: SHOT_ID,
      jobId: '01ARZ3NDEKTSV4RRFFQ69G5FC0',
      status: 'succeeded',
      takeId: '01ARZ3NDEKTSV4RRFFQ69G5FC1',
      error: null,
    })
    expect(jobEventEntry(done, shotLabel)).toEqual({ level: 'info', text: 'S01 の Take ができました' })

    const failed = event({
      ...base,
      type: 'generation_job.status',
      shotId: SHOT_ID,
      jobId: '01ARZ3NDEKTSV4RRFFQ69G5FC0',
      status: 'failed',
      takeId: null,
      error: '時間切れ',
    })
    expect(jobEventEntry(failed, shotLabel)).toEqual({ level: 'error', text: 'S01 の生成に失敗しました: 時間切れ' })
  })

  it('走っている途中・待ちは記録しない', () => {
    const running = event({
      ...base,
      type: 'sfx_job.status',
      jobId: '01ARZ3NDEKTSV4RRFFQ69G5FC0',
      status: 'running',
      error: null,
    })
    expect(jobEventEntry(running, shotLabel)).toBeNull()
  })

  it('Shot の状態の変化は記録しない（ジョブではない）', () => {
    const status = event({ ...base, type: 'shot.status', shotId: SHOT_ID, status: 'draft' })
    expect(jobEventEntry(status, shotLabel)).toBeNull()
  })

  it('効果音の失敗は理由ごと、止めたものは警告で記録する', () => {
    const failed = event({
      ...base,
      type: 'sfx_job.status',
      jobId: '01ARZ3NDEKTSV4RRFFQ69G5FC0',
      status: 'failed',
      error: null,
    })
    expect(jobEventEntry(failed, shotLabel)).toEqual({
      level: 'error',
      text: '効果音を作れませんでした: 理由が届きませんでした。',
    })
    const cancelled = event({
      ...base,
      type: 'sfx_job.status',
      jobId: '01ARZ3NDEKTSV4RRFFQ69G5FC0',
      status: 'cancelled',
      error: null,
    })
    expect(jobEventEntry(cancelled, shotLabel)?.level).toBe('warn')
  })

  it('Shot が見つからなくても落とさない（名前を出さずに記録する）', () => {
    const done = event({
      ...base,
      type: 'generation_job.status',
      shotId: '01ARZ3NDEKTSV4RRFFQ69G5FD9',
      jobId: '01ARZ3NDEKTSV4RRFFQ69G5FC0',
      status: 'succeeded',
      takeId: '01ARZ3NDEKTSV4RRFFQ69G5FC1',
      error: null,
    })
    expect(jobEventEntry(done, shotLabel)).toEqual({ level: 'info', text: 'Shot の Take ができました' })
  })
})
