import { Take } from '@ixa/domain'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEDIA_ERROR_NETWORK } from '@/lib/playback-state'
import userEvent from '@testing-library/user-event'
import { TakeCard } from '@/components/take-card'
import { ContextMenuHost } from '@/components/workbench/ui/context-menu'
import { takeJson } from './fixtures'

/** 持ち込んだ Take はモデル名の代わりに出自を出す（ADR-0026）。 */

const api = vi.hoisted(() => ({
  mediaUrl: vi.fn(),
  mediaInfo: () => Promise.resolve({ bytes: 2_097_152, probe: { width: 1920, height: 1080 } }),
}))
vi.mock('@/lib/api-client', () => ({ createApiClient: () => api }))

beforeEach(() => {
  api.mediaUrl.mockReset()
  api.mediaUrl.mockReturnValue(new Promise(() => undefined))
})

const aTake = (overrides: Partial<Take>): Take =>
  Take.parse({ ...takeJson, createdAt: new Date(), ...overrides })

const renderCard = (take: Take) =>
  render(<TakeCard take={take} selected={false} busy={false} onSelect={() => undefined} />)

describe('TakeCard', () => {
  /** ADR-0057。不合格でも既定では自動で作り直さない。代わりに「作り直し推奨」を出す。 */
  it('不合格で自動の作り直しを選んでいなければ「作り直し推奨」を出す', () => {
    renderCard(aTake({ reviewStatus: 'failed', autoRetake: false }))
    expect(screen.getByText('作り直し推奨')).toBeTruthy()
  })

  /** 自動の作り直しが上限などで止まったら、API が Shot の状態と合わせて決めた値で、選んでいた Take にも出す。 */
  it('API が作り直し推奨と決めた Take には、自動の作り直しを選んでいても出す', () => {
    render(
      <TakeCard
        take={{ ...aTake({ reviewStatus: 'failed', autoRetake: true }), retakeRecommended: true }}
        selected={false}
        busy={false}
        onSelect={() => undefined}
      />,
    )
    expect(screen.getByText('作り直し推奨')).toBeTruthy()
  })

  it('自動の作り直しを選んだ Take・不合格でない Take には出さない', () => {
    const { unmount } = renderCard(aTake({ reviewStatus: 'failed', autoRetake: true }))
    expect(screen.queryByText('作り直し推奨')).toBeNull()
    unmount()
    renderCard(aTake({ reviewStatus: 'passed', autoRetake: false }))
    expect(screen.queryByText('作り直し推奨')).toBeNull()
  })

  it('作った Take には「プロンプト」のボタンを出し、押すと送った文が出る（プロンプトビューア）', async () => {
    render(
      <TakeCard
        take={aTake({ sentPrompt: { prompt: 'integrated_multimodal_description: [Shot 1] 走る' } })}
        selected={false}
        busy={false}
        onSelect={() => undefined}
        shotCode="CUT-03"
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'プロンプト' }))
    expect(screen.getByText('integrated_multimodal_description: [Shot 1] 走る')).toBeTruthy()
    expect(screen.getByText(/CUT-03 の Take #/)).toBeTruthy()
  })

  it('持ち込んだ Take（プロンプトで作っていない）には「プロンプト」のボタンを出さない', () => {
    renderCard(
      aTake({
        modelId: 'import/footage' as Take['modelId'],
        providerParams: { kind: 'import', sourceModel: null, fileName: null },
      }),
    )
    expect(screen.queryByRole('button', { name: 'プロンプト' })).toBeNull()
  })

  it('持ち込んだ Take は「持ち込み: モデル」と「アプリの外」', () => {
    renderCard(
      aTake({
        modelId: 'import/footage' as Take['modelId'],
        providerParams: { kind: 'import', sourceModel: 'Veo 3.1 Lite（推定）', fileName: '01.mp4' },
        costUsd: 0,
        generationTimeSec: 0,
      }),
    )

    expect(screen.getByText('持ち込み: Veo 3.1 Lite（推定）')).toBeTruthy()
    expect(screen.getByText('アプリの外')).toBeTruthy()
    expect(screen.queryByText('import/footage')).toBeNull()
  })

  it('生成した Take はモデル名のまま', () => {
    const take = aTake({})
    renderCard(take)

    expect(screen.getByText(take.modelId)).toBeTruthy()
  })
})

