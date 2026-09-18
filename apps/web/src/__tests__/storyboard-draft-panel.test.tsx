import {
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  StoryboardDraftItemId as StoryboardDraftItemIdSchema,
  StoryboardDraftRunId as StoryboardDraftRunIdSchema,
  newId,
  type ShotId,
} from '@ixa/domain'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StoryboardDraftPanel } from '@/components/storyboard-draft-panel'
import type { CurrentShot } from '@/lib/storyboard-draft'
import type {
  StoryboardDraftApi,
  WireStoryboardDraftItem,
  WireStoryboardDraftLatest,
  WireStoryboardDraftRun,
} from '@/lib/storyboard-draft-api'

/**
 * 絵コンテ下書きの画面（P63-4）。見たいのは 1 点。
 * **押していない Shot が採用に送られないこと。**
 */

const projectId = newId(ProjectIdSchema)
const runId = newId(StoryboardDraftRunIdSchema)

const run: WireStoryboardDraftRun = {
  id: runId,
  projectId,
  drafter: 'stub-storyboard-drafter',
  status: 'done',
  costUsd: 0,
  error: null,
  createdAt: '2026-09-18T00:00:00.000Z',
}

const shotA: CurrentShot = {
  id: newId(ShotIdSchema),
  code: 'A',
  description: 'Aの元の説明',
  mood: '元の雰囲気',
}
const shotB: CurrentShot = {
  id: newId(ShotIdSchema),
  code: 'B',
  description: 'Bの元の説明',
  mood: null,
}

const itemFor = (
  shotId: ShotId,
  overrides: Partial<WireStoryboardDraftItem> = {},
): WireStoryboardDraftItem => ({
  id: newId(StoryboardDraftItemIdSchema),
  runId,
  shotId,
  description: `${shotId === shotA.id ? 'A' : 'B'} の案`,
  mood: '静かな緊張',
  reason: `${shotId === shotA.id ? 'A' : 'B'} は導入だから`,
  adoptedAt: null,
  createdAt: '2026-09-18T00:00:00.000Z',
  ...overrides,
})

const apiSpy = (overrides: Partial<StoryboardDraftApi> = {}): StoryboardDraftApi => ({
  getLatestDraft: vi.fn(() => Promise.resolve({ run: null, items: [] })),
  createDraft: vi.fn(() => Promise.resolve({ run, items: [itemFor(shotA.id)] })),
  adopt: vi.fn(() => Promise.resolve({ adopted: [], shots: [] })),
  ...overrides,
})

const panel = (props: Partial<React.ComponentProps<typeof StoryboardDraftPanel>> = {}) =>
  render(
    <StoryboardDraftPanel
      projectId={projectId}
      shots={[shotA, shotB]}
      initialRun={run}
      initialItems={[itemFor(shotA.id), itemFor(shotB.id)]}
      api={apiSpy()}
      {...props}
    />,
  )

