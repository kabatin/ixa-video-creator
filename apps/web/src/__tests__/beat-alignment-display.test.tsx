import { Shot, ShotId, type ShotId as ShotIdType } from '@ixa/domain'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StoryboardGrid } from '@/components/workbench/storyboard-grid'
import { TimelineTracks } from '@/components/timeline-tracks'
import { buildShotAlignments } from '@/lib/beat-alignment-view'
import { shotJson } from './fixtures'

/**
 * 拍とのズレが**画面に出ていること**だけを確かめる（P63-1）。
 * 判定は `beat-alignment-view.test.ts` と domain のテストが持つ。ここでは描画だけ。
 *
 * 見たいのは 3 点。
 * 1. 外れている Shot に強い色が付くこと
 * 2. **Take が無い Shot の色を拍の色で上書きしないこと**
 * 3. 色だけで終わらせず、件数の 1 行が必ず出ること
 */

const BEATS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
const DOWNBEATS = [0, 2]

const aShot = (startSec: number, index: number): Shot =>
  Shot.parse({
    ...shotJson,
    id: ShotId.parse(`01ARZ3NDEKTSV4RRFFQ69G5F${String(index).padStart(2, '0')}`),
    code: `S01-${String(index).padStart(3, '0')}`,
    startSec,
    durationSec: 0.5,
    createdAt: new Date(shotJson.createdAt),
    updatedAt: new Date(shotJson.updatedAt),
  })

// 0 は小節頭、1.4 は拍から 0.1s 外れている。
const onDownbeatShot = aShot(0, 1)
const offBeatShot = aShot(1.4, 2)
const shots = [onDownbeatShot, offBeatShot]

const beatAlignment = {
  source: 'available' as const,
  trackTitle: 'iXA CUP',
  views: buildShotAlignments(shots, BEATS, DOWNBEATS),
}

const chipFor = (code: string): HTMLElement => screen.getByTitle(new RegExp(`^${code} `))

const renderTracks = (renderedShotIds: readonly ShotIdType[], withAlignment: boolean) =>
  render(
    <TimelineTracks
      shots={shots}
      clips={[]}
      transitionPoints={[]}
      renderedShotIds={new Set(renderedShotIds)}
      durationSec={4}
      pxPerSec={40}
      selectedClipId={null}
      busy={false}
      openTransitionAtSec={null}
      previewClipId={null}
      previewSpan={null}
      onSelectClip={vi.fn()}
      onOpenTransition={vi.fn()}
      onOpenClip={vi.fn()}
      onInsertText={vi.fn()}
      onClipDragBegin={vi.fn()}
      onClipDragMove={vi.fn()}
      onClipDragEnd={vi.fn()}
      {...(withAlignment ? { beatAlignment } : {})}
    />,
  )

describe('TimelineTracks の拍の色', () => {
  it('拍に乗っている Shot だけ色を付け、拍以外を警告色にしない', () => {
    renderTracks([onDownbeatShot.id, offBeatShot.id], true)
    expect(chipFor('S01-002').className).not.toContain('ring-danger')
    expect(chipFor('S01-001').className).toContain('ring-ok')
  })

  it('Take が無い Shot の縁は拍の色で上書きしない', () => {
    // 映像に出ない Shot は、拍に乗っているかより先に「載っていない」を見せる。
    renderTracks([onDownbeatShot.id], true)
    expect(chipFor('S01-002').className).toContain('ring-warn/40')
    expect(chipFor('S01-002').className).not.toContain('ring-danger')
  })

  it('乗っている数と拍以外の数を文でも出す', () => {
    renderTracks([onDownbeatShot.id, offBeatShot.id], true)
    expect(screen.getByText(/拍以外に合わせている 1 件/)).toBeTruthy()
  })

  it('要約は横に流しても見えたままにする', () => {
    // 帯は横スクロールする。流して消えると、長い曲ほど全体像が見えなくなる。
    renderTracks([onDownbeatShot.id, offBeatShot.id], true)
    expect(screen.getByText(/拍以外に合わせている/).className).toContain('sticky')
  })

  it('ズレを渡さなければ従来どおり（色も 1 行も出ない）', () => {
    renderTracks([onDownbeatShot.id, offBeatShot.id], false)
    expect(chipFor('S01-002').className).not.toContain('ring-danger')
    expect(screen.queryByText(/拍から外れています/)).toBeNull()
  })

  it('解析が無いときに「0 件が外れています」と出さない', () => {
    render(
      <TimelineTracks
        shots={shots}
        clips={[]}
        transitionPoints={[]}
        renderedShotIds={new Set(shots.map((shot) => shot.id))}
        durationSec={4}
        pxPerSec={40}
        selectedClipId={null}
        busy={false}
        openTransitionAtSec={null}
        previewClipId={null}
        previewSpan={null}
        onSelectClip={vi.fn()}
        onOpenTransition={vi.fn()}
        onOpenClip={vi.fn()}
        onInsertText={vi.fn()}
        onClipDragBegin={vi.fn()}
        onClipDragMove={vi.fn()}
        onClipDragEnd={vi.fn()}
        beatAlignment={{
          source: 'no_analysis',
          trackTitle: 'iXA CUP',
          views: buildShotAlignments(shots, [], []),
        }}
      />,
    )
    expect(screen.queryByText(/外れています/)).toBeNull()
    expect(screen.getByText(/まだ解析されていない/)).toBeTruthy()
    // 拍が分からないだけなので、ズレの色は出さない。
    expect(chipFor('S01-002').className).not.toContain('ring-danger')
    expect(chipFor('S01-002').className).not.toContain('ring-warn')
  })
})

