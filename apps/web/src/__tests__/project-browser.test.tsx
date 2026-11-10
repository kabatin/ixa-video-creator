import { ProjectId, WorkspaceId, newId, type ProjectKind, type ProjectStatus } from '@ixa/domain'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ProjectBrowser } from '@/components/project-browser'
import type { WireProjectListItem } from '@/lib/api-schemas'

/**
 * 作品一覧（名前で探す・並べ方・素材置き場の畳み）と、カードの言葉（種類・進み具合・最後に触った時刻・状態の札）。
 */

type RowInput = {
  readonly name: string
  readonly kind?: ProjectKind
  readonly status?: ProjectStatus
  readonly createdAt?: string
  readonly lastActivityAt?: string
  readonly shotCount?: number
  readonly adoptedTakeCount?: number
  readonly hasRender?: boolean
}

const row = (input: RowInput): WireProjectListItem => ({
  id: newId(ProjectId),
  workspaceId: newId(WorkspaceId),
  name: input.name,
  kind: input.kind ?? 'mv',
  demoKey: null,
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  durationSec: null,
  budgetUsd: null,
  styleGuide: '',
  avoid: '',
  styleReferenceAssetIds: [],
  lyrics: '',
  lyricCues: [],
  instrumental: false,
  masteringMode: null,
  status: input.status ?? 'planning',
  createdAt: new Date(input.createdAt ?? '2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  activity: {
    lastActivityAt: new Date(input.lastActivityAt ?? '2026-11-01T00:00:00.000Z'),
    shotCount: input.shotCount ?? 0,
    adoptedTakeCount: input.adoptedTakeCount ?? 0,
    hasRender: input.hasRender ?? false,
  },
})

const NIGHT = row({
  name: 'NIGHT RUN',
  createdAt: '2026-10-01T00:00:00.000Z',
  lastActivityAt: '2026-11-10T05:02:00.000Z',
  shotCount: 27,
  adoptedTakeCount: 20,
  hasRender: true,
  status: 'production',
})
const SENKO = row({
  name: '進め！戦子ちゃん！',
  kind: 'short',
  createdAt: '2026-10-05T00:00:00.000Z',
  lastActivityAt: '2026-11-09T00:00:00.000Z',
  shotCount: 5,
  adoptedTakeCount: 0,
})
const ASAYAKE = row({ name: 'あさやけ', kind: 'kamishibai', createdAt: '2026-10-03T00:00:00.000Z' })
const SHELF = row({ name: 'キャラ置き場', kind: 'library' })

const cardNames = (): readonly string[] =>
  screen.queryAllByRole('heading', { level: 2 }).map((heading) => heading.textContent ?? '')

const searchBox = () => screen.getByRole('searchbox', { name: 'プロジェクトを検索' })
const libraryToggle = () => screen.getByRole('button', { name: /素材置き場（/ })

describe('ProjectBrowser', () => {
  it('はじめは最近更新した順で、素材置き場は畳んで件数だけ出す', () => {
    render(<ProjectBrowser projects={[ASAYAKE, SENKO, NIGHT, SHELF]} />)

    expect(cardNames()).toEqual(['NIGHT RUN', '進め！戦子ちゃん！', 'あさやけ'])
    expect(libraryToggle()).toHaveTextContent('素材置き場（1 件）')
    expect(libraryToggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('キャラ置き場')).not.toBeInTheDocument()
  })

  it('押すと素材置き場を開く', async () => {
    render(<ProjectBrowser projects={[NIGHT, SHELF]} />)

    await userEvent.click(libraryToggle())

    expect(libraryToggle()).toHaveAttribute('aria-expanded', 'true')
    expect(cardNames()).toEqual(['NIGHT RUN', 'キャラ置き場'])
  })

  it('打つたびに名前で絞る（全角でも）', async () => {
    render(<ProjectBrowser projects={[ASAYAKE, SENKO, NIGHT]} />)

    await userEvent.type(searchBox(), 'ＮＩＧ')
    expect(cardNames()).toEqual(['NIGHT RUN'])

    await userEvent.clear(searchBox())
    await userEvent.type(searchBox(), '戦子')
    expect(cardNames()).toEqual(['進め！戦子ちゃん！'])
  })

  it('並べ方を変えると並びが変わる', async () => {
    render(<ProjectBrowser projects={[ASAYAKE, SENKO, NIGHT]} />)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '並べ方' }), '新しく作った順')
    expect(cardNames()).toEqual(['進め！戦子ちゃん！', 'あさやけ', 'NIGHT RUN'])

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '並べ方' }), '名前順')
    expect(cardNames()[0]).toBe('NIGHT RUN')
  })

  it('検索語が素材置き場に当たっている間は開き、消すと畳む', async () => {
    render(<ProjectBrowser projects={[NIGHT, SHELF]} />)

    await userEvent.type(searchBox(), 'キャラ')
    expect(libraryToggle()).toHaveAttribute('aria-expanded', 'true')
    expect(cardNames()).toEqual(['キャラ置き場'])

    await userEvent.clear(searchBox())
    expect(libraryToggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('素材置き場が 1 件も無ければ段ごと出さない', () => {
    render(<ProjectBrowser projects={[NIGHT]} />)

    expect(screen.queryByRole('button', { name: /素材置き場/ })).not.toBeInTheDocument()
  })

  it('どれにも当たらなければ 1 行で言い、検索語を消せる', async () => {
    render(<ProjectBrowser projects={[NIGHT, SHELF]} />)

    await userEvent.type(searchBox(), '夜明け')
    expect(screen.getByRole('status')).toHaveTextContent('「夜明け」に当たるプロジェクトはありません。')
    expect(cardNames()).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: '検索語を消す' }))
    expect(searchBox()).toHaveValue('')
    expect(cardNames()).toEqual(['NIGHT RUN'])
  })
})

describe('カードの言葉', () => {
  const cardOf = (name: string) => {
    const heading = screen.getByRole('heading', { level: 2, name })
    const card = heading.closest('li')
    if (card === null) throw new Error('カードがありません')
    return within(card)
  }

  it('種類・進み具合・最後に触った時刻（東京）を出す', () => {
    render(<ProjectBrowser projects={[NIGHT, SENKO, ASAYAKE]} />)

    const night = cardOf('NIGHT RUN')
    expect(night.getByText('ミュージックビデオ')).toBeInTheDocument()
    expect(night.getByText('Shot 27・Take 20/27・書き出し済み')).toBeInTheDocument()
    expect(night.getByText('更新 2026/11/10 14:02')).toBeInTheDocument()

    expect(cardOf('進め！戦子ちゃん！').getByText('Shot 5・Take 0/5')).toBeInTheDocument()
    expect(cardOf('あさやけ').getByText('Shot はまだありません')).toBeInTheDocument()
  })

  it('素材置き場で Shot が無ければ進み具合の行を出さない', async () => {
    render(<ProjectBrowser projects={[SHELF]} />)
    await userEvent.click(libraryToggle())

    const shelf = cardOf('キャラ置き場')
    expect(shelf.getByText('素材置き場')).toBeInTheDocument()
    expect(shelf.queryByText(/^Shot/)).not.toBeInTheDocument()
  })

  it('状態の札は「企画」のままなら出さず、変えていれば出す', () => {
    render(<ProjectBrowser projects={[NIGHT, ASAYAKE]} />)

    expect(cardOf('あさやけ').queryByText('企画')).not.toBeInTheDocument()
    expect(cardOf('NIGHT RUN').getByText('制作')).toBeInTheDocument()
  })
})
