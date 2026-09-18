import {
  MAX_CORRECTION_LENGTH,
  MAX_CORRECTIONS,
  ShotId,
  type ReviewFinding,
  type ReviewFindingId,
} from '@ixa/domain'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  RegenerateForm,
  checkCorrections,
  joinDeltas,
  parseCorrections,
  previewAppendedText,
  type RegenerateApi,
} from '@/components/regenerate-form'
import { ReviewFindingList, isCorrectable, selectedDeltas } from '@/components/review-finding-list'

/**
 * 指摘を直して作り直す（PHASE 6.1）。
 *
 * この画面の仕事は 2 つ。**送る前に何が足されるかを見せる**ことと、
 * **人がそれを直せる**ことである。黙って送ると、出来上がった動画を見るまで
 * 何を指示したのか誰も確かめられない。
 */

const shotId = ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV')

const finding = (
  id: string,
  suggestedPromptDelta: string | null,
  overrides: Partial<ReviewFinding> = {},
): ReviewFinding => ({
  id: id as ReviewFindingId,
  reviewRunId: '01ARZ3NDEKTSV4RRFFQ69G5FB0' as ReviewFinding['reviewRunId'],
  reviewer: 'identity',
  severity: 'warn',
  score: null,
  message: `指摘 ${id}`,
  evidence: null,
  suggestedPromptDelta,
  ...overrides,
})

const A = finding('01ARZ3NDEKTSV4RRFFQ69G5FB1', '顔をもっと近く')
const B = finding('01ARZ3NDEKTSV4RRFFQ69G5FB2', '光を強く')
const NO_DELTA = finding('01ARZ3NDEKTSV4RRFFQ69G5FB3', null)

describe('parseCorrections', () => {
  it('1 行 1 件として読み、空行と前後の空白を落とす', () => {
    expect(parseCorrections('  顔をもっと近く \n\n 光を強く  \n')).toEqual([
      '顔をもっと近く',
      '光を強く',
    ])
  })

  it('句点では切らない（指摘の文が割れないこと）', () => {
    expect(parseCorrections('顔をもっと近く。光を強く。')).toEqual(['顔をもっと近く。光を強く。'])
  })

  it('空文字は 0 件', () => {
    expect(parseCorrections('')).toEqual([])
    expect(parseCorrections('   \n  ')).toEqual([])
  })
})

describe('checkCorrections', () => {
  it('0 件は送れない', () => {
    const check = checkCorrections([])
    expect(check.ok).toBe(false)
  })

  it('上限ちょうどは送れる', () => {
    const list = Array.from({ length: MAX_CORRECTIONS }, (_, i) => `直し${String(i)}`)
    expect(checkCorrections(list).ok).toBe(true)
  })

  it('件数を超えたら理由に件数が出る', () => {
    const list = Array.from({ length: MAX_CORRECTIONS + 1 }, (_, i) => `直し${String(i)}`)
    const check = checkCorrections(list)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toContain(String(MAX_CORRECTIONS))
  })

  it('1 行が長すぎたら理由に字数が出る', () => {
    const check = checkCorrections(['あ'.repeat(MAX_CORRECTION_LENGTH + 1)])
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toContain(String(MAX_CORRECTION_LENGTH))
  })
})

describe('previewAppendedText', () => {
  it('compileSpec と同じ繋ぎ方で見せる', () => {
    expect(previewAppendedText(['顔をもっと近く', '光を強く'])).toBe('顔をもっと近く. 光を強く')
  })
})

describe('joinDeltas / selectedDeltas', () => {
  it('選んだ指摘の差分だけを取り出す', () => {
    expect(selectedDeltas([A, B, NO_DELTA], [A.id, NO_DELTA.id])).toEqual(['顔をもっと近く'])
  })

  it('差分を持たない指摘は直しにできない', () => {
    expect(isCorrectable(A)).toBe(true)
    expect(isCorrectable(NO_DELTA)).toBe(false)
  })

  it('入力欄の初期値は 1 行 1 件', () => {
    expect(joinDeltas(['顔をもっと近く', '光を強く'])).toBe('顔をもっと近く\n光を強く')
  })
})

const apiDouble = (): { api: RegenerateApi; generateTakes: ReturnType<typeof vi.fn> } => {
  const generateTakes = vi.fn(() =>
    Promise.resolve({
      jobIds: [],
      specHash: 'a'.repeat(64),
      resolvedModel: 'test/cheap',
      duplicateOfTakeId: null,
    }),
  )
  return { api: { generateTakes } as unknown as RegenerateApi, generateTakes }
}

