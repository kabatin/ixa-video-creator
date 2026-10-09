import { Take } from '@ixa/domain'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { TakeCard } from '@/components/take-card'
import { ContextMenuHost } from '@/components/workbench/ui/context-menu'
import { takeJson } from './fixtures'

/** 持ち込んだ Take はモデル名の代わりに出自を出す（ADR-0026）。 */

vi.mock('@/lib/api-client', () => ({
  createApiClient: () => ({
    mediaUrl: () => new Promise(() => undefined),
    mediaInfo: () => Promise.resolve({ bytes: 2_097_152, probe: { width: 1920, height: 1080 } }),
  }),
}))

const aTake = (overrides: Partial<Take>): Take =>
  Take.parse({ ...takeJson, createdAt: new Date(), ...overrides })

const renderCard = (take: Take) =>
  render(<TakeCard take={take} selected={false} busy={false} onSelect={() => undefined} />)

describe('TakeCard', () => {
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