/** 制作者 2026-10-01「Takeを消す口」。右クリック（長押し）に加え、カードの「…」からも同じメニューを開く。 */
describe('TakeCard の「…」', () => {
  it('渡したメニューを開く（右クリックと同じ中身）', async () => {
    const take = aTake({ index: 2 })
    const run = vi.fn()
    render(
      <ContextMenuHost>
        <TakeCard
          take={take}
          selected={false}
          busy={false}
          onSelect={() => undefined}
          menuItems={() => [
            { kind: 'item', id: 'hide', label: 'Take を消す', disabledReason: null, run },
          ]}
        />
      </ContextMenuHost>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Take 2 のその他の操作' }))

    expect(screen.getByRole('menuitem', { name: /Take を消す/ })).toBeTruthy()
  })

  it('渡さなければ出さない（見るだけの画面）', () => {
    renderCard(aTake({ index: 2 }))

    expect(screen.queryByRole('button', { name: 'Take 2 のその他の操作' })).toBeNull()
  })
})

/** 制作者 2026-10-09「Take 比較の情報に解像度とか容量も欲しい」。 */
describe('TakeCard の大きさと容量', () => {
  it('素材を引けたら大きさと容量を出す', async () => {
    renderCard(aTake({}))

    expect(await screen.findByText('1920×1080')).toBeTruthy()
    expect(screen.getByText('2.0 MB')).toBeTruthy()
  })
})

/**
 * 2026-10-18。以前は 4 分ごとに `src` を差し替えており、見ている途中の動画が頭へ戻った。
 * いまは時刻では差し替えず、期限切れで読めなくなったときだけ取り直して同じ位置から続ける。
 */
describe('TakeCard のプレビューの URL', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-10-18T00:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const videoOf = (container: HTMLElement): HTMLVideoElement => {
    const found = container.querySelector('video')
    if (found === null) throw new Error('video がありません')
    return found
  }

  it('時刻では差し替えない（見ている途中で頭へ戻さない）', async () => {
    api.mediaUrl.mockResolvedValue({ url: 'https://example.invalid/first.mp4', expiresInSec: 300 })
    const { container } = renderCard(aTake({}))
    await act(async () => {
      await Promise.resolve()
    })
    expect(videoOf(container).getAttribute('src')).toBe('https://example.invalid/first.mp4')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600_000)
    })

    expect(api.mediaUrl).toHaveBeenCalledTimes(1)
    expect(videoOf(container).getAttribute('src')).toBe('https://example.invalid/first.mp4')
  })

  it('期限切れで読めなくなったら取り直して同じ位置へ戻す', async () => {
    api.mediaUrl
      .mockResolvedValueOnce({ url: 'https://example.invalid/first.mp4', expiresInSec: 300 })
      .mockResolvedValueOnce({ url: 'https://example.invalid/second.mp4', expiresInSec: 300 })
    const { container } = renderCard(aTake({}))
    await act(async () => {
      await Promise.resolve()
    })

    // 時刻の差し替え（以前の 4 分）より前に読めなくなった場合。取り直すのは失敗が来たからである。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100_000)
    })
    const video = videoOf(container)
    Object.defineProperty(video, 'error', { configurable: true, value: { code: MEDIA_ERROR_NETWORK } })
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 3.25 })
    await act(async () => {
      fireEvent.error(video)
      await Promise.resolve()
    })

    expect(api.mediaUrl).toHaveBeenCalledTimes(2)
    expect(videoOf(container).getAttribute('src')).toBe('https://example.invalid/second.mp4')

    // 差し替えた要素は頭から読み直す。
    Object.defineProperty(video, 'error', { configurable: true, value: null })
    Object.defineProperty(video, 'duration', { configurable: true, value: 8 })
    video.currentTime = 0
    vi.spyOn(video, 'pause').mockImplementation(() => undefined)
    fireEvent.loadedMetadata(video)
    expect(video.currentTime).toBe(3.25)
  })
})