describe('StoryboardDraftPanel', () => {
  it('いまの説明・案・なぜこの絵かを並べる', () => {
    panel()

    expect(screen.getByText('Aの元の説明')).toBeInTheDocument()
    expect(screen.getByText('A の案')).toBeInTheDocument()
    expect(screen.getByText(/A は導入だから/)).toBeInTheDocument()
  })

  it('下書きが Shot を書き換えないことを画面に書く', () => {
    panel()
    expect(screen.getByText(/Shot を書き換えません/)).toBeInTheDocument()
  })

  /** **既定で 1 件も選ばれていない。** ここが崩れると一括で書き換わる。 */
  it('既定ではどの案も選ばれていない', () => {
    panel()
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).not.toBeChecked()
    }
  })

  it('何も選んでいなければ採用を押せない', () => {
    panel()
    expect(screen.getByRole('button', { name: '採用する' })).toBeDisabled()
  })

  /** **この機能の中核。** 押した Shot だけが採用に送られる。 */
  it('選んだ Shot だけを採用に送る', async () => {
    const adopt = vi.fn(() => Promise.resolve({ adopted: [], shots: [] }))
    panel({ api: apiSpy({ adopt }) })

    await userEvent.click(screen.getByRole('checkbox', { name: 'A の案を採用する' }))
    await userEvent.click(screen.getByRole('button', { name: '選んだ 1 件を採用する' }))

    await waitFor(() => {
      expect(adopt).toHaveBeenCalledWith(projectId, runId, [shotA.id])
    })
  })

  it('全選択を押しても、採用済みの案は送らない', async () => {
    const adopt = vi.fn(() => Promise.resolve({ adopted: [], shots: [] }))
    panel({
      api: apiSpy({ adopt }),
      initialItems: [
        itemFor(shotA.id),
        itemFor(shotB.id, { adoptedAt: '2026-09-18T01:00:00.000Z' }),
      ],
    })

    await userEvent.click(screen.getByRole('button', { name: 'まだ決めていない案をすべて選ぶ' }))
    await userEvent.click(screen.getByRole('button', { name: '選んだ 1 件を採用する' }))

    await waitFor(() => {
      expect(adopt).toHaveBeenCalledWith(projectId, runId, [shotA.id])
    })
  })

  it('採用済みの案は選び直せない', () => {
    panel({
      initialItems: [itemFor(shotA.id, { adoptedAt: '2026-09-18T01:00:00.000Z' })],
    })

    expect(screen.getByRole('checkbox', { name: 'A の案を採用する' })).toBeDisabled()
    expect(screen.getByText('採用済み')).toBeInTheDocument()
  })

  /** 返ってきた Shot で「いまの説明」を差し替える。**差し替えないと古い文が残り続ける。** */
  it('採用した Shot の「いまの説明」を返り値で描き直す', async () => {
    const adoptedA = itemFor(shotA.id, { adoptedAt: '2026-09-18T01:00:00.000Z' })
    panel({
      api: apiSpy({
        adopt: vi.fn(() =>
          Promise.resolve({
            adopted: [adoptedA],
            shots: [{ id: shotA.id, code: 'A', description: 'A の案', mood: '静かな緊張' }],
          }),
        ),
      }),
    })

    expect(screen.getByText('Aの元の説明')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: 'A の案を採用する' }))
    await userEvent.click(screen.getByRole('button', { name: '選んだ 1 件を採用する' }))

    // A の古い説明が消え、案と揃ったことが画面に出る。
    await waitFor(() => {
      expect(screen.queryByText('Aの元の説明')).not.toBeInTheDocument()
    })
    expect(screen.getByText('いまの説明と同じ内容です')).toBeInTheDocument()
    // **B は触っていない。** 押していない Shot の説明は元のまま。
    expect(screen.getByText('Bの元の説明')).toBeInTheDocument()
  })

  it('採用できたことを親へ知らせる（画面の他の場所を合わせられるように）', async () => {
    const onAdopted = vi.fn()
    panel({
      onAdopted,
      api: apiSpy({
        adopt: vi.fn(() =>
          Promise.resolve({
            adopted: [itemFor(shotA.id, { adoptedAt: '2026-09-18T01:00:00.000Z' })],
            shots: [{ id: shotA.id, code: 'A', description: 'A の案', mood: '静かな緊張' }],
          }),
        ),
      }),
    })

    await userEvent.click(screen.getByRole('checkbox', { name: 'A の案を採用する' }))
    await userEvent.click(screen.getByRole('button', { name: '選んだ 1 件を採用する' }))

    await waitFor(() => {
      expect(onAdopted).toHaveBeenCalledWith([
        { id: shotA.id, code: 'A', description: 'A の案', mood: '静かな緊張' },
      ])
    })
  })

  /**
   * **開き直しても案が残る。** ここが無いと、27 件ぶんを数分待って作った案が
   * 再読み込みだけで消えたように見える。
   */
  it('開いたときに保存済みの下書きを読む', async () => {
    const getLatestDraft = vi.fn(() =>
      Promise.resolve({ run, items: [itemFor(shotA.id)] }),
    )
    panel({ initialRun: null, initialItems: [], api: apiSpy({ getLatestDraft }) })

    await waitFor(() => {
      expect(getLatestDraft).toHaveBeenCalledWith(projectId)
    })
    expect(await screen.findByText('A の案')).toBeInTheDocument()
  })

  it('先に読めているときは読み直さない', () => {
    const getLatestDraft = vi.fn(() => Promise.resolve({ run: null, items: [] }))
    panel({ api: apiSpy({ getLatestDraft }) })

    expect(getLatestDraft).not.toHaveBeenCalled()
  })

  it('preloaded なら案が無くても読みに行かない（空を読み込み中と混ぜない）', () => {
    const getLatestDraft = vi.fn(() => Promise.resolve({ run: null, items: [] }))
    panel({
      initialRun: null,
      initialItems: [],
      preloaded: true,
      api: apiSpy({ getLatestDraft }),
    })

    expect(getLatestDraft).not.toHaveBeenCalled()
    expect(screen.getByText('まだ案がありません')).toBeInTheDocument()
  })

  it('読み込みが終わるまで「案なし」と出さない', () => {
    panel({
      initialRun: null,
      initialItems: [],
      // 決して解決しない約束。読み込み中のまま止めて、何が出ているかを見る。
      api: apiSpy({
        getLatestDraft: vi.fn((): Promise<WireStoryboardDraftLatest> => new Promise(() => undefined)),
      }),
    })

    expect(screen.getByText('読み込み中です')).toBeInTheDocument()
    expect(screen.queryByText('まだ案がありません')).not.toBeInTheDocument()
  })

  it('読み込んだ結果が空なら案が無いと出す', async () => {
    panel({ initialRun: null, initialItems: [], api: apiSpy() })

    expect(await screen.findByText('まだ案がありません')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下書きする' })).toBeEnabled()
  })

  it('読み込みに失敗したら画面に出す（黙って「案なし」にしない）', async () => {
    panel({
      initialRun: null,
      initialItems: [],
      api: apiSpy({
        getLatestDraft: vi.fn(() => Promise.reject(new Error('読めませんでした'))),
      }),
    })

    expect(await screen.findByText(/読めませんでした/)).toBeInTheDocument()
  })

  /** 止まったまま残った run を「実行中」と見せ続けない。 */
  it('実行中のまま残った run は、いつ始まったかを出す', () => {
    panel({
      initialRun: { ...run, status: 'running', createdAt: '2020-01-01T00:00:00.000Z' },
      initialItems: [],
    })

    expect(screen.getByRole('alert')).toHaveTextContent('止まった可能性があります')
    expect(screen.getByRole('button', { name: '採用する' })).toBeDisabled()
  })

  it('下書きを押すと API を呼び、返ってきた案を並べる', async () => {
    const createDraft = vi.fn(() =>
      Promise.resolve({ run, items: [itemFor(shotA.id)] }),
    )
    panel({ initialRun: null, initialItems: [], api: apiSpy({ createDraft }) })

    await userEvent.click(screen.getByRole('button', { name: '下書きする' }))

    await waitFor(() => {
      expect(createDraft).toHaveBeenCalledWith(projectId)
    })
    expect(await screen.findByText('A の案')).toBeInTheDocument()
  })

  /** 失敗を握り潰さない。理由が出ないと「押したのに何も起きなかった」と読める。 */
  it('失敗した run は理由を読み上げ、採用させない', () => {
    panel({
      initialRun: {
        ...run,
        status: 'failed',
        error: { code: 'cli_timeout', message: 'CLI が終了しませんでした' },
      },
      initialItems: [],
    })

    expect(screen.getByRole('alert')).toHaveTextContent('CLI が終了しませんでした')
    expect(screen.getByRole('button', { name: '採用する' })).toBeDisabled()
  })

  it('採用が失敗したら画面に出す', async () => {
    panel({
      api: apiSpy({ adopt: vi.fn(() => Promise.reject(new Error('通信に失敗しました'))) }),
    })

    await userEvent.click(screen.getByRole('checkbox', { name: 'A の案を採用する' }))
    await userEvent.click(screen.getByRole('button', { name: '選んだ 1 件を採用する' }))

    expect(await screen.findByText(/通信に失敗しました/)).toBeInTheDocument()
  })

  it('雰囲気が未設定の Shot は空欄にせず「未設定」と出す', () => {
    panel({ initialItems: [itemFor(shotB.id)] })
    expect(screen.getByText('雰囲気: （未設定）')).toBeInTheDocument()
  })
})
