import { ProjectId } from '@ixa/domain'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TimelineEditor } from '@/components/timeline-editor'
import {
  useTransport,
  useTransportState,
  type WorkbenchTransport,
} from '@/components/workbench/workbench-context'
import { WorkbenchTransportProvider } from '@/components/workbench/workbench-transport-provider'
import { PlayheadSecContext } from '@/lib/playhead-sec'
import { PROJECT_ID } from './fixtures'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

/**
 * **再生位置は毎コマ変わる。読むのは位置を描く末端だけにする。**
 *
 * 以前は位置と再生状態が 1 つの値で、タイムライン・比較・カッターのパネルが毎コマ丸ごと描き直した。
 * 開発中の画面では主スレッドが詰まり、プレビューの音が 0.7〜0.9 秒巻き戻って鳴り直した
 * （2026-09-28、モトダチ MV の通し再生で実測）。
 */

const at = (currentSec: number, playing = true): WorkbenchTransport => ({
  currentSec,
  playing,
  seek: null,
  owner: 'monitor',
})

describe('WorkbenchTransportProvider', () => {
  it('位置だけが変わっても、再生状態しか読まない部品は描き直さない', () => {
    let renders = 0
    const StateOnly = () => {
      renders += 1
      return <span>{useTransportState().playing ? '再生中' : '停止中'}</span>
    }
    // 実物と同じく、子は上から渡された同じ要素（持ち主が描き直しても子の props は変わらない）。
    const child = <StateOnly />
    const view = render(<WorkbenchTransportProvider transport={at(1)}>{child}</WorkbenchTransportProvider>)
    const before = renders
    view.rerender(<WorkbenchTransportProvider transport={at(2)}>{child}</WorkbenchTransportProvider>)
    expect(renders).toBe(before)
  })

  it('再生状態が変われば描き直す', () => {
    const StateOnly = () => <span>{useTransportState().playing ? '再生中' : '停止中'}</span>
    const view = render(
      <WorkbenchTransportProvider transport={at(1)}>
        <StateOnly />
      </WorkbenchTransportProvider>,
    )
    view.rerender(
      <WorkbenchTransportProvider transport={at(1, false)}>
        <StateOnly />
      </WorkbenchTransportProvider>,
    )
    expect(screen.getByText('停止中')).toBeTruthy()
  })

  it('位置を読む部品は新しい位置を描く', () => {
    const Clock = () => <span>{String(useTransport().currentSec)}</span>
    const view = render(
      <WorkbenchTransportProvider transport={at(1)}>
        <Clock />
      </WorkbenchTransportProvider>,
    )
    view.rerender(
      <WorkbenchTransportProvider transport={at(2.5)}>
        <Clock />
      </WorkbenchTransportProvider>,
    )
    expect(screen.getByText('2.5')).toBeTruthy()
  })
})

/**
 * タイムラインは外から位置を受けるとき、位置を props で受けない（受けると毎コマ全体が描き直る）。
 * 再生ヘッドと時刻の表示だけが `PlayheadSecContext` を読む。
 */
describe('TimelineEditor の再生位置', () => {
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
  const editor = (
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
      playback={{
        playing: false,
        seek: null,
        onSeek: () => undefined,
        onFrame: () => undefined,
        onPlayingChange: () => undefined,
      }}
    />
  )

  it('時刻の表示は文脈の位置を出す', () => {
    const view = render(<PlayheadSecContext.Provider value={3}>{editor}</PlayheadSecContext.Provider>)
    expect(screen.getByText('停止中 0:03.00')).toBeTruthy()
    act(() => {
      view.rerender(<PlayheadSecContext.Provider value={65.5}>{editor}</PlayheadSecContext.Provider>)
    })
    expect(screen.getByText('停止中 1:05.50')).toBeTruthy()
  })

  it('外から位置を受けない（自前で持つ）ときは 0 から', () => {
    render(
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
      />,
    )
    expect(screen.getByText('停止中 0:00.00')).toBeTruthy()
  })
})
