import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NarrationPanel } from '@/components/workbench/panels/narration-panel'
import { renderInWorkbench, workbenchValue } from './workbench-fixture'

/**
 * ナレーションのパネル（ADR-0038）。行が並び、合計の長さを作品の長さと比べ、まとめて声にした結果を数で言う。
 * 呼び出し口は fetch を差し替えて、API が返す形をそのまま返す。
 */

const LINE_ID = '01J9ZK3V8Q4W6N2T5R7Y1X3C9B'

const lineJson = (patch: Record<string, unknown> = {}) => ({
  id: LINE_ID,
  projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  order: 0,
  text: '勝負の時が来た。',
  reading: '勝負の時が来た。',
  readingIsManual: false,
  voiceProfileId: null,
  direction: '',
  startSec: null,
  telop: true,
  selectedTakeId: null,
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
  estimatedSec: 2.4,
  durationSec: null,
  stale: false,
  takes: [],
  job: null,
  ...patch,
})

const settingsJson = {
  projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  readingDictionary: [],
  ducking: { enabled: true, depthDb: 10, attackSec: 0.15, releaseSec: 0.4 },
  telopHighlight: { enabled: false, color: '#ffd400' },
}

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, data }), { status, headers: { 'content-type': 'application/json' } })

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const route = (lines: readonly unknown[]) => {
  fetchMock.mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/narration/speak') && init?.method === 'POST') {
      return Promise.resolve(ok({ jobIds: ['a'], reusedTakeIds: [], skipped: { noVoice: 1, active: 0, upToDate: 0 } }, 202))
    }
    if (url.endsWith('/assist') && init?.method === 'POST') {
      return Promise.resolve(ok({ text: '勝負の時が来た。\n進め、戦子ちゃん！', costUsd: 0.01 }))
    }
    if (url.endsWith('/narration')) return Promise.resolve(ok({ lines, totalEstimatedSec: 18.2, endSec: 0 }))
    if (url.endsWith('/audio-settings')) return Promise.resolve(ok(settingsJson))
    return Promise.reject(new Error(`想定していない呼び出し: ${url}`))
  })
}

describe('NarrationPanel', () => {
  it('行が無ければ、原稿を貼り付ける欄を出す', async () => {
    route([])
    renderInWorkbench(<NarrationPanel />)

    expect(await screen.findByLabelText('原稿')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '行に分けて足す' })).toBeDisabled()
  })

  it('行を並べ、合計の長さが作品の長さを超えていれば知らせる', async () => {
    route([lineJson()])
    renderInWorkbench(<NarrationPanel />, { project: { ...workbenchValue().project, durationSec: 15 } })

    expect(await screen.findByRole('listitem', { name: '1 行目' })).toBeInTheDocument()
    expect(screen.getByText(/約 3 秒長いので/)).toBeInTheDocument()
    expect(screen.getByText('声はまだありません')).toBeInTheDocument()
  })

  /** 原稿の案（ADR-0038）。作品の方針と長さから書かせる。**使うまで欄は変わらない。** */
  it('原稿の案を AI に出してもらい、「使う」を押すまで欄は変わらない', async () => {
    route([])
    renderInWorkbench(<NarrationPanel />)
    const box = await screen.findByRole('textbox', { name: '原稿' })

    fireEvent.click(screen.getByRole('button', { name: 'ナレーションの原稿 の案を AI に出してもらう' }))
    fireEvent.click(screen.getByRole('button', { name: '案を出す' }))
    expect(await screen.findByRole('button', { name: '使う' })).toBeInTheDocument()
    expect(box).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: '使う' }))
    expect(box).toHaveValue('勝負の時が来た。\n進め、戦子ちゃん！')
    const [, body] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/assist')) ?? []
    expect(JSON.parse(typeof body?.body === 'string' ? body.body : '{}')).toMatchObject({ field: 'narration_script' })
  })

  it('まとめて声にすると、頼んだ数と飛ばした理由を数で言う', async () => {
    route([lineJson()])
    renderInWorkbench(<NarrationPanel />)
    await screen.findByRole('listitem', { name: '1 行目' })

    fireEvent.click(screen.getByRole('button', { name: 'まとめて声にする' }))

    expect(await screen.findByText('1 行を声にしています。声が決まっていない行が 1 行あります。')).toBeInTheDocument()
  })
})
