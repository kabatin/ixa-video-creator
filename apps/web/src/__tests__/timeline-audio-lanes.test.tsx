import { MediaAssetId, ProjectId, TimelineClipId, newId, type TimelineClip } from '@ixa/domain'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TimelineTracks } from '@/components/timeline-tracks'
import { NarrationLane } from '@/components/workbench/narration/narration-lane'
import { SfxAssetsProvider } from '@/components/workbench/sfx-assets'
import { WireUploadedSfx } from '@/lib/uploaded-sfx-api'
import { renderInWorkbench } from './workbench-fixture'

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

  it('素材ツリーの効果音を落とすと、その素材と落とした秒で渡す（取り込んだ・作った音を置く）', () => {
    const onDropAudio = vi.fn()
    const onDropSfxAsset = vi.fn()
    tracks({ onDropAudio, onDropSfxAsset })
    const zone = screen.getByText('効果音のファイルをここへ落とすと置けます').parentElement
    if (zone === null) throw new Error('帯がありません')
    const payload = JSON.stringify({ kind: 'sfx', id: 'asset-1' })
    const dataTransfer = {
      files: [],
      items: [{ kind: 'string' }],
      types: ['application/x-ixa-asset'],
      getData: (type: string) => (type === 'application/x-ixa-asset' ? payload : ''),
    }

    fireEvent.dragOver(zone, { dataTransfer })
    fireEvent.drop(zone, { dataTransfer, clientX: 80 })

    expect(onDropSfxAsset).toHaveBeenCalledWith('asset-1', expect.any(Number))
    expect(onDropAudio).not.toHaveBeenCalled()
  })

  it('キャラクターのような効果音でない素材は受けない', () => {
    const onDropSfxAsset = vi.fn()
    tracks({ onDropAudio: vi.fn(), onDropSfxAsset })
    const zone = screen.getByText('効果音のファイルをここへ落とすと置けます').parentElement
    if (zone === null) throw new Error('帯がありません')
    const payload = JSON.stringify({ kind: 'character', id: 'c1' })
    const dataTransfer = { files: [], items: [{ kind: 'string' }], types: ['application/x-ixa-asset'], getData: () => payload }

    fireEvent.drop(zone, { dataTransfer, clientX: 80 })

    expect(onDropSfxAsset).not.toHaveBeenCalled()
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

/** 帯の並び（制作者 2026-10-19）: VIDEO・Transition・ナレーション・テロップ・VFX・SFX。楽曲の波形は一番上のまま。 */
describe('帯の並び', () => {
  it('VIDEO2 は VIDEO1 の下、テロップは VFX の上、効果音は一番下', () => {
    const video2: TimelineClip = {
      id: newId(TimelineClipId),
      projectId: newId(ProjectId),
      track: 'VIDEO2',
      startSec: 0,
      durationSec: 1,
      layer: 0,
      content: { type: 'text', templateKey: 'plain', params: { text: 'a' } },
      opacity: 1,
      createdAt: new Date(),
    }
    tracks({
      clips: [video2],
      onDropAudio: vi.fn(),
      narrationLane: () => null,
      audioLane: { durationSec: 10, node: null },
    })
    const labels = ['MUSIC（波形）', 'VIDEO1（Shot）', 'VIDEO2（重ね素材）', 'Transition', 'ナレーション', 'TEXT（テロップ）', 'VFX（エフェクト）', 'SFX（効果音）']
    const nodes = labels.map((label) => screen.getByText(label))
    const ordered = nodes.every(
      (node, index) => index === 0 || (nodes[index - 1]?.compareDocumentPosition(node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(ordered).toBe(true)
  })
})

/** 効果音のクリップの札・読み上げに素材の内部 ID を出さず、素材ツリーと同じ名前を出す（CLAUDE.md の画面の言葉）。 */
describe('効果音のクリップの名前', () => {
  const SOUND = '01ARZ3NDEKTSV4RRFFQ69G5FA1'
  const placed: TimelineClip = {
    id: newId(TimelineClipId),
    projectId: newId(ProjectId),
    track: 'SFX',
    startSec: 2,
    durationSec: 1.5,
    layer: 0,
    content: { type: 'media', mediaAssetId: MediaAssetId.parse(SOUND), inSec: 0, outSec: 1.5, volume: 1 },
    opacity: 1,
    createdAt: new Date(),
  }

  it('取り込んだ効果音はファイルの名前で呼ぶ', async () => {
    const api = {
      listClips: vi.fn().mockResolvedValue([]),
      listSfxJobs: vi.fn().mockResolvedValue([]),
      listUploadedSfx: vi.fn().mockResolvedValue([
        WireUploadedSfx.parse({ id: 'u1', mediaAssetId: SOUND, title: 'ドアの音', createdAt: new Date().toISOString() }),
      ]),
    }
    renderInWorkbench(
      <SfxAssetsProvider api={api}>
        <TimelineTracks
          shots={[]}
          clips={[placed]}
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
        />
      </SfxAssetsProvider>,
    )

    const clip = await screen.findByRole('button', { name: /^ドアの音 / })
    expect(clip.getAttribute('aria-label')).not.toContain(SOUND)
    expect(clip.getAttribute('title')).not.toContain(SOUND)
  })
})
