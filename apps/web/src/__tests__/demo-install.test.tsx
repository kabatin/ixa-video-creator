import { WorkspaceId } from '@ixa/domain'
import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DemoInstall } from '@/components/demo-install'
import { ApiError } from '@/lib/api-error'

/**
 * 見本を開く画面（ADR-0067）。開くと状態を見て、無ければ「まだ用意されていません」、あれば入れて作品へ移る。
 * 失敗したら理由と「もう一度」。**開発の strict mode で効果が 2 回走っても、失敗を出さない。**
 */

const getStatus = vi.fn()
const install = vi.fn()
const replace = vi.fn()

vi.mock('@/lib/demo-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/demo-api')>()
  return {
    ...actual,
    createDemoApi: () => ({
      getStatus: (workspaceId: string): Promise<unknown> => getStatus(workspaceId) as Promise<unknown>,
      install: (workspaceId: string): Promise<unknown> => install(workspaceId) as Promise<unknown>,
    }),
  }
})

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }))

const WS = WorkspaceId.parse('01JWSWSWSWSWSWSWSWSWSWSWSW')
const PROJECT = { id: '01JPRPRPRPRPRPRPRPRPRPRPRP', name: '見本の作品' }

beforeEach(() => {
  getStatus.mockReset()
  install.mockReset()
  replace.mockReset()
})

describe('見本を開く', () => {
  it('見本が無ければそう言い、一覧へ戻る道を出す（入れようとしない）', async () => {
    getStatus.mockResolvedValue({ available: false, title: null, totalBytes: null, project: null })
    render(<DemoInstall workspaceId={WS} />)
    expect(await screen.findByText('見本はまだ用意されていません')).toBeTruthy()
    expect(screen.getByRole('link', { name: '一覧へ戻る' }).getAttribute('href')).toBe('/')
    expect(install).not.toHaveBeenCalled()
  })

  it('入れている間は何をしているかと、初めて取りに行く大きさを言い、終わったら作品へ移る', async () => {
    getStatus.mockResolvedValue({ available: true, title: '見本の作品', totalBytes: 31_457_280, project: null })
    let finish: (value: unknown) => void = () => undefined
    install.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    render(<DemoInstall workspaceId={WS} />)
    expect(await screen.findByText('見本を入れています…')).toBeTruthy()
    expect(screen.getByText(/初めてのときは、およそ 30\.0 MB を取りに行きます/)).toBeTruthy()
    finish({ project: PROJECT, created: true })
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(`/projects/${PROJECT.id}`)
    })
  })

  it('もう入っていれば取りに行かずに作品へ移る', async () => {
    getStatus.mockResolvedValue({ available: true, title: '見本の作品', totalBytes: 1, project: PROJECT })
    render(<DemoInstall workspaceId={WS} />)
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(`/projects/${PROJECT.id}`)
    })
    expect(install).not.toHaveBeenCalled()
  })

  it('失敗したら理由と「もう一度」を出し、押すとやり直す', async () => {
    const reason = '見本のファイルが途中で壊れていました。もう一度試してください。'
    getStatus.mockResolvedValue({ available: true, title: '見本の作品', totalBytes: 10, project: null })
    install
      .mockRejectedValueOnce(new ApiError('POST /projects/demo: API が 502 を返しました', 502, JSON.stringify({ success: false, error: reason })))
      .mockResolvedValueOnce({ project: PROJECT, created: true })
    render(<DemoInstall workspaceId={WS} />)
    expect(await screen.findByText(reason)).toBeTruthy()
    expect(screen.queryByText(/502|https?:/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'もう一度' }))
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(`/projects/${PROJECT.id}`)
    })
  })

  it('strict mode で効果が 2 回走っても、失敗を出さずに作品へ移る', async () => {
    getStatus.mockResolvedValue({ available: true, title: '見本の作品', totalBytes: 10, project: null })
    install.mockResolvedValue({ project: PROJECT, created: true })
    render(
      <StrictMode>
        <DemoInstall workspaceId={WS} />
      </StrictMode>,
    )
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(`/projects/${PROJECT.id}`)
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
