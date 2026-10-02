import type { Project } from '@ixa/domain'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProjectConceptInspector, type ProjectConceptInspectorApi } from '@/components/workbench/inspector/project-concept-inspector'
import { CutterPanel } from '@/components/workbench/panels/cutter-panel'
import { goToLyricSync } from '@/components/workbench/workbench-navigation'
import { aProject, renderInWorkbench, workbenchValue } from './workbench-fixture'

/**
 * 歌詞を合わせる画面への入口（制作者 2026-10-02「歌詞の自動テロップってどこからやるんだっけ」「この画面すっごいわかりづらいなー」）。
 * 入口が「聴きながら切る」の中にしか無く、歌詞を入れる場所（作品の方針）から辿れなかった。
 */

vi.mock('@/components/image-uploader', () => ({ ImageUploader: () => null }))
vi.mock('@/components/media-image', () => ({ MediaImage: () => null }))

const fakeApi = (project: Project): ProjectConceptInspectorApi => ({
  getConcept: vi.fn(() => Promise.resolve('')),
  saveConcept: vi.fn(() => Promise.resolve()),
  updateProject: vi.fn((_id, patch) => Promise.resolve({ ...project, ...patch } as Project)),
})

describe('goToLyricSync', () => {
  it('聴きながら切るを「歌詞を合わせる」で開く', () => {
    const workbench = workbenchValue()

    goToLyricSync(workbench)

    expect(workbench.openCutter).toHaveBeenCalledWith('lyrics')
  })
})

describe('作品の方針の「聴きながら時刻を付ける」', () => {
  it('歌詞があれば押せて、聴きながら切るを歌詞のモードで開く', async () => {
    const project = { ...aProject, lyrics: '一行目\n二行目' }
    const { value } = renderInWorkbench(<ProjectConceptInspector api={fakeApi(project)} />, { project })

    await userEvent.click(await screen.findByRole('button', { name: '聴きながら時刻を付ける' }))

    expect(value.openCutter).toHaveBeenCalledWith('lyrics')
  })

  it('歌詞がまだ無ければ押せない', async () => {
    const project = { ...aProject, lyrics: '' }
    renderInWorkbench(<ProjectConceptInspector api={fakeApi(project)} />, { project })

    expect(await screen.findByRole('button', { name: '聴きながら時刻を付ける' })).toHaveProperty('disabled', true)
  })
})

describe('聴きながら切るのタブ', () => {
  it('いまのモードを押した状態で出し、押すとそのモードにする', async () => {
    const { value } = renderInWorkbench(<CutterPanel visible />, { cutterMode: 'lyrics', musicLoaded: true, track: null })

    expect(screen.getByRole('button', { name: '歌詞を合わせる' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '区切る' }).getAttribute('aria-pressed')).toBe('false')

    await userEvent.click(screen.getByRole('button', { name: '区切る' }))

    expect(value.openCutter).toHaveBeenCalledWith('cut')
  })
})
