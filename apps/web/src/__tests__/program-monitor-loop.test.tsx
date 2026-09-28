import type { TimelineDocument } from '@ixa/domain'
import { act, render } from '@testing-library/react'
import { useEffect, useState, type Ref } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProgramMonitorPlayer } from '@/components/program-monitor-player'
import { nextSeekCommand, type SeekCommand } from '@/lib/program-monitor'
import { PreferencesWrapper } from './preferences-wrapper'
import { PREFERENCES_STORAGE_KEY } from '@/lib/preferences'

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
  /** 実物の `PlayerRef` が持つ音量の口。**代役に無いと「鳴らしすぎ」を検査できない。** */
  volume: 1,
  muted: false,
  initialFrame: null as number | null,
  listeners: new Map<string, Set<Listener>>(),
  setFrame: null as ((frame: number) => void) | null,
  /** 再生中の seekTo で止めた。実物は**次の描画のあと**で自分から再開する。 */
  pausedToResume: false,
  rerender: null as (() => void) | null,
  emit(name: string, detail: unknown) {
    for (const listener of this.listeners.get(name) ?? []) listener({ detail })
  },
  reset() {
    this.frame = 0
    this.playing = false
    this.volume = 1
    this.muted = false
    this.seekToCalls = []
    this.initialFrame = null
    this.listeners = new Map()
    this.setFrame = null
    this.pausedToResume = false
    this.rerender = null
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
    const [, setTick] = useReactState(0)
    const containerRef = useRef<HTMLDivElement | null>(null)

    harness.frame = frame
    harness.setFrame = setFrame
    harness.rerender = () => setTick((tick) => tick + 1)
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
        // 実物と同じ名前・同じ効果。ここが抜けていると音量の検査が素通りする。
        setVolume: (value: number) => {
          harness.volume = value
        },
        getVolume: () => harness.volume,
        mute: () => {
          harness.muted = true
        },
        unmute: () => {
          harness.muted = false
        },
        isMuted: () => harness.muted,
        /**
         * `@remotion/player` と同じ振る舞い（`PlayerUI.js` の `seekTo`）。
         * **再生中なら一度 `pause` を配ってから飛び、次の描画のあとの effect で自分から再開する。**
         * この一瞬の `pause` を親へ渡すと再生が勝手に止まる。再開は**その間に止めても**起きる。
         */
        seekTo: (target: number) => {
          harness.seekToCalls.push(target)
          if (harness.playing) {
            harness.pausedToResume = true
            harness.playing = false
            harness.emit('pause', undefined)
            harness.rerender?.()
          }
          harness.setFrame?.(target)
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

    // 実物の「止めて飛んだら再開する」effect（`hasPausedToResume && !playing` で play）。
    useEffect(() => {
      if (!harness.pausedToResume || harness.playing) return
      harness.pausedToResume = false
      harness.playing = true
      harness.emit('play', undefined)
    })

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

/**
 * 再生 1 フレーム分。**親の描画は 1 コミット遅れる**ので、そこで旧版の不具合が出た。
 * 位置の報告はマイクロタスクで届くので、それが流れるまで待つ。
 */
const advance = async (frame: number) =>
  act(async () => {
    harness.setFrame?.(frame)
    await Promise.resolve()
  })

/** Player が遅れて配った古い位置。実機では seek の直後にこれが届いて往復を起こした。 */
const echoStale = async (frame: number) =>
  act(async () => {
    harness.emit('frameupdate', { frame })
    await Promise.resolve()
  })

beforeEach(() => {
  harness.reset()
  host.mediaErrors = []
  host.fatalErrors = []
  host.playingEvents = []
})

/** 音量の持ち主（PreferencesRoot）の中で描く。 */
const renderWithPrefs = (ui: Parameters<typeof render>[0]) =>
  render(ui, { wrapper: PreferencesWrapper })

describe('再生中に自分をシークし返さない', () => {
  it('10 フレーム進めても seekTo を 1 度も呼ばない', async () => {
    renderWithPrefs(<Host document={makeDocument()} />)

    act(() => host.setPlaying?.(true))
    for (let frame = 1; frame <= 10; frame += 1) await advance(frame)

    expect(harness.seekToCalls).toEqual([])
  })

  it('再生ヘッドが進み、止まらない', async () => {
    renderWithPrefs(<Host document={makeDocument()} />)

    act(() => host.setPlaying?.(true))
    for (let frame = 1; frame <= 10; frame += 1) await advance(frame)

    expect(host.currentSec).toBeCloseTo(10 / FPS, 6)
    expect(host.playing).toBe(true)
  })

  it('もう一度 Space で止まる', async () => {
    renderWithPrefs(<Host document={makeDocument()} />)

    act(() => host.setPlaying?.(true))
    for (let frame = 1; frame <= 5; frame += 1) await advance(frame)
    act(() => host.setPlaying?.(false))

    expect(host.playing).toBe(false)
    expect(harness.playing).toBe(false)
  })

  /** 親の位置を直接書き換えても（指示ではないので）飛ばない。位置の流れは一方通行。 */
  it('親の currentSec だけが変わっても飛ばない', () => {
    renderWithPrefs(<Host document={makeDocument()} />)

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
  it('シーク直後に古い位置が届いても飛び返さない', async () => {
    renderWithPrefs(<Host document={makeDocument()} />)

    act(() => host.setPlaying?.(true))
    for (let frame = 1; frame <= 5; frame += 1) await advance(frame)
    act(() => host.seekTo?.(3))
    await echoStale(5)
    await echoStale(4)

    expect(harness.seekToCalls).toEqual([90])
  })

  it('古い位置が届いたあとも、次の報告で素直に進む', async () => {
    renderWithPrefs(<Host document={makeDocument()} />)

    act(() => host.setPlaying?.(true))
    act(() => host.seekTo?.(3))
    await echoStale(5)
    await advance(91)
    await advance(92)

    expect(harness.seekToCalls).toEqual([90])
    expect(host.currentSec).toBeCloseTo(92 / FPS, 6)
    expect(host.playing).toBe(true)
  })
})

describe('利用者が位置を指示したときは飛ぶ', () => {
  it('目盛りを押した位置へシークする', () => {
    renderWithPrefs(<Host document={makeDocument()} />)

    act(() => host.seekTo?.(1))

    expect(harness.seekToCalls).toEqual([30])
  })

  it('同じ位置をもう一度押しても飛び直す（指示ごとに serial が進む）', async () => {
    renderWithPrefs(<Host document={makeDocument()} />)

    act(() => host.seekTo?.(1))
    await advance(45)
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
  it('再生中に飛んでも、シークが起こす一時停止を親へ渡さない', async () => {
    renderWithPrefs(<Host document={makeDocument()} />)

    act(() => host.setPlaying?.(true))
    for (let frame = 1; frame <= 5; frame += 1) await advance(frame)
    host.playingEvents = []
    act(() => host.seekTo?.(3))

    expect(harness.seekToCalls).toEqual([90])
    expect(host.playingEvents).not.toContain(false)
    expect(host.playing).toBe(true)
  })

  /**
   * 再生中のコマ送り（止めて 1 コマ動かす）。一時停止と移動の指示が**同じ描画で**届く。
   * 以前は先に飛んでいたので、Player が「止めて飛んだら再開する」を始め、止める指示は
   * 「もう止まっている」として素通りした。結果、再生が続いて元の位置へ引き戻されたように見えた
   * （2026-09-28、制作者の指摘）。**止めてから飛ぶ。**
   */
  it('再生中に「止めて飛ぶ」を同時に指示すると、止まってその位置に居る', async () => {
    renderWithPrefs(<Host document={makeDocument()} />)

    act(() => host.setPlaying?.(true))
    for (let frame = 1; frame <= 5; frame += 1) await advance(frame)
    await act(async () => {
      host.setPlaying?.(false)
      host.seekTo?.(3)
      await Promise.resolve()
    })

    expect(harness.seekToCalls).toEqual([90])
    expect(harness.playing).toBe(false)
    expect(host.playing).toBe(false)
    expect(harness.frame).toBe(90)
  })

  it('停止中に飛んでも再生は始まらない', () => {
    renderWithPrefs(<Host document={makeDocument()} />)

    act(() => host.seekTo?.(3))

    expect(harness.playing).toBe(false)
    expect(host.playing).toBe(false)
  })

  /** 末尾へ飛ぶと Player は再開せず `ended` を配る。飲み込んだ `pause` の代わりに、これで止まりを伝える。 */
  it('末尾に達したら（ended）親も停止になる', () => {
    renderWithPrefs(<Host document={makeDocument()} />)

    act(() => host.setPlaying?.(true))
    act(() => {
      harness.playing = false
      harness.emit('ended', undefined)
    })

    expect(host.playing).toBe(false)
  })

  it('取り付け時の位置から始まる', () => {
    renderWithPrefs(<Host document={makeDocument()} initialSec={2} />)

    expect(harness.initialFrame).toBe(60)
    expect(harness.seekToCalls).toEqual([])
  })
})

describe('素材を読めなかったとき', () => {
  it('黙って黒くせず、理由を親へ返す', () => {
    const { getByTestId } = renderWithPrefs(<Host document={makeDocument()} />)

    act(() => {
      getByTestId('media').dispatchEvent(new Event('error'))
    })

    expect(host.mediaErrors).toHaveLength(1)
    expect(host.mediaErrors[0]).toContain('この Shot の素材を読めません')
  })

  it('同じ失敗を何度も流さない', () => {
    const { getByTestId } = renderWithPrefs(<Host document={makeDocument()} />)

    act(() => {
      getByTestId('media').dispatchEvent(new Event('error'))
      getByTestId('media').dispatchEvent(new Event('error'))
      getByTestId('media').dispatchEvent(new Event('error'))
    })

    expect(host.mediaErrors).toHaveLength(1)
  })

  it('署名付き URL を文に含めない', () => {
    const { getByTestId } = renderWithPrefs(<Host document={makeDocument()} />)

    act(() => {
      getByTestId('media').dispatchEvent(new Event('error'))
    })

    expect(host.mediaErrors[0]).not.toContain('http')
  })
})

/**
 * 報告された 2 件の作り直し。どちらも**実機で確かめたうえで**ここに固定する。
 *
 * - 音量: 「聴きながら切る」で 15% にしてもプレビューは 100% で鳴っていた
 * - 追従: 別のパネルが鳴らしている間、時計だけ進んで絵は止まっていた
 */
describe('鳴らす側が 2 つあるときの約束', () => {
  it('音量は環境設定のひとつを Player にも当てる', () => {
    window.localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ playback: { volume: 0.15, muted: false } }),
    )
    renderWithPrefs(<Host document={makeDocument()} />)
    expect(harness.volume).toBe(0.15)
    expect(harness.muted).toBe(false)
  })

  it('消音も Player に当たる', () => {
    window.localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ playback: { volume: 0.8, muted: true } }),
    )
    renderWithPrefs(<Host document={makeDocument()} />)
    expect(harness.muted).toBe(true)
  })

  it('自分が鳴らしていない間は、共有の位置へ絵だけ合わせる', () => {
    renderWithPrefs(<Follower document={makeDocument()} followSec={3} />)
    expect(harness.seekToCalls).toEqual([90])
  })

  it('同じコマなら合わせ直さない（毎フレームの seek は重い）', () => {
    const view = renderWithPrefs(<Follower document={makeDocument()} followSec={3} />)
    expect(harness.seekToCalls).toEqual([90])
    // 3.00s と 3.01s は 30fps では同じコマ。合わせ直す必要はない。
    view.rerender(<Follower document={makeDocument()} followSec={3.01} />)
    expect(harness.seekToCalls).toEqual([90])
  })

  it('自分が鳴らしている間は追従しない（位置が往復する）', () => {
    renderWithPrefs(<Follower document={makeDocument()} followSec={3} playing />)
    expect(harness.seekToCalls).toEqual([])
  })
})

