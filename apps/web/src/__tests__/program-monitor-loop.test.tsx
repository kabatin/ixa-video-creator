import type { TimelineDocument } from '@ixa/domain'
import { act, render } from '@testing-library/react'
import { useState, type Ref } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProgramMonitorPlayer } from '@/components/program-monitor-player'
import { nextSeekCommand, type SeekCommand } from '@/lib/program-monitor'

/**
 * **位置の反射がシークを起こさないことを固定する**（実機で出た不具合の再現）。
 *
 * 症状は 2 段階あった。
 * 1. `Maximum update depth exceeded` と、再生ヘッドがフレーム 6 と 7 を往復し続ける
 * 2. それを「直近の報告を覚える」で抑えた後も、再生中に目盛りを押すと
 *    押した位置と押す前の位置を 300ms ごとに往復し続ける
 *
 * どちらも原因は同じで、**親の `currentSec` を見て Player をシークしていた**こと。
 * 親の `currentSec` は Player が `frameupdate` で返した値の写しでもあるので、
 * 自分の報告と外からの指示を推測で分けねばならず、その推測は Player の遅れた
 * `frameupdate` で破れる。いまは利用者の指示（`SeekCommand`）が来たときだけ飛ぶ。
 *
 * この偽物の Player は本物と同じ順番で `frameupdate` を配る（自分の `useEffect` から）。
 * 順番を真似ない偽物では、旧版の不具合は素通りした。
 */

type Listener = (event: { detail: unknown }) => void

/** 外部の状態を持つ道具の代役なので、ここだけは 1 つの器を書き換えて進める。 */
const harness = vi.hoisted(() => ({
  frame: 0,
  playing: false,
  seekToCalls: [] as number[],
  initialFrame: null as number | null,
  listeners: new Map<string, Set<Listener>>(),
  setFrame: null as ((frame: number) => void) | null,
  emit(name: string, detail: unknown) {
    for (const listener of this.listeners.get(name) ?? []) listener({ detail })
  },
  reset() {
    this.frame = 0
    this.playing = false
    this.seekToCalls = []
    this.initialFrame = null
    this.listeners = new Map()
    this.setFrame = null
  },
}))

vi.mock('@ixa/render/composition', () => ({
  TimelineComposition: () => null,
  totalFrames: (durationSec: number, fps: number) => Math.max(1, Math.round(durationSec * fps)),
}))

vi.mock('@remotion/player', async () => {
  const { useEffect, useImperativeHandle, useRef, useState: useReactState } = await import('react')

  const Player = ({
    ref,
    initialFrame,
  }: {
    readonly ref?: Ref<unknown>
    readonly initialFrame?: number
  }) => {
    const [frame, setFrame] = useReactState(initialFrame ?? 0)
    const containerRef = useRef<HTMLDivElement | null>(null)

    harness.frame = frame
    harness.setFrame = setFrame
    harness.initialFrame = initialFrame ?? null

    useImperativeHandle(
      ref,
      () => ({
        play: () => {
          harness.playing = true
          harness.emit('play', undefined)
        },
        pause: () => {
          if (!harness.playing) return
          harness.playing = false
          harness.emit('pause', undefined)
        },
        isPlaying: () => harness.playing,
        getCurrentFrame: () => harness.frame,
        getContainerNode: () => containerRef.current,
        /**
         * `@remotion/player` と同じ振る舞い。
         * **再生中なら一度 `pause` を配ってから飛び、直後に自分で再開する。**
         * この一瞬の `pause` を親へ渡すと再生が勝手に止まる。
         */
        seekTo: (target: number) => {
          harness.seekToCalls.push(target)
          const resume = harness.playing
          if (resume) {
            harness.playing = false
            harness.emit('pause', undefined)
          }
          harness.setFrame?.(target)
          if (resume) {
            harness.playing = true
            harness.emit('play', undefined)
          }
        },
        addEventListener: (name: string, listener: Listener) => {
          const set = harness.listeners.get(name) ?? new Set<Listener>()
          set.add(listener)
          harness.listeners.set(name, set)
        },
        removeEventListener: (name: string, listener: Listener) => {
          harness.listeners.get(name)?.delete(listener)
        },
      }),
      [],
    )

    // **子の effect から配る。** 本物と同じ順番でないと、旧版の不具合は再現しない。
    useEffect(() => {
      harness.emit('frameupdate', { frame })
    }, [frame])

    return (
      <div ref={containerRef}>
        <video data-testid="media" />
      </div>
    )
  }

  return { Player }
})

