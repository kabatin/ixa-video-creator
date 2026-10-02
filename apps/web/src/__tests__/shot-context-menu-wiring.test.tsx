import type { Shot } from '@ixa/domain'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TakeGrid } from '@/components/take-grid'
import { TimelineTracks } from '@/components/timeline-tracks'
import { ShotListCompact } from '@/components/workbench/shot-list-compact'
import { StoryboardGrid } from '@/components/workbench/storyboard-grid'
import type { ContextMenuTriggerProps } from '@/components/workbench/use-context-menu'
import { Take } from '@ixa/domain'
import { takeJson } from './fixtures'
import { aWorkbenchShot } from './workbench-fixture'

/**
 * Shot を描く 3 か所（タイムライン・ストーリーボード・Shot 一覧）で、右クリックが **その Shot の**メニューの口に届く。
 * 中身と開き方は `use-shot-menu.test.tsx` と `use-context-menu.test.tsx` が見る。ここは届くことだけ。
 */

const SHOTS = [aWorkbenchShot(1, { status: 'draft' }), aWorkbenchShot(2, { status: 'draft' })]

/** 右クリックだけ記録し、ほかの口は何もしない。 */
const recorder = () => {
  const opened: string[] = []
  const contextMenu = (shot: Shot): ContextMenuTriggerProps => ({
    onContextMenu: (event) => {
      event.preventDefault()
      opened.push(shot.id)
    },
    onPointerDown: () => undefined,
    onPointerMove: () => undefined,
    onPointerUp: () => undefined,
    onPointerCancel: () => undefined,
    onKeyDown: () => undefined,
    onClickCapture: () => undefined,
    style: {},
  })
  return { opened, contextMenu }
}

describe('Shot の右クリックが届く', () => {
  it('ストーリーボードのカード', () => {
    const { opened, contextMenu } = recorder()
    render(
      <StoryboardGrid
        shots={SHOTS}
        posters={new Map()}
        selectedShotId={null}
        onSelect={vi.fn()}
        contextMenu={contextMenu}
      />,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: /CUT-02/, pressed: false }))

    expect(opened).toEqual([SHOTS[1]?.id])
  })

  it('Shot 一覧の行', () => {
    const { opened, contextMenu } = recorder()
    render(
      <ShotListCompact
        shots={SHOTS}
        posters={new Map()}
        selectedShotId={null}
        checked={new Set()}
        headerState="none"
        busy={false}
        sort={{ key: 'start', direction: 'asc' }}
        onSort={vi.fn()}
        onSelect={vi.fn()}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
        numberOf={() => 1}
        alignmentOf={() => undefined}
        showBeat={false}
        contextMenu={contextMenu}
      />,
    )

    fireEvent.contextMenu(screen.getByText('CUT-01'))

    expect(opened).toEqual([SHOTS[0]?.id])
  })

  it('タイムラインの Shot（Take 無しと出ている所でも）', () => {
    const { opened, contextMenu } = recorder()
    render(
      <TimelineTracks
        shots={SHOTS}
        clips={[]}
        transitionPoints={[]}
        renderedShotIds={new Set()}
        durationSec={16}
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
        onSelectShot={vi.fn()}
        shotContextMenu={contextMenu}
      />,
    )

    fireEvent.contextMenu(screen.getByText('CUT-02（Take 無し）'))

    expect(opened).toEqual([SHOTS[1]?.id])
  })
})

describe('Take の右クリックが届く', () => {
  it('Take 比較のカード', () => {
    const take = Take.parse({ ...takeJson, createdAt: new Date(takeJson.createdAt) })
    const opened: string[] = []
    render(
      <TakeGrid
        takes={[take]}
        selectedTakeId={null}
        busy={false}
        onSelect={vi.fn()}
        takeContextMenu={(target) => ({
          onContextMenu: (event) => {
            event.preventDefault()
            opened.push(target.id)
          },
          onPointerDown: () => undefined,
          onPointerMove: () => undefined,
          onPointerUp: () => undefined,
          onPointerCancel: () => undefined,
          onKeyDown: () => undefined,
          onClickCapture: () => undefined,
          style: {},
        })}
      />,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: '採用する' }))

    expect(opened).toEqual([take.id])
  })
})