/** 鳴らす役を持たないモニター。別のパネルが鳴らしている状況を作る。 */
const Follower = ({
  document,
  followSec,
  playing = false,
}: {
  readonly document: TimelineDocument
  readonly followSec: number
  readonly playing?: boolean
}) => (
  <ProgramMonitorPlayer
    document={document}
    initialSec={0}
    seek={null}
    playing={playing}
    followSec={followSec}
    onFrame={() => undefined}
    onPlayingChange={() => undefined}
    onFatalError={() => undefined}
    onMediaError={() => undefined}
  />
)

/**
 * **再生を続けると開発時に「Maximum update depth exceeded」が積もった不具合**（2026-09-27、モトダチ MV）。
 *
 * `@remotion/player` は `frameupdate` を自分の `useEffect` から配る。そこで親の state を
 * 同期的に更新すると、React は「effect の flush 中に予約された更新」と数える。
 * 画面には位置を見て effect で state を動かす部品（聴きながら切るの追従など）があり、
 * 読み込み待ちで間の空いた flush が無くなると、毎フレームの更新が途切れずに 50 回続いて警告になる。
 * ここでは「位置を受けた effect が次のフレームを進める」形で、途切れない連鎖を作る。
 */
describe('フレームの報告を Player の effect の中で state にしない', () => {
  const Chain = ({ until }: { readonly until: number }) => {
    const [currentSec, setCurrentSec] = useState(0)
    // 位置を見て effect で動く部品の代役。次のフレームを進める（連鎖を途切れさせない）。
    useEffect(() => {
      const frame = Math.round(currentSec * FPS)
      if (frame > 0 && frame < until) harness.setFrame?.(frame + 1)
    }, [currentSec, until])
    return (
      <ProgramMonitorPlayer
        document={makeDocument()}
        initialSec={0}
        seek={null}
        playing
        onFrame={setCurrentSec}
        onPlayingChange={() => undefined}
        onFatalError={() => undefined}
        onMediaError={() => undefined}
      />
    )
  }

  it('80 フレーム続けても update depth の警告を出さない', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderWithPrefs(<Chain until={80} />)

    await act(async () => {
      harness.setFrame?.(1)
      for (let i = 0; i < 200; i += 1) await Promise.resolve()
    })

    const depth = errors.mock.calls.filter((call) => String(call[0]).includes('Maximum update depth'))
    errors.mockRestore()
    expect(harness.frame).toBe(80)
    expect(depth).toEqual([])
  })
})
