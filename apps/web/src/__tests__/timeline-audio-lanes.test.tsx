import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TimelineTracks } from '@/components/timeline-tracks'
import { NarrationLane } from '@/components/workbench/narration/narration-lane'

/**
 * タイムラインの音の帯（ADR-0038 / 0039）。ナレーションのレーン（行の投影）と、音のファイルを落として置く効果音の帯。
 * 効果音の帯で受けた音は、画面全体の取り込み（音は楽曲にする）へ流さない。
 */

const tracks = (props: Partial<Parameters<typeof TimelineTracks>[0]>) =>
  render(
    <TimelineTracks
      shots={[]}
      clips={[]}
      transitionPoints={[]}
      renderedShotIds={new Set()}
      durationSec={10}
      pxPerSec={40}
      selectedClipId={null}
      busy={false}
      openTransitionAtSec={null}
      clipPreviews={new Map()}
      onSelectClip={vi.fn()}
      onOpenTransition={vi.fn()}
      onOpenClip={vi.fn()}
      onInsertText={vi.fn()}
      onClipDragBegin={vi.fn()}
      onClipDragMove={vi.fn()}
      onClipDragEnd={vi.fn()}
      {...props}
    />,
  )

const audioDrop = (file: File, clientX: number) => ({
  dataTransfer: { files: [file], items: [{ kind: 'file' }], types: ['Files'] },
  clientX,
})

describe('効果音の帯', () => {
  it('落とす口があれば、空でも帯を出して落とせると言う', () => {
    tracks({ onDropAudio: vi.fn() })
    expect(screen.getByText('効果音のファイルをここへ落とすと置けます')).toBeInTheDocument()
    expect(screen.queryByText(/まだ置けない帯は隠しています: .*SFX/)).not.toBeInTheDocument()
  })

  it('音のファイルを落とすと、落とした秒で渡し、画面全体の取り込みには流さない', () => {
    const onDropAudio = vi.fn()
    const windowDrop = vi.fn()
    window.addEventListener('drop', windowDrop)
    tracks({ onDropAudio })
    const zone = screen.getByText('効果音のファイルをここへ落とすと置けます').parentElement
    if (zone === null) throw new Error('帯がありません')
    const file = new File(['x'], 'whoosh.wav', { type: 'audio/wav' })

    fireEvent.drop(zone, audioDrop(file, 80))

    expect(onDropAudio).toHaveBeenCalledWith(file, expect.any(Number))
    expect(windowDrop).not.toHaveBeenCalled()
    window.removeEventListener('drop', windowDrop)
  })
})

describe('ナレーションのレーン', () => {
  const block = { lineId: 'l1', label: '勝負の時が来た。', startSec: 2, durationSec: 1.5, colorIndex: 0, peaks: [0.5] }

  it('置いた行を出し、矢印で 0.1 秒（Shift で 1 秒）動かす', () => {
    const onMove = vi.fn()
    render(<NarrationLane blocks={[block]} pxPerSec={40} onMove={onMove} />)
    const item = screen.getByRole('button', { name: /ナレーション「勝負の時が来た。」0:02\.00/ })

    fireEvent.keyDown(item, { key: 'ArrowRight' })
    fireEvent.keyDown(item, { key: 'ArrowLeft', shiftKey: true })

    expect(onMove).toHaveBeenNthCalledWith(1, 'l1', 2.1)
    expect(onMove).toHaveBeenNthCalledWith(2, 'l1', 1)
  })

  it('置いた行が無ければ、置き方を言う', () => {
    render(<NarrationLane blocks={[]} pxPerSec={40} onMove={vi.fn()} />)
    expect(screen.getByText(/再生位置から並べる/)).toBeInTheDocument()
  })

  it('タイムラインにはナレーションの行として出る（渡したときだけ）', () => {
    tracks({ narrationLane: (px) => <NarrationLane blocks={[block]} pxPerSec={px} onMove={vi.fn()} /> })
    expect(screen.getByText('ナレーション')).toBeInTheDocument()
  })
})