describe('StoryboardGrid の拍の色（PHASE 7.1）', () => {
  const renderGrid = (withAlignment: boolean) =>
    render(
      <StoryboardGrid
        shots={shots}
        posters={new Map()}
        selectedShotId={null}
        onSelect={vi.fn()}
        {...(withAlignment ? { alignments: beatAlignment.views } : {})}
      />,
    )

  it('拍に乗っている Shot だけ左の辺を塗る', () => {
    renderGrid(true)
    const buttons = screen.getAllByRole('button')
    expect(buttons[1]?.className).not.toContain('border-l-danger')
    expect(buttons[0]?.className).toContain('border-l-ok')
  })

  it('ズレを渡さなければ色を付けない', () => {
    renderGrid(false)
    const buttons = screen.getAllByRole('button')
    expect(buttons[1]?.className).not.toContain('border-l-danger')
    expect(buttons[1]?.className).toContain('hover:border-line-strong')
  })

  it('拍の色が付いたカードは、ホバーで縁を塗り替えない', () => {
    // `hover:border-line-strong` は 4 辺をまとめて塗るので、
    // 指を乗せた瞬間だけ左の辺の色が消える。色が付く側ではホバーを縁に掛けない。
    // **色が付くのは拍に乗っている側**になったので、例も 0 番（on_downbeat）で見る。
    renderGrid(true)
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]?.className).toContain('border-l-ok')
    expect(buttons[0]?.className).not.toContain('hover:border-line-strong')
  })
})

describe('TimelineTracks の Shot の選択（PHASE 7.2）', () => {
  const renderSelectable = (onSelectShot?: (id: ShotIdType) => void) =>
    render(
      <TimelineTracks
        shots={shots}
        clips={[]}
        transitionPoints={[]}
        renderedShotIds={new Set(shots.map((shot) => shot.id))}
        durationSec={4}
        pxPerSec={40}
        selectedClipId={null}
        busy={false}
        openTransitionAtSec={null}
        previewClipId={null}
        previewSpan={null}
        onSelectClip={vi.fn()}
        onOpenTransition={vi.fn()}
        onOpenClip={vi.fn()}
        onInsertText={vi.fn()}
        onClipDragBegin={vi.fn()}
        onClipDragMove={vi.fn()}
        onClipDragEnd={vi.fn()}
        selectedShotId={offBeatShot.id}
        {...(onSelectShot === undefined ? {} : { onSelectShot })}
      />,
    )

  it('押すとその Shot を選び、選択中は強調する', () => {
    const onSelectShot = vi.fn()
    renderSelectable(onSelectShot)
    const chip = chipFor('S01-001')
    chip.click()
    expect(onSelectShot).toHaveBeenCalledWith(onDownbeatShot.id)
    expect(chipFor('S01-002')).toHaveAttribute('aria-pressed', 'true')
    expect(chipFor('S01-002').className).toContain('outline-accent')
  })

  it('キーボード（Space）でも選べる', () => {
    const onSelectShot = vi.fn()
    renderSelectable(onSelectShot)
    fireEvent.keyDown(chipFor('S01-001'), { key: ' ' })
    expect(onSelectShot).toHaveBeenCalledWith(onDownbeatShot.id)
  })

  it('選ぶ口を渡さなければ押せない（従来どおり）', () => {
    renderSelectable()
    expect(chipFor('S01-001')).not.toHaveAttribute('role', 'button')
  })
})
