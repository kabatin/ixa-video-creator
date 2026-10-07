import {
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  StoryboardDraftItemId as StoryboardDraftItemIdSchema,
  StoryboardDraftRunId as StoryboardDraftRunIdSchema,
  newId,
  type ShotId,
} from '@ixa/domain'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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
  camera: null,
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

  /**
   * 返ってきた Shot で「いまの説明」を差し替える。**差し替えないと古い文が残り続ける。**
   * 「いまの説明」の正は親の Shot（ワークベンチ）。採用を親へ知らせ、親が渡し直した Shot で描き直す。
   */
  it('採用した Shot の「いまの説明」を返り値で描き直す', async () => {
    const adoptedA = itemFor(shotA.id, { adoptedAt: '2026-09-18T01:00:00.000Z' })
    const api = apiSpy({
      adopt: vi.fn(() =>
        Promise.resolve({
          adopted: [adoptedA],
          shots: [{ id: shotA.id, code: 'A', description: 'A の案', mood: '静かな緊張' }],
        }),
      ),
    })
    /** ワークベンチと同じく、採用された Shot で一覧を差し替える親。 */
    const Parent = () => {
      const [shots, setShots] = useState<readonly CurrentShot[]>([shotA, shotB])
      return (
        <StoryboardDraftPanel
          projectId={projectId}
          shots={shots}
          initialRun={run}
          initialItems={[itemFor(shotA.id), itemFor(shotB.id)]}
          api={api}
          onAdopted={(adopted) => {
            const byId = new Map(adopted.map((shot) => [shot.id, shot] as const))
            setShots((previous) => previous.map((shot) => byId.get(shot.id) ?? shot))
          }}
        />
      )
    }
    render(<Parent />)

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
    expect(screen.getByRole('button', { name: 'AI で下書きする' })).toBeEnabled()
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
    // 案が無いので採否の操作は出さない（押せないボタンを並べない）。
    expect(screen.queryByRole('button', { name: '採用する' })).toBeNull()
  })

  it('下書きを押すと API を呼び、返ってきた案を並べる', async () => {
    const createDraft = vi.fn(() =>
      Promise.resolve({ run, items: [itemFor(shotA.id)] }),
    )
    panel({ initialRun: null, initialItems: [], api: apiSpy({ createDraft }) })

    await userEvent.click(screen.getByRole('button', { name: 'AI で下書きする' }))

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
    expect(screen.queryByRole('button', { name: '採用する' })).toBeNull()
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

/**
 * 作り直している間（制作者 2026-10-02「作り直す押したら、ボタン押せなくなってなんでだろってなってて」
 * 「しばらくしたら画面が更新されて案が変わってたけど、気付きづらかった」）。
 */
describe('StoryboardDraftPanel — 作り直している間', () => {
  type Drafted = Awaited<ReturnType<StoryboardDraftApi['createDraft']>>
  const pendingDraft = () => {
    let resolve: (value: Drafted) => void = () => undefined
    const createDraft = vi.fn(
      () =>
        new Promise<Drafted>((done) => {
          resolve = done
        }),
    )
    return { createDraft, finish: (value: Drafted) => resolve(value) }
  }

  it('作っていると分かる 1 行と経過を出し、選択の操作を止める（終わると案が入れ替わると言う）', async () => {
    const draft = pendingDraft()
    panel({ api: apiSpy({ createDraft: draft.createDraft }) })

    await userEvent.click(screen.getByRole('button', { name: '作り直す' }))

    const status = screen.getByRole('status', { name: '絵コンテの案を作っています' })
    expect(status).toHaveTextContent('AI が絵コンテの案を作っています')
    expect(status).toHaveTextContent('0:00 経過')
    expect(status).toHaveTextContent('終わると下の案が入れ替わります')
    expect(screen.getByRole('button', { name: '作っています…' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'A の案を採用する' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'まだ決めていない案をすべて選ぶ' })).toBeDisabled()
  })

  it('届いたら「新しい案が届いた」と言い、作っている 1 行を消す', async () => {
    const draft = pendingDraft()
    panel({ api: apiSpy({ createDraft: draft.createDraft }) })
    await userEvent.click(screen.getByRole('button', { name: '作り直す' }))

    draft.finish({ run, items: [itemFor(shotA.id, { description: 'A の新しい案' }), itemFor(shotB.id)] })

    expect(await screen.findByText(/新しい案が届きました（2 件）/)).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: '絵コンテの案を作っています' })).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'A の案を採用する' })).toBeEnabled()
  })
})

/**
 * 採用したら、案は「いまの説明」へ移ったと見せる（制作者 2026-10-03「採用ボタン押すと、「いまの説明」と「案」に同じ内容が
 * 並ぶから、採用したら案がいまの説明に移るようにしたほうが分かりやすい。案側は「採用されています」的な文言と
 * 「なぜこの絵か？」を引き続き表示する感じになると縦幅も減っていい」）。
 */
describe('StoryboardDraftPanel: 採用した行', () => {
  it('案の欄は「採用しました」と「なぜこの絵か」だけ（同じ文を 2 度出さない）', () => {
    panel({
      shots: [{ ...shotA, description: 'A の案', mood: '静かな緊張' }, shotB],
      initialItems: [itemFor(shotA.id, { adoptedAt: '2026-09-18T01:00:00.000Z' }), itemFor(shotB.id)],
    })

    expect(screen.getAllByText('A の案')).toHaveLength(1)
    expect(screen.getByText('採用しました（いまの説明に入っています）')).toBeInTheDocument()
    expect(screen.getByText(/A は導入だから/)).toBeInTheDocument()
  })

  it('CUT を押すと、その Shot を選んでインスペクターの絵コンテを開く（手で直す入口）', async () => {
    const onSelectShot = vi.fn()
    panel({ onSelectShot })

    await userEvent.click(screen.getByRole('button', { name: 'A' }))

    expect(onSelectShot).toHaveBeenCalledWith(shotA.id)
  })
})