const FPS = 30

const makeDocument = (): TimelineDocument => ({
  version: 1,
  fps: FPS,
  resolution: { width: 1920, height: 1080 },
  durationSec: 10,
  video1: [],
  transitions: [],
  clips: [],
  audio: [],
})

/** `timeline-editor.tsx` と同じ配線。位置と再生は親が持ち、部品は報告するだけ。 */
const host = {
  currentSec: 0,
  playing: false,
  setCurrentSec: null as ((sec: number) => void) | null,
  setPlaying: null as ((playing: boolean) => void) | null,
  /** 目盛りを押したのと同じ。位置を更新し、明示的な指示を 1 つ出す。 */
  seekTo: null as ((sec: number) => void) | null,
  mediaErrors: [] as string[],
  fatalErrors: [] as string[],
  /** 親へ届いた再生状態の知らせ。**最終値だけでは足りない**ので並びごと見る。 */
  playingEvents: [] as boolean[],
}

const Host = ({
  document,
  initialSec = 0,
}: {
  readonly document: TimelineDocument
  readonly initialSec?: number
}) => {
  const [currentSec, setCurrentSec] = useState(initialSec)
  const [playing, setPlaying] = useState(false)
  const [seek, setSeek] = useState<SeekCommand | null>(null)

  host.currentSec = currentSec
  host.playing = playing
  host.setCurrentSec = setCurrentSec
  host.setPlaying = setPlaying
  host.seekTo = (sec) => {
    setCurrentSec(sec)
    setSeek((previous) => nextSeekCommand(previous, sec))
  }

  return (
    <ProgramMonitorPlayer
      document={document}
      initialSec={currentSec}
      seek={seek}
      playing={playing}
      onFrame={setCurrentSec}
      onPlayingChange={(next) => {
        host.playingEvents.push(next)
        setPlaying(next)
      }}
      onFatalError={(message) => host.fatalErrors.push(message)}
      onMediaError={(message) => host.mediaErrors.push(message)}
    />
  )
}

/** 再生 1 フレーム分。**親の描画は 1 コミット遅れる**ので、そこで旧版の不具合が出た。 */
const advance = (frame: number) =>
  act(() => {
    harness.setFrame?.(frame)
  })

/** Player が遅れて配った古い位置。実機では seek の直後にこれが届いて往復を起こした。 */
const echoStale = (frame: number) =>
  act(() => {
    harness.emit('frameupdate', { frame })
  })

beforeEach(() => {
  harness.reset()
  host.mediaErrors = []
  host.fatalErrors = []
  host.playingEvents = []
})

describe('再生中に自分をシークし返さない', () => {
  it('10 フレーム進めても seekTo を 1 度も呼ばない', () => {
    render(<Host document={makeDocument()} />)

    act(() => host.setPlaying?.(true))
    for (let frame = 1; frame <= 10; frame += 1) advance(frame)

    expect(harness.seekToCalls).toEqual([])
  })

  it('再生ヘッドが進み、止まらない', () => {
    render(<Host document={makeDocument()} />)

    act(() => host.setPlaying?.(true))
    for (let frame = 1; frame <= 10; frame += 1) advance(frame)

    expect(host.currentSec).toBeCloseTo(10 / FPS, 6)
    expect(host.playing).toBe(true)
  })

  it('もう一度 Space で止まる', () => {
    render(<Host document={makeDocument()} />)

    act(() => host.setPlaying?.(true))
    for (let frame = 1; frame <= 5; frame += 1) advance(frame)
    act(() => host.setPlaying?.(false))

    expect(host.playing).toBe(false)
    expect(harness.playing).toBe(false)
  })

  /** 親の位置を直接書き換えても（指示ではないので）飛ばない。位置の流れは一方通行。 */
  it('親の currentSec だけが変わっても飛ばない', () => {
    render(<Host document={makeDocument()} />)

    act(() => host.setCurrentSec?.(3))

    expect(harness.seekToCalls).toEqual([])
  })
})

