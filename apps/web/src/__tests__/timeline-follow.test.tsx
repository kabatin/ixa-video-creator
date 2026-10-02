import { ProjectId } from '@ixa/domain'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimelineEditor } from '@/components/timeline-editor'
import { PlayheadSecContext } from '@/lib/playhead-sec'
import { PROJECT_ID } from './fixtures'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

/**
 * タイムラインも再生位置を追う（制作者 2026-10-02「タイムラインも現在位置に合わせて追従するようにしたい。
 * 他画面に合わせチェックで追従ON/OFF」）。聴きながら切ると同じ「再生位置を追う」。
 * 鳴っている間は再生位置を見えている帯の真ん中に保ち、自分で横に送ったら追うのをやめる。
 */

const document = {
  version: 1 as const,
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  durationSec: 120,
  video1: [],
  transitions: [],
  clips: [],
  audio: [],
}

const editor = (playheadMoving: boolean) => (
  <TimelineEditor
    projectId={ProjectId.parse(PROJECT_ID)}
    shots={[]}
    initialTransitions={[]}
    initialClips={[]}
    renderedShotIds={[]}
    initialIssues={[]}
    documentDurationSec={120}
    initialDocument={document}
    beatSource={{ state: 'no_track' }}
    beatAlignment={null}
    loadErrors={[]}
    showMonitor={false}
    playheadMoving={playheadMoving}
    playback={{
      playing: false,
      seek: null,
      onSeek: () => undefined,
      onFrame: () => undefined,
      onPlayingChange: () => undefined,
    }}
  />
)

const at = (sec: number, playheadMoving = true) => (
  <PlayheadSecContext.Provider value={sec}>{editor(playheadMoving)}</PlayheadSecContext.Provider>
)

const scrollBox = (): HTMLElement => {
  const box = document_.querySelector<HTMLElement>('[data-timeline-scroll]')
  if (box === null) throw new Error('横スクロールの箱がありません')
  return box
}
const document_ = globalThis.document

// jsdom は大きさを測らないので、箱の見えている幅と中身の幅を決めておく（見出し 11rem = 176px）。
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-timeline-scroll') ? 600 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-timeline-scroll') ? 176 + 120 * 40 : 0
  })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('タイムラインの「再生位置を追う」', () => {
  it('既定で入っていて、鳴っている間は再生位置を見えている帯の真ん中に置く', () => {
    render(at(30))

    expect(screen.getByRole('checkbox', { name: '再生位置を追う' })).toBeChecked()
    // 30 秒 × 40px = 1200px。見えている帯は 600 − 176 = 424px、その真ん中へ。
    expect(scrollBox().scrollLeft).toBe(1200 - 212)
  })

  it('切ってあれば動かさない', () => {
    const view = render(at(0))
    fireEvent.click(screen.getByRole('checkbox', { name: '再生位置を追う' }))

    act(() => {
      view.rerender(at(30))
    })

    expect(scrollBox().scrollLeft).toBe(0)
  })

  it('自分で横に送ったら、追うのをやめる（送った先から引き戻さない）', () => {
    render(at(30))

    fireEvent.wheel(scrollBox(), { deltaX: 120, deltaY: 0 })

    expect(screen.getByRole('checkbox', { name: '再生位置を追う' })).not.toBeChecked()
  })

  it('縦に転がしただけでは、追うのをやめない', () => {
    render(at(30))

    fireEvent.wheel(scrollBox(), { deltaX: 0, deltaY: 120 })

    expect(screen.getByRole('checkbox', { name: '再生位置を追う' })).toBeChecked()
  })
})