/**
 * Shot はあるが案がまだ無い（制作者 2026-10-04「絵コンテの案のところ、Shot作ったあとに表示しても空なので、Shotがあるならリストは
 * 出してもいいんじゃないかな。その上でAIで下書きを作るみたいな流れになると分かりやすそう」）。
 */
describe('StoryboardDraftPanel: 案がまだ無い', () => {
  it('Shot を並べ、いまの説明を出し、案の欄で AI がまとめて下書きできると言う', () => {
    panel({
      shots: [shotA, { ...shotB, description: '' }],
      initialRun: null,
      initialItems: [],
      preloaded: true,
    })

    const table = screen.getByRole('table', { name: '絵コンテの案' })
    expect(within(table).getByText('Aの元の説明')).toBeInTheDocument()
    expect(within(table).getByText('（未記入）')).toBeInTheDocument()
    expect(within(table).getByText('まだ案がありません')).toBeInTheDocument()
    expect(within(table).getByText(/全 Shot（2 件）の説明と雰囲気の案を、AI がまとめて作ります/)).toBeInTheDocument()
    // 案の無い行は選べない（採用するものが無い）。
    expect(screen.queryByRole('checkbox', { name: 'A の案を採用する' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'AI で下書きする' })).toBeEnabled()
  })

  /**
   * **開いた後にできた Shot の案を「知らない Shot」と言わない。** 以前は開いたときの Shot を覚えたままで、
   * 区切って Shot にしてから下書きすると「39 件の案は、この画面が知らない Shot に対するものです」と出て、
   * 読み込み直すまで一覧が出なかった（制作者 2026-10-04）。
   */
  it('開いた後に渡された Shot で並べ、届いた案をその Shot に付ける', async () => {
    const createDraft = vi.fn(() => Promise.resolve({ run, items: [itemFor(shotA.id), itemFor(shotB.id)] }))
    const api = apiSpy({ createDraft })
    const { rerender } = render(
      <StoryboardDraftPanel projectId={projectId} shots={[]} initialRun={null} initialItems={[]} preloaded api={api} />,
    )
    rerender(
      <StoryboardDraftPanel
        projectId={projectId}
        shots={[shotA, shotB]}
        initialRun={null}
        initialItems={[]}
        preloaded
        api={api}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'AI で下書きする' }))

    expect(await screen.findByText('A の案')).toBeInTheDocument()
    expect(screen.getByText('B の案')).toBeInTheDocument()
    expect(screen.queryByText(/この画面が知らない Shot/)).toBeNull()
  })

  it('作り直しの後に作った Shot は、案の欄に「作り直すと入ります」と出して選ばせない', () => {
    const shotC: CurrentShot = { id: newId(ShotIdSchema), code: 'C', description: '', mood: null }
    panel({ shots: [shotA, shotB, shotC] })

    expect(screen.getByText('案はまだありません（作り直すと入ります）')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'C の案を採用する' })).toBeDisabled()
  })

  it('Shot が 0 件なら下書きを押させない（下書きする相手がいない）', () => {
    panel({ shots: [], initialRun: null, initialItems: [], preloaded: true })

    expect(screen.getByRole('button', { name: 'AI で下書きする' })).toBeDisabled()
  })
})

describe('StoryboardDraftPanel: 案が届いたとき', () => {
  it('何も選んでいなければ「前に選んでいたものは外しました」と言わない', async () => {
    panel({ api: apiSpy({ createDraft: vi.fn(() => Promise.resolve({ run, items: [itemFor(shotA.id), itemFor(shotB.id)] })) }) })

    await userEvent.click(screen.getByRole('button', { name: '作り直す' }))

    const arrived = await screen.findByText(/新しい案が届きました（2 件）/)
    expect(arrived).not.toHaveTextContent('前に選んでいた')
  })

  it('選んでいた案があれば、外したと言う', async () => {
    panel({ api: apiSpy({ createDraft: vi.fn(() => Promise.resolve({ run, items: [itemFor(shotA.id), itemFor(shotB.id)] })) }) })

    await userEvent.click(screen.getByRole('checkbox', { name: 'A の案を採用する' }))
    await userEvent.click(screen.getByRole('button', { name: '作り直す' }))

    expect(await screen.findByText(/前に選んでいたものは外しました/)).toBeInTheDocument()
  })
})

/**
 * カメラの案（ADR-0043。制作者 2026-10-07「内容から判断付くようなものは自動である程度
 * 設定してもらえると嬉しい」）。**提案が無い行には出さない。**
 */
describe('カメラの案の表示', () => {
  it('案にカメラがあれば行に出す', () => {
    panel({
      initialItems: [
        itemFor(shotA.id, { camera: { movement: 'tilt', movementIntensity: 'moderate' } }),
        itemFor(shotB.id),
      ],
    })

    expect(screen.getByText('カメラ: ティルト / 中')).toBeVisible()
  })

  it('提案が無ければ行ごと出さない', () => {
    panel({ initialItems: [itemFor(shotA.id), itemFor(shotB.id)] })

    expect(screen.queryByText(/^カメラ:/)).toBeNull()
  })
})