describe('Player が遅れて返した古い位置', () => {
  /**
   * **実機で 0:11 と 1:24 を往復し続けた不具合の再現。**
   * 目盛りで 3 秒へ飛んだ直後、Player が飛ぶ前の位置（5 フレーム目）を遅れて配る。
   * その反射を見て 5 へ飛び返すと、今度は 90 の反射で 90 へ……と止まらなくなる。
   */
  it('シーク直後に古い位置が届いても飛び返さない', () => {
    render(<Host document={makeDocument()} />)

    act(() => host.setPlaying?.(true))
    for (let frame = 1; frame <= 5; frame += 1) advance(frame)
    act(() => host.seekTo?.(3))
    echoStale(5)
    echoStale(4)

    expect(harness.seekToCalls).toEqual([90])
  })

  it('古い位置が届いたあとも、次の報告で素直に進む', () => {
    render(<Host document={makeDocument()} />)

    act(() => host.setPlaying?.(true))
    act(() => host.seekTo?.(3))
    echoStale(5)
    advance(91)
    advance(92)

    expect(harness.seekToCalls).toEqual([90])
    expect(host.currentSec).toBeCloseTo(92 / FPS, 6)
    expect(host.playing).toBe(true)
  })
})

describe('利用者が位置を指示したときは飛ぶ', () => {
  it('目盛りを押した位置へシークする', () => {
    render(<Host document={makeDocument()} />)

    act(() => host.seekTo?.(1))

    expect(harness.seekToCalls).toEqual([30])
  })

  it('同じ位置をもう一度押しても飛び直す（指示ごとに serial が進む）', () => {
    render(<Host document={makeDocument()} />)

    act(() => host.seekTo?.(1))
    advance(45)
    act(() => host.seekTo?.(1))

    expect(harness.seekToCalls).toEqual([30, 30])
  })

  /**
   * `@remotion/player` の `seekTo` は、再生中だと内部で一度 `pause` を配ってから飛び、
   * 直後に自分で再開する。この一瞬の `pause` を親へ渡すと、親の `playing` が false になり、
   * こちらの effect が本当に停止させてしまう（実機で「勝手に止まる」と見えた不具合）。
   *
   * **最終値だけを見ても素通りする**ので、親へ届いた知らせの並びを見る。
   */
  it('再生中に飛んでも、シークが起こす一時停止を親へ渡さない', () => {
    render(<Host document={makeDocument()} />)

    act(() => host.setPlaying?.(true))
    for (let frame = 1; frame <= 5; frame += 1) advance(frame)
    host.playingEvents = []
    act(() => host.seekTo?.(3))

    expect(harness.seekToCalls).toEqual([90])
    expect(host.playingEvents).not.toContain(false)
    expect(host.playing).toBe(true)
  })

  it('停止中に飛んでも再生は始まらない', () => {
    render(<Host document={makeDocument()} />)

    act(() => host.seekTo?.(3))

    expect(harness.playing).toBe(false)
    expect(host.playing).toBe(false)
  })

  /** 末尾へ飛ぶと Player は再開せず `ended` を配る。飲み込んだ `pause` の代わりに、これで止まりを伝える。 */
  it('末尾に達したら（ended）親も停止になる', () => {
    render(<Host document={makeDocument()} />)

    act(() => host.setPlaying?.(true))
    act(() => {
      harness.playing = false
      harness.emit('ended', undefined)
    })

    expect(host.playing).toBe(false)
  })

  it('取り付け時の位置から始まる', () => {
    render(<Host document={makeDocument()} initialSec={2} />)

    expect(harness.initialFrame).toBe(60)
    expect(harness.seekToCalls).toEqual([])
  })
})

describe('素材を読めなかったとき', () => {
  it('黙って黒くせず、理由を親へ返す', () => {
    const { getByTestId } = render(<Host document={makeDocument()} />)

    act(() => {
      getByTestId('media').dispatchEvent(new Event('error'))
    })

    expect(host.mediaErrors).toHaveLength(1)
    expect(host.mediaErrors[0]).toContain('この Shot の素材を読めません')
  })

  it('同じ失敗を何度も流さない', () => {
    const { getByTestId } = render(<Host document={makeDocument()} />)

    act(() => {
      getByTestId('media').dispatchEvent(new Event('error'))
      getByTestId('media').dispatchEvent(new Event('error'))
      getByTestId('media').dispatchEvent(new Event('error'))
    })

    expect(host.mediaErrors).toHaveLength(1)
  })

  it('署名付き URL を文に含めない', () => {
    const { getByTestId } = render(<Host document={makeDocument()} />)

    act(() => {
      getByTestId('media').dispatchEvent(new Event('error'))
    })

    expect(host.mediaErrors[0]).not.toContain('http')
  })
})
