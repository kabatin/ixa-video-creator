import { WorkspaceId } from '@ixa/domain'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProjectForm } from '@/components/project-form'
import { WORKSPACE_ID } from './fixtures'

/**
 * 新規作成（制作者 2026-10-03「アスペクト比は数字「16:9」を見ても、これって縦だっけ？横だっけ？みたいになるし
 * 形も分かりづらいので実際のサイズ図を選ぶ形がよさそう」「解像度もサイズ図的なものを選ぶ形式がよさそう」
 * 「使う生成 AI 欄や FPS 欄もよしなに合わせて欲しい」）。
 * 以前の「使う映像生成 AI」の選択は保存されず、fps を埋めるだけだった。いまは「使う AI」で選んでいる動画の AI を見せて、
 * fps をそれに合わせる案内を出す。
 */

const ai = vi.hoisted(() => ({ video: 'vpipe' }))
const api = vi.hoisted(() => ({ createProject: vi.fn(() => Promise.resolve({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' })) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  createApiClient: () => ({ createProject: api.createProject }),
}))
vi.mock('@/lib/models-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/models-api')>()),
  createModelsApi: () => ({
    listModels: () =>
      Promise.resolve([
        { id: 'vpipe/h3', providerId: 'vpipe', label: 'MiniMax H3', fps: [24] },
        { id: 'fal/seedance', providerId: 'fal', label: 'Seedance', fps: [24, 30] },
      ]),
  }),
}))
vi.mock('@/lib/ai-settings-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai-settings-api')>()),
  createAiSettingsApi: () => ({
    getAiSettings: () =>
      Promise.resolve({ settings: { text: 'stub', image: 'stub', video: ai.video }, source: 'saved' }),
  }),
}))

const show = () => render(<ProjectForm workspaceId={WorkspaceId.parse(WORKSPACE_ID)} />)

describe('ProjectForm（新規作成）', () => {
  it('画面の形は図つきのカードで選ぶ（横長 16:9 が既定）', () => {
    show()
    expect(screen.getByRole('radio', { name: /横長 16:9/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /縦長 9:16/ })).toBeInTheDocument()
  })

  it('形を変えると、大きさの選択肢がその形のものになる', async () => {
    show()
    await userEvent.click(screen.getByRole('radio', { name: /縦長 9:16/ }))
    expect(screen.getByRole('radio', { name: /FHD 縦/ })).toBeChecked()
    expect(screen.queryByRole('radio', { name: /^4K/ })).toBeNull()
  })

  it('fps はカードで選び、30 が既定', () => {
    show()
    expect(screen.getByRole('radio', { name: /30 fps/ })).toBeChecked()
  })

  it('「使う AI」の動画の AI と、その AI が作る fps を言い、合わせるボタンを出す', async () => {
    show()
    expect(await screen.findByText(/動画を作る AI: MiniMax H3/)).toBeInTheDocument()
    expect(screen.getByText(/この AI の動画は 24 fps です/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '24 fps に合わせる' }))

    expect(screen.getByRole('radio', { name: /24 fps/ })).toBeChecked()
    expect(screen.queryByRole('button', { name: '24 fps に合わせる' })).toBeNull()
  })

  it('保存されない「使う映像生成 AI」の選択欄は出さない', () => {
    show()
    expect(screen.queryByLabelText('使う映像生成 AI')).toBeNull()
  })

  it('作成ボタンは共通の主ボタン', () => {
    show()
    expect(screen.getByRole('button', { name: 'プロジェクトを作成' }).className).toContain('bg-accent')
  })
})

/** 何を作るか（作品の種類）。いちばん上で聞き、形をまだ選んでいなければ、その種類の既定の形にする。 */
describe('ProjectForm の「何を作りますか」', () => {
  it('5 つの種類を名前と一言で並べ、ミュージックビデオを選んでおく', () => {
    show()
    const group = screen.getByRole('group', { name: '何を作りますか' })
    expect(within(group).getAllByRole('radio').map((radio) => radio.closest('label')?.textContent)).toEqual([
      'ミュージックビデオ曲に合わせて切ります。横長',
      'ショート動画曲に合わせて切ります。縦長',
      '紙芝居ナレーションと絵で進めます',
      'CM・予告ナレーションと文字で短く伝えます',
      '素材置き場キャラクターや曲をためておき、他の作品へ取り込みます',
    ])
    expect(within(group).getByRole('radio', { name: /ミュージックビデオ/ })).toBeChecked()
  })

  it('ショート動画を選ぶと縦長になり、ミュージックビデオに戻すと横長に戻る', async () => {
    show()
    await userEvent.click(screen.getByRole('radio', { name: /^ショート動画/ }))
    expect(screen.getByRole('radio', { name: /縦長 9:16/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /FHD 縦/ })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: /ミュージックビデオ/ }))
    expect(screen.getByRole('radio', { name: /横長 16:9/ })).toBeChecked()
  })

  it('形を自分で選んだら、種類を変えても形は変わらない', async () => {
    show()
    await userEvent.click(screen.getByRole('radio', { name: /正方形 1:1/ }))
    await userEvent.click(screen.getByRole('radio', { name: /^ショート動画/ }))
    expect(screen.getByRole('radio', { name: /正方形 1:1/ })).toBeChecked()
  })

  it('選んだ種類で作る', async () => {
    show()
    await userEvent.type(screen.getByLabelText('プロジェクト名'), '夏の紙芝居')
    await userEvent.click(screen.getByRole('radio', { name: /紙芝居/ }))
    await userEvent.click(screen.getByRole('button', { name: 'プロジェクトを作成' }))
    expect(api.createProject).toHaveBeenCalledWith(expect.objectContaining({ name: '夏の紙芝居', kind: 'kamishibai' }))
  })
})
