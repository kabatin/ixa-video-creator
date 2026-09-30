import type { AiSettings } from '@ixa/domain'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AiSetupDialogBody } from '@/components/workbench/dialogs/ai-setup-dialog'
import { ApiError } from '@/lib/api-error'
import type { AiSettingsApi, WireAiTool } from '@/lib/ai-settings-api'
import { renderInWorkbench } from './workbench-fixture'

/**
 * 使う AI を選ぶ（ADR-0032）。この Mac で見つかった AI から、用途ごとに 1 つ選ぶ。
 * 選べないものは理由を見せ、選ばせない。
 */

const TOOLS: readonly WireAiTool[] = [
  {
    id: 'stub',
    label: 'お試し',
    status: { state: 'ready', version: null },
    problems: { text: null, image: null, video: null },
  },
  {
    id: 'claude_cli',
    label: 'Claude Code',
    status: { state: 'ready', version: '2.1.283' },
    problems: { text: null, image: '画像にはまだ使えません', video: '動画にはまだ使えません' },
  },
  {
    id: 'codex_cli',
    label: 'Codex',
    status: { state: 'ready', version: '0.154.0' },
    problems: { text: 'テキストにはまだ使えません', image: null, video: '動画にはまだ使えません' },
  },
  {
    id: 'local',
    label: '静止画を動かす（無料）',
    status: { state: 'ready', version: null },
    problems: { text: 'x', image: 'x', video: null },
  },
  {
    id: 'vpipe',
    label: '手元の MiniMax H3',
    status: { state: 'missing', reason: '起動していません' },
    problems: { text: 'x', image: 'x', video: '手元の MiniMax H3 を使えません: 起動していません' },
  },
]

const RECOMMENDED: AiSettings = { text: 'claude_cli', image: 'codex_cli', video: 'local' }
const CURRENT: AiSettings = { text: 'stub', image: 'stub', video: 'stub' }

const fakeApi = (overrides: Partial<AiSettingsApi> = {}): AiSettingsApi => ({
  listAiTools: vi.fn(() => Promise.resolve({ tools: [...TOOLS], recommended: RECOMMENDED })),
  getAiSettings: vi.fn(() => Promise.resolve({ settings: CURRENT, source: 'default' as const })),
  saveAiSettings: vi.fn((settings: AiSettings) =>
    Promise.resolve({ settings, source: 'saved' as const }),
  ),
  ...overrides,
})

const open = async (api: AiSettingsApi = fakeApi()) => {
  const rendered = renderInWorkbench(<AiSetupDialogBody api={api} />)
  await screen.findByRole('radiogroup', { name: /テキスト/ })
  return { api, ...rendered }
}

describe('AiSetupDialogBody', () => {
  it('探している間はそう言う（CLI を叩くので数秒かかる）', () => {
    renderInWorkbench(
      <AiSetupDialogBody api={fakeApi({ listAiTools: () => new Promise(() => undefined) })} />,
    )

    expect(screen.getByText(/この Mac の AI を探しています/)).toBeTruthy()
  })

  it('まだ選んでいなければ、勧める組み合わせを選んだ状態で出す（版も見せる）', async () => {
    await open()

    const text = screen.getByRole('radiogroup', { name: /テキスト/ })
    expect(within(text).getByRole('radio', { name: /Claude Code 2\.1\.283/ })).toBeChecked()
    expect(
      within(screen.getByRole('radiogroup', { name: /画像/ })).getByRole('radio', {
        name: /Codex/,
      }),
    ).toBeChecked()
    expect(
      within(screen.getByRole('radiogroup', { name: /動画/ })).getByRole('radio', {
        name: /静止画を動かす/,
      }),
    ).toBeChecked()
  })

  it('使えないものは選ばせず、理由を見せる', async () => {
    await open()

    const video = screen.getByRole('radiogroup', { name: /動画/ })
    expect(within(video).getByRole('radio', { name: /手元の MiniMax H3/ })).toBeDisabled()
    expect(within(video).getByText(/起動していません/)).toBeTruthy()
  })

  it('入っているがその用途に使えない AI は、1 行で名前を言う', async () => {
    await open()

    const video = screen.getByRole('radiogroup', { name: /動画/ })
    expect(within(video).getByText(/Claude Code・Codex は動画には使えません/)).toBeTruthy()
  })

  it('選び直して保存すると、その組み合わせで保存して閉じる', async () => {
    const { api, value } = await open()

    await userEvent.click(
      within(screen.getByRole('radiogroup', { name: /画像/ })).getByRole('radio', {
        name: /お試し/,
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'この設定で使う' }))

    await waitFor(() => {
      expect(api.saveAiSettings).toHaveBeenCalledWith({
        text: 'claude_cli',
        image: 'stub',
        video: 'local',
      })
      expect(value.closeDialog).toHaveBeenCalled()
    })
  })

  it('保存できなければ、用途ごとの理由を出して閉じない', async () => {
    const saveAiSettings = vi.fn(() =>
      Promise.reject(
        new ApiError(
          '入力の検証に失敗しました',
          422,
          JSON.stringify({
            success: false,
            error: '入力の検証に失敗しました',
            fields: { video: ['静止画を動かす（無料） を使えません: 壊れています'] },
          }),
        ),
      ),
    )
    const { value } = await open(fakeApi({ saveAiSettings }))

    await userEvent.click(screen.getByRole('button', { name: 'この設定で使う' }))

    const alert = await within(screen.getByRole('radiogroup', { name: /動画/ })).findByRole('alert')
    expect(alert.textContent).toContain('壊れています')
    // 中の名前（video）を画面に出さない。
    expect(document.body.textContent).not.toContain('video')
    expect(value.closeDialog).not.toHaveBeenCalled()
  })

  it('「あとで」は保存せずに閉じる', async () => {
    const { api, value } = await open()

    await userEvent.click(screen.getByRole('button', { name: 'あとで' }))

    expect(api.saveAiSettings).not.toHaveBeenCalled()
    expect(value.closeDialog).toHaveBeenCalled()
  })
})
