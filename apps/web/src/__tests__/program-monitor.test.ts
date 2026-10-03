import type { TimelineDocument } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ASPECT_RATIO,
  describeMonitorState,
  frameToSec,
  monitorAspectRatio,
  monitorDurationInFrames,
  monitorErrorMessage,
  monitorMediaErrorMessage,
  nextSeekCommand,
  secToFrame,
} from '@/lib/program-monitor'

const makeDocument = (patch: Partial<TimelineDocument> = {}): TimelineDocument => ({
  version: 1,
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  durationSec: 4,
  video1: [],
  transitions: [],
  clips: [],
  audio: [],
  ...patch,
})

const shot = (startSec: number, durationSec: number) => ({
  shotId: 'shot_01H0000000000000000000000' as TimelineDocument['video1'][number]['shotId'],
  startSec,
  durationSec,
  mediaUrl: 'https://example.test/a.mp4',
  inSec: 0,
})

describe('秒とフレームの往復', () => {
  it('domain と同じ丸め（round）を使う', () => {
    // 1.017 * 30 = 30.51 → 31。floor だと 30 になり 1 フレームずれる。
    expect(secToFrame(1.017, 30)).toBe(31)
    expect(secToFrame(0.5, 30)).toBe(15)
    expect(frameToSec(30, 30)).toBe(1)
  })

  it('コンポジションの尺はレンダリングと同じ数え方', () => {
    expect(monitorDurationInFrames(makeDocument({ durationSec: 4, fps: 30 }))).toBe(120)
    // 0 フレームのコンポジションは Remotion が拒否するので下限 1。
    expect(monitorDurationInFrames(makeDocument({ durationSec: 0, fps: 30 }))).toBe(1)
  })
})

describe('nextSeekCommand', () => {
  it('最初の指示は serial 1', () => {
    expect(nextSeekCommand(null, 2)).toEqual({ sec: 2, serial: 1 })
  })

  /**
   * 同じ秒を続けて押しても、指示としては別物。
   * 再生中に「さっき押した位置へもう一度」が効かないと、目盛りが壊れて見える。
   */
  it('同じ秒でも指示ごとに serial が進む', () => {
    const first = nextSeekCommand(null, 2)
    const second = nextSeekCommand(first, 2)
    expect(second).toEqual({ sec: 2, serial: 2 })
    expect(second).not.toBe(first)
  })

  it('渡された指示を書き換えない', () => {
    const before = { sec: 1, serial: 5 }
    nextSeekCommand(before, 3)
    expect(before).toEqual({ sec: 1, serial: 5 })
  })
})

describe('monitorAspectRatio', () => {
  it('読めていないときは 16:9', () => {
    expect(monitorAspectRatio(null)).toBe(DEFAULT_ASPECT_RATIO)
  })

  it('縦のプロジェクトは縦の比を返す', () => {
    expect(monitorAspectRatio(makeDocument({ resolution: { width: 1080, height: 1920 } }))).toBe(
      1080 / 1920,
    )
  })
})

describe('describeMonitorState', () => {
  it('読めていない（null）と、Shot が 0 件を別の文にする', () => {
    const loading = describeMonitorState(null, false, null)
    const empty = describeMonitorState(makeDocument({ video1: [] }), false, null)

    expect(loading.status).toBe('loading')
    expect(empty.status).toBe('empty')
    expect(loading.message).not.toBe(empty.message)
    expect(loading.canRender).toBe(false)
    expect(empty.canRender).toBe(false)
  })

  it('Shot があれば絵を出す', () => {
    const state = describeMonitorState(makeDocument({ video1: [shot(0, 2)] }), false, null)
    expect(state.status).toBe('paused')
    expect(state.canRender).toBe(true)
  })

  it('再生中と停止中を書き分ける', () => {
    const doc = makeDocument({ video1: [shot(0, 2)] })
    expect(describeMonitorState(doc, true, null).status).toBe('playing')
    expect(describeMonitorState(doc, false, null).status).toBe('paused')
  })

  it('失敗しているときは絵を出さず理由を出す', () => {
    const state = describeMonitorState(makeDocument({ video1: [shot(0, 2)] }), true, '壊れました')
    expect(state.status).toBe('error')
    expect(state.message).toBe('壊れました')
    expect(state.canRender).toBe(false)
  })
})

describe('monitorErrorMessage', () => {
  it('引き直し方まで書く', () => {
    expect(monitorErrorMessage()).toContain('期限')
    expect(monitorErrorMessage()).toContain('最新の状態')
  })

  /**
   * 署名付き URL を画面にも `onError` の先にも出さない（CLAUDE.md 規約 7 の趣旨）。
   * 元の例外の本文を受け取らない形にしてあることを、引数の数で固定する。
   */
  it('元の例外を受け取らない（URL が漏れる経路を作らない）', () => {
    expect(monitorErrorMessage.length).toBe(0)
  })
})

describe('monitorMediaErrorMessage', () => {
  it('Player 全体の失敗とは別の文にする（1 本欠けただけと区別する）', () => {
    expect(monitorMediaErrorMessage()).not.toBe(monitorErrorMessage())
    expect(monitorMediaErrorMessage()).toContain('この Shot の素材を読めません')
  })

  it('元の URL を受け取らない（署名付き URL が漏れる経路を作らない）', () => {
    expect(monitorMediaErrorMessage.length).toBe(0)
  })
})

/**
 * 絵が無くても、音とテロップは流す（制作者 2026-10-03「テロップがあるだけではプレビューが再生できず、音楽とテロップが
 * あっているかの確認が出来ないのでこの時点でも再生出来るようにしておきたい（黒画面で問題ない）」）。
 * **プレビューだけ**に効かせる（Take の比較などは、絵が無ければ流さない）。
 */
describe('describeMonitorState: 絵が無いとき', () => {
  const song = { mediaUrl: 'https://example.invalid/song.wav', startSec: 0, durationSec: 60, volume: 1 }

  it('音があれば、黒い画面で流す（そう言う）', () => {
    const state = describeMonitorState(makeDocument({ video1: [], audio: [song], durationSec: 60 }), false, null, {
      withoutPictures: true,
    })
    expect(state.canRender).toBe(true)
    expect(state.status).toBe('paused')
    expect(state.message).toMatch(/音とテロップだけ/)
  })

  it('許していなければ、今までどおり流さない', () => {
    const state = describeMonitorState(makeDocument({ video1: [], audio: [song], durationSec: 60 }), false, null)
    expect(state.canRender).toBe(false)
  })

  it('音もテロップも無ければ流さない。文は「Shot が無い」と決めつけない（Shot があっても絵が無いことがある）', () => {
    const state = describeMonitorState(makeDocument({ video1: [] }), false, null, { withoutPictures: true })
    expect(state.canRender).toBe(false)
    expect(state.message).not.toMatch(/Shot がまだ 1 つもありません/)
  })
})