const setup = (initialDeltas: readonly string[] = ['顔をもっと近く']) => {
  const { api, generateTakes } = apiDouble()
  const onCancel = vi.fn()
  const onQueued = vi.fn()
  render(
    <RegenerateForm
      shotId={shotId}
      initialDeltas={initialDeltas}
      api={api}
      onCancel={onCancel}
      onQueued={onQueued}
    />,
  )
  return { generateTakes, onCancel, onQueued, user: userEvent.setup() }
}

describe('RegenerateForm', () => {
  it('選んだ差分が編集できる入力欄に入っている', () => {
    setup(['顔をもっと近く', '光を強く'])
    expect(screen.getByRole('textbox')).toHaveValue('顔をもっと近く\n光を強く')
  })

  it('送る前に、足される文をそのまま見せる', () => {
    setup(['顔をもっと近く', '光を強く'])
    const preview = screen.getByRole('group', { name: '送る内容' })
    expect(within(preview).getByText('顔をもっと近く. 光を強く')).toBeInTheDocument()
  })

  it('入力を直すと、送る内容の表示も追随する', async () => {
    const { user } = setup([])
    await user.type(screen.getByRole('textbox'), '手前の旗を消す')
    const preview = screen.getByRole('group', { name: '送る内容' })
    expect(within(preview).getByText('手前の旗を消す')).toBeInTheDocument()
  })

  it('直した内容を送る（初期値ではなく画面の値）', async () => {
    const { generateTakes, user } = setup(['顔をもっと近く'])

    const textarea = screen.getByRole('textbox')
    await user.clear(textarea)
    await user.type(textarea, '手前の旗を消す')
    await user.click(screen.getByRole('button', { name: '直して作り直す' }))

    expect(generateTakes).toHaveBeenCalledWith(shotId, {
      model: 'AUTO',
      count: 1,
      corrections: ['手前の旗を消す'],
    })
  })

  it('空のままでは送れない', () => {
    setup([])
    expect(screen.getByRole('button', { name: '直して作り直す' })).toBeDisabled()
  })

  it('上限を超えた入力は送れず、理由を出す', async () => {
    const { user } = setup([])
    const lines = Array.from({ length: MAX_CORRECTIONS + 1 }, (_, i) => `直し${String(i)}`)
    await user.type(screen.getByRole('textbox'), lines.join('\n'))

    expect(screen.getByRole('button', { name: '直して作り直す' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(String(MAX_CORRECTIONS))
  })

  it('投入できたら、投入結果をそのまま親へ渡す', async () => {
    const { onQueued, user } = setup(['顔をもっと近く'])
    await user.click(screen.getByRole('button', { name: '直して作り直す' }))

    // jobIds が無いと親は新しいジョブを追いかけられない。握り潰さず渡すこと。
    expect(onQueued).toHaveBeenCalledWith(
      expect.objectContaining({ specHash: 'a'.repeat(64), duplicateOfTakeId: null }),
    )
  })

  it('失敗を黙って捨てず、理由を画面に出す', async () => {
    const generateTakes = vi.fn(() => Promise.reject(new Error('モデルが選べません')))
    render(
      <RegenerateForm
        shotId={shotId}
        initialDeltas={['顔をもっと近く']}
        api={{ generateTakes }}
        onCancel={vi.fn()}
      />,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '直して作り直す' }))

    expect(screen.getByRole('alert')).toHaveTextContent('モデルが選べません')
  })
})

describe('ReviewFindingList の選択欄', () => {
  it('選択を渡さなければ今までどおり読むだけ', () => {
    render(<ReviewFindingList findings={[A, B]} />)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('差分を持つ指摘にだけ選択欄を出す', () => {
    render(
      <ReviewFindingList
        findings={[A, B, NO_DELTA]}
        selection={{ selectedIds: [], onToggle: vi.fn() }}
      />,
    )
    // 3 件のうち差分を持つのは 2 件。
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('押すと、その指摘の id を返す', async () => {
    const onToggle = vi.fn()
    render(<ReviewFindingList findings={[A]} selection={{ selectedIds: [], onToggle }} />)

    await userEvent.setup().click(screen.getByRole('checkbox'))

    expect(onToggle).toHaveBeenCalledWith(A.id)
  })

  it('選ばれている指摘のチェックが入っている', () => {
    render(
      <ReviewFindingList
        findings={[A, B]}
        selection={{ selectedIds: [B.id], onToggle: vi.fn() }}
      />,
    )
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.filter((box) => (box as HTMLInputElement).checked)).toHaveLength(1)
  })
})
