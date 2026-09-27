import { Take } from '@ixa/domain'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TakeCard } from '@/components/take-card'
import { takeJson } from './fixtures'

/** 持ち込んだ Take はモデル名の代わりに出自を出す（ADR-0026）。 */

vi.mock('@/lib/api-client', () => ({
  createApiClient: () => ({ mediaUrl: () => new Promise(() => undefined) }),
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
