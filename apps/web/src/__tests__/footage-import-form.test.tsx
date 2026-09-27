import { MediaAssetId, ProjectId, ShotId, Take, WorkspaceId } from '@ixa/domain'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FootageImportForm } from '@/components/workbench/inspector/footage-import-form'
import type { FootageImportApi, ImportTakeBody } from '@/lib/footage-api'
import { PROJECT_ID, SHOT_ID, WORKSPACE_ID, takeJson } from './fixtures'

/** 手持ちの動画を Shot の Take にする欄（ADR-0026）。 */

const shot = { id: ShotId.parse(SHOT_ID), code: 'S01' }
const common = { shot, workspaceId: WorkspaceId.parse(WORKSPACE_ID), projectId: ProjectId.parse(PROJECT_ID) }

const fakeApi = (): FootageImportApi => ({
  uploadMedia: vi.fn((file: File) => Promise.resolve({ id: MediaAssetId.parse(takeJson.mediaAssetId), name: file.name } as never)),
  importTake: vi.fn((_shot: ShotId, body: ImportTakeBody) =>
    Promise.resolve(Take.parse({ ...takeJson, createdAt: new Date(), providerParams: { kind: 'import', sourceModel: body.sourceModel ?? null, fileName: body.fileName } })),
  ),
})

const video = (name: string) => new File(['x'], name, { type: 'video/mp4' })

describe('FootageImportForm', () => {
  it('動画を選び、モデルを書いて取り込むと、Take にしたと言う', async () => {
    const api = fakeApi()
    const onImported = vi.fn()
    const { container } = render(<FootageImportForm {...common} api={api} onImported={onImported} />)

    const input = container.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('ファイル選択が無い')
    await userEvent.upload(input, [video('a.mp4'), video('b.mp4')])
    await userEvent.type(screen.getByLabelText('作ったモデル（分かれば）'), '  Kling 3.0 ')
    await userEvent.click(screen.getByRole('button', { name: 'Shot S01 の Take にする（2 本）' }))

    expect(await screen.findByRole('status')).toHaveProperty('textContent', '2 本を Take にしました。Take 比較で採用できます。')
    expect(api.importTake).toHaveBeenCalledWith(shot.id, expect.objectContaining({ sourceModel: 'Kling 3.0', fileName: 'a.mp4' }))
    expect(onImported).toHaveBeenCalledTimes(1)
  })

  it('モデルが空なら「分からない」（null）で送る', async () => {
    const api = fakeApi()
    render(<FootageImportForm {...common} api={api} files={[video('a.mp4')]} />)

    await userEvent.click(screen.getByRole('button', { name: /Take にする/ }))

    await screen.findByRole('status')
    expect(api.importTake).toHaveBeenCalledWith(shot.id, expect.objectContaining({ sourceModel: null }))
  })

  it('落とされた動画があればファイル選択は出さない', () => {
    const { container } = render(<FootageImportForm {...common} api={fakeApi()} files={[video('a.mp4')]} />)

    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Shot S01 の Take にする（1 本）' })).toBeTruthy()
  })

  it('動画を選ぶまでは押せない', () => {
    render(<FootageImportForm {...common} api={fakeApi()} />)

    expect(screen.getByRole('button', { name: /Take にする/ }).hasAttribute('disabled')).toBe(true)
  })

  it('失敗したら理由を出す', async () => {
    const api = { ...fakeApi(), importTake: vi.fn(() => Promise.reject(new Error('boom'))) }
    render(<FootageImportForm {...common} api={api} files={[video('a.mp4')]} />)

    await userEvent.click(screen.getByRole('button', { name: /Take にする/ }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/^取り込めませんでした/)
  })
})
