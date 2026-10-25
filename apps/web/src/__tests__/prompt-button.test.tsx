import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PromptButton } from '@/components/prompt/prompt-button'
import { PromptViewerProvider } from '@/components/prompt/prompt-viewer-provider'
import { MakeMusicDialogBody } from '@/components/workbench/dialogs/make-music-dialog'
import { MakeSfxDialogBody } from '@/components/workbench/dialogs/make-sfx-dialog'
import { MusicJobsProvider } from '@/components/workbench/music-jobs'
import type { MusicJobApi } from '@/lib/music-job-api'
import { promptViewFromMusic, promptViewFromSfx, type PromptReuse, type PromptView } from '@/lib/prompt-view'
import { renderInWorkbench } from './workbench-fixture'

const copyText = vi.hoisted(() => vi.fn<(text: string) => Promise<void>>())
vi.mock('@/lib/copy-text', () => ({ copyText }))

/**
 * プロンプトのボタンとビューア（制作者 2026-10-25）。記録のある所にだけボタンが出て、押すと同じポップアップが開く。
 * コピーは必ず `copyText` を通る。「これを元に作る」は楽曲・効果音の作成画面に文を入れて開く。
 */

const AT = new Date('2026-10-25T03:00:00Z')

const music = promptViewFromMusic('作った曲', {
  prompt: 'j-pop, upbeat',
  lyrics: '[chorus]\nいけ',
  instrumental: false,
  seed: 42,
  durationSec: 90,
  tool: 'ace_step',
  model: null,
  createdAt: AT,
})

const sfx = promptViewFromSfx('metal clang', {
  cue: { startSec: 2, durationSec: 1.5, prompt: 'metal clang', negativePrompt: 'music', volume: 0.8 },
  seed: 7,
  tool: null,
  createdAt: AT,
})

const only = <T,>(value: T | null): T => {
  if (value === null) throw new Error('view が無い')
  return value
}

afterEach(() => {
  copyText.mockReset()
})

describe('PromptButton', () => {
  it('記録が無い（view が null）なら何も描かない', () => {
    const { container } = render(<PromptButton view={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('押すと、何のプロンプトか・送った文・補足が出る（共通のビューアが無い所でも開ける）', async () => {
    render(<PromptButton view={only(music)} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプト' }))

    expect(screen.getByText('作った曲')).toBeInTheDocument()
    expect(screen.getByText('j-pop, upbeat')).toBeInTheDocument()
    expect(screen.getByText(/いけ/)).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    // 作業画面の外では「これを元に作る」を出さない（作成画面が無い）。
    expect(screen.queryByRole('button', { name: 'これを元に作る' })).toBeNull()
  })

  it('欄のコピーと全部コピーは copyText を通る', async () => {
    copyText.mockResolvedValue(undefined)
    render(<PromptButton view={only(music)} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプト' }))

    const [first] = screen.getAllByRole('button', { name: 'コピー' })
    if (first === undefined) throw new Error('コピーのボタンが無い')
    await userEvent.click(first)
    expect(copyText).toHaveBeenLastCalledWith('j-pop, upbeat')
    expect(await screen.findByText('コピーしました')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '全部コピー' }))
    expect(copyText).toHaveBeenLastCalledWith(expect.stringContaining('曲調\nj-pop, upbeat\n\n歌詞\n[chorus]\nいけ'))
  })

  it('コピーできなければ理由を出す', async () => {
    copyText.mockRejectedValue(new Error('コピーできませんでした。表示された文字を選んでコピーしてください'))
    render(<PromptButton view={only(music)} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプト' }))
    await userEvent.click(screen.getByRole('button', { name: '全部コピー' }))
    expect(await screen.findByText(/表示された文字を選んでコピーしてください/)).toBeInTheDocument()
  })

  it('記録の無い絵は本文の代わりに注記を出し、コピーのボタンを出さない', async () => {
    const view: PromptView = { title: 'キーアート', tool: null, createdAt: AT, sections: [], facts: [], note: 'この絵は送った文を記録していません' }
    render(<PromptButton view={view} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプト' }))
    expect(screen.getByText('この絵は送った文を記録していません')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '全部コピー' })).toBeNull()
  })

  it('共通のビューアの中では「これを元に作る」で初期値を渡し、ビューアを閉じる', async () => {
    const onReuse = vi.fn<(reuse: PromptReuse) => void>()
    render(
      <PromptViewerProvider onReuse={onReuse}>
        <PromptButton view={only(music)} />
      </PromptViewerProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'プロンプト' }))
    await userEvent.click(screen.getByRole('button', { name: 'これを元に作る' }))

    expect(onReuse).toHaveBeenCalledWith(only(music).reuse)
    await waitFor(() => {
      expect(screen.queryByText('j-pop, upbeat')).toBeNull()
    })
  })
})

describe('これを元に作る（作成画面に文が入る）', () => {
  const musicApi = (): MusicJobApi => ({
    generateMusic: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
    listMusicJobs: vi.fn().mockResolvedValue([]),
    cancelMusicJobs: vi.fn().mockResolvedValue({ cancelledJobIds: [] }),
    musicTool: vi.fn().mockResolvedValue('ace_step'),
  })

  it('曲を作る窓に、曲調・歌詞・長さ・歌を入れるかが入っている', () => {
    const reuse = only(music).reuse
    if (reuse?.kind !== 'music') throw new Error('楽曲の初期値が無い')
    renderInWorkbench(
      <MusicJobsProvider api={musicApi()}>
        <MakeMusicDialogBody initialForm={reuse.form} />
      </MusicJobsProvider>,
    )
    expect(screen.getByLabelText('曲調')).toHaveValue('j-pop, upbeat')
    expect(screen.getByLabelText('歌詞')).toHaveValue('[chorus]\nいけ')
    expect(screen.getByLabelText('歌を入れる')).toBeChecked()
  })

  it('効果音を作る窓に、前のきっかけの行が入っている（Shot を選んでいなくても開ける）', () => {
    const reuse = only(sfx).reuse
    if (reuse?.kind !== 'sfx') throw new Error('効果音の初期値が無い')
    renderInWorkbench(<MakeSfxDialogBody initialRows={reuse.rows} />, { selectedShotId: null, dialogShotIds: null })
    expect(screen.getByDisplayValue('metal clang')).toBeInTheDocument()
    expect(screen.getByText('除外する内容: music')).toBeInTheDocument()
    expect(screen.queryByText('効果音を作る Shot を選んでから開いてください。')).toBeNull()
  })
})
