import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ShotWorkbench } from '@/components/shot-workbench'
import { WireShot } from '@/lib/api-schemas'
import { shotJson } from '@/__tests__/fixtures'

/**
 * 「絵が先、欄が後」は殻（`ShotDetailLayout`）だけでは守れない。
 * **どの要素をどちらの列へ渡したか**が本体なので、`ShotWorkbench` を実際に描いて確かめる。
 *
 * 状態は持ち出さない。ネットワークに触る口（API クライアント・SSE）と
 * `useRouter` だけを差し替え、Take の無い draft の Shot を描く。
 * この条件ならポーリングもレビューも動かないので、見ているのは並べ方だけになる。
 */

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock('@/lib/use-project-events', () => ({
  useProjectEvents: () => ({ state: 'live', lastEventAt: null, attempt: 0, invalidCount: 0 }),
}))

vi.mock('@/lib/api-client', () => ({
  createApiClient: () => {
    throw new Error('描画だけのテストで API を呼んではいけない')
  },
  resolveApiBaseUrl: () => 'http://api.test',
}))

const shot = WireShot.parse(shotJson)

const setup = () => render(<ShotWorkbench shot={shot} initialTakes={[]} locations={[]} />)

const railOf = (container: HTMLElement): HTMLElement => {
  const rail = container.querySelector('aside')
  if (rail === null) throw new Error('右の欄（aside）が無い')
  return rail
}

describe('ShotWorkbench の並べ方', () => {
  it('判定するもの（Take 比較）が左に来る', () => {
    const { container } = setup()
    const heading = screen.getByRole('heading', { name: 'Take 比較' })

    expect(railOf(container).contains(heading)).toBe(false)
    expect(heading.closest('.flex-1')).not.toBeNull()
  })

  it('操作する欄（サマリ・ロケーション・生成）が右に入る', () => {
    const { container } = setup()
    const rail = within(railOf(container))

    expect(rail.getByRole('heading', { name: shot.code })).toBeInTheDocument()
    expect(rail.getByRole('heading', { name: 'ロケーション' })).toBeInTheDocument()
    expect(rail.getByRole('heading', { name: '生成' })).toBeInTheDocument()
  })

  it('狭い画面でも絵が先に来る', () => {
    const { container } = setup()
    const heading = screen.getByRole('heading', { name: 'Take 比較' })

    // 1 列に畳まれたときの順序は DOM の順序がそのまま出る。
    const order = heading.compareDocumentPosition(railOf(container))
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
