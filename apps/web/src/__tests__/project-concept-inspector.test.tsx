import type { MediaAssetId, Project } from '@ixa/domain'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProjectConceptInspector, type ProjectConceptInspectorApi } from '@/components/workbench/inspector/project-concept-inspector'
import { aProject, renderInWorkbench } from './workbench-fixture'

/**
 * 作品の方針（ADR-0030）。動画全体のコンセプト・ルック・手本画像・避けたいものを 1 か所で決め、
 * 全 Shot の生成に自動で入れる。**どこに効くかを欄ごとに言う**（効かない所も言う）。
 */

vi.mock('@/components/image-uploader', () => ({
  ImageUploader: ({ onUploaded, submitLabel }: { onUploaded: (id: MediaAssetId) => Promise<void>; submitLabel: string }) => (
    <button type="button" onClick={() => void onUploaded('asset-new' as MediaAssetId)}>
      {submitLabel}
    </button>
  ),
}))
vi.mock('@/components/media-image', () => ({
  MediaImage: ({ mediaAssetId, alt }: { mediaAssetId: string; alt: string }) => <img alt={alt} data-asset={mediaAssetId} />,
}))

const fakeApi = (project: Project, concept = ''): ProjectConceptInspectorApi => ({
  getConcept: vi.fn(() => Promise.resolve(concept)),
  saveConcept: vi.fn(() => Promise.resolve()),
  updateProject: vi.fn((_id, patch) => Promise.resolve({ ...project, ...patch } as Project)),
})

const open = async (patch: Partial<Project> = {}, concept = '') => {
  const project = { ...aProject, ...patch }
  const api = fakeApi(project, concept)
  const { value } = renderInWorkbench(<ProjectConceptInspector api={api} />, { project })
  await screen.findByLabelText('コンセプト・あらすじ')
  return { api, value }
}

const retype = async (label: string, text: string) => {
  const field = screen.getByLabelText(label)
  await userEvent.clear(field)
  await userEvent.type(field, text)
  field.blur()
}

describe('ProjectConceptInspector', () => {
  it('4 つの欄と、それぞれがどこに効くかを出す', async () => {
    await open()

    expect(screen.getByLabelText('ルック（画風・光・質感）')).toBeTruthy()
    expect(screen.getByLabelText('避けたいもの')).toBeTruthy()
    expect(screen.getByText(/AI が各 Shot の説明を書くとき/)).toBeTruthy()
    expect(screen.getByText(/全 Shot の映像と、Shot の絵/)).toBeTruthy()
    // 効かない所も言う（映像のモデルは「避ける」指定を受けない）。
    expect(screen.getByText(/映像には入りません/)).toBeTruthy()
  })

  it('書いてあるコンセプトを読み、直すと新しい版として保存する', async () => {
    const { api } = await open({}, '夜の街のバリスタの話')
    expect(screen.getByLabelText<HTMLTextAreaElement>('コンセプト・あらすじ').value).toBe('夜の街のバリスタの話')

    await retype('コンセプト・あらすじ', '雨の夜、配達員が店に辿り着く')

    await waitFor(() => {
      expect(api.saveConcept).toHaveBeenCalledWith(aProject.id, '雨の夜、配達員が店に辿り着く')
    })
  })

  /** 歌詞（ADR-0033。制作者 2026-10-01「歌詞は明確に入力するところを設けたい」）。1 行 = 1 フレーズ。 */
  it('歌詞を作品に保存し、フレーズの数と時刻の付き具合を言う', async () => {
    const { api } = await open({ lyrics: '夜明けの屋上で\n君を待ってた', lyricCues: [1.5] })
    expect(screen.getByText('2 フレーズ。時刻は 1 フレーズまで付いています。')).toBeTruthy()

    await retype('歌詞', '一行目\n二行目\n三行目')

    await waitFor(() => {
      expect(api.updateProject).toHaveBeenCalledWith(aProject.id, { lyrics: '一行目\n二行目\n三行目' })
    })
  })

  it('ルックと避けたいものは作品に保存し、画面を読み直す', async () => {
    const { api, value } = await open()

    await retype('ルック（画風・光・質感）', '35mm フィルム、夜の雨')
    await retype('避けたいもの', '文字、透かし')

    await waitFor(() => {
      expect(api.updateProject).toHaveBeenCalledWith(aProject.id, { styleGuide: '35mm フィルム、夜の雨' })
      expect(api.updateProject).toHaveBeenCalledWith(aProject.id, { avoid: '文字、透かし' })
    })
    expect(value.refresh).toHaveBeenCalled()
  })

  it('手本画像を足すと後ろに付け、外すとそれだけ除く', async () => {
    const { api } = await open({ styleReferenceAssetIds: ['asset-1' as MediaAssetId] })

    await userEvent.click(screen.getByRole('button', { name: '手本画像を追加' }))
    await waitFor(() => {
      expect(api.updateProject).toHaveBeenCalledWith(aProject.id, { styleReferenceAssetIds: ['asset-1', 'asset-new'] })
    })

    await userEvent.click(screen.getAllByRole('button', { name: /手本画像 1 を外す/ })[0] as HTMLElement)
    await waitFor(() => {
      expect(api.updateProject).toHaveBeenLastCalledWith(aProject.id, { styleReferenceAssetIds: ['asset-new'] })
    })
  })

  it('手本画像が 3 枚あれば、もう足せないと言う', async () => {
    await open({ styleReferenceAssetIds: ['a1', 'a2', 'a3'] as MediaAssetId[] })

    expect(screen.queryByRole('button', { name: '手本画像を追加' })).toBeNull()
    expect(screen.getByText(/3 枚までです/)).toBeTruthy()
  })

  it('保存できなければ理由を出す', async () => {
    const project = aProject
    const api = { ...fakeApi(project), updateProject: vi.fn(() => Promise.reject(new Error('手本には画像を指定してください'))) }
    renderInWorkbench(<ProjectConceptInspector api={api} />, { project })
    await screen.findByLabelText('コンセプト・あらすじ')

    await userEvent.click(screen.getByRole('button', { name: '手本画像を追加' }))

    expect((await screen.findByRole('alert')).textContent).toContain('手本には画像を指定してください')
  })
})
