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
    problems: { text: null, image: null, video: null, voice: null, transcribe: null, music: null, sfx: null },
    notice: null,
  },
  {
    id: 'claude_cli',
    label: 'Claude Code',
    status: { state: 'ready', version: '2.1.283' },
    problems: { text: null, image: '画像にはまだ使えません', video: '動画にはまだ使えません', voice: 'x', transcribe: 'x', music: 'x', sfx: 'x' },
    notice: null,
  },
  {
    id: 'codex_cli',
    label: 'Codex',
    status: { state: 'ready', version: '0.154.0' },
    problems: { text: 'テキストにはまだ使えません', image: null, video: '動画にはまだ使えません', voice: 'x', transcribe: 'x', music: 'x', sfx: 'x' },
    notice: null,
  },
  {
    id: 'local',
    label: '静止画を動かす（無料）',
    status: { state: 'ready', version: null },
    problems: { text: 'x', image: 'x', video: null, voice: 'x', transcribe: 'x', music: 'x', sfx: 'x' },
    notice: null,
  },
  {
    id: 'vpipe',
    label: 'MiniMax H3',
    status: { state: 'missing', reason: '起動していません' },
    problems: { text: 'x', image: 'x', video: 'MiniMax H3 を使えません: 起動していません', voice: 'x', transcribe: 'x', music: 'x', sfx: 'x' },
    notice: null,
  },
  {
    id: 'stable_audio_sfx',
    label: 'Stable Audio 3',
    status: { state: 'missing', reason: '起動していません（sfx-api を起動してください）' },
    problems: { text: 'x', image: 'x', video: 'x', voice: 'x', transcribe: 'x', music: 'x', sfx: 'Stable Audio 3 を使えません: 起動していません' },
    notice: null,
  },
  {
    id: 'gemini_api',
    label: 'Gemini（Google の API・無料枠あり）',
    status: { state: 'ready', version: null },
    problems: { text: 'x', image: 'x', video: 'x', voice: null, transcribe: null, music: null, sfx: null },
    notice: '原稿は Google に送られます。無料枠では送った内容が製品の改善に使われます。',
  },
]

const RECOMMENDED: AiSettings = { text: 'claude_cli', image: 'codex_cli', video: 'local', voice: 'stub', transcribe: 'stub', music: 'stub', sfx: 'stub', checks: { image: false, video: false } }
const CURRENT: AiSettings = { text: 'stub', image: 'stub', video: 'stub', voice: 'stub', transcribe: 'stub', music: 'stub', sfx: 'stub', checks: { image: false, video: false } }

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

/** 用途のタブを開いて、その選択肢の群を返す。 */
const panel = async (name: RegExp) => {
  await userEvent.click(screen.getByRole('tab', { name }))
  return screen.getByRole('radiogroup', { name })
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
    expect(within(text).getByRole('radio', { name: /Claude Code\s*2\.1\.283/ })).toBeChecked()
    expect(within(await panel(/画像/)).getByRole('radio', { name: /Codex/ })).toBeChecked()
    expect(within(await panel(/動画/)).getByRole('radio', { name: /静止画を動かす/ })).toBeChecked()
  })

  /** 用途が増えても縦に伸びないよう、タブで分ける。タブには今選んでいる AI を出す。 */
  it('用途はタブで分け、タブに選んでいる AI を出す', async () => {
    await open()

    expect(screen.getAllByRole('radiogroup')).toHaveLength(1)
    expect(screen.getByRole('tab', { name: /画像/ }).textContent).toContain('Codex')
  })

  /** ADR-0052。効果音のタブには効果音の AI とお試しだけが並ぶ。 */
  it('効果音のタブに効果音の AI を出し、起動していなければ理由を見せる', async () => {
    await open()

    const sfx = await panel(/効果音/)
    expect(within(sfx).getByRole('radio', { name: /お試し/ })).toBeChecked()
    expect(within(sfx).getByRole('radio', { name: /Stable Audio 3/ })).toBeDisabled()
    expect(within(sfx).getByText(/sfx-api を起動してください/)).toBeTruthy()
    expect(within(sfx).queryByRole('radio', { name: /Claude/ })).toBeNull()
  })

  it('使えないものは選ばせず、理由を見せる', async () => {
    await open()

    const video = await panel(/動画/)
    expect(within(video).getByRole('radio', { name: /MiniMax H3/ })).toBeDisabled()
    expect(within(video).getByText(/起動していません/)).toBeTruthy()
  })

  it('選び直して保存すると、その組み合わせで保存して閉じる', async () => {
    const { api, value } = await open()

    await userEvent.click(within(await panel(/画像/)).getByRole('radio', { name: /お試し/ }))
    await userEvent.click(screen.getByRole('button', { name: 'この設定で使う' }))

    await waitFor(() => {
      expect(api.saveAiSettings).toHaveBeenCalledWith({
        text: 'claude_cli',
        image: 'stub',
        video: 'local',
        voice: 'stub',
        transcribe: 'stub',
        music: 'stub',
        sfx: 'stub',
        checks: { image: false, video: false },
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

    // 理由のある用途のタブを開いて見せる。
    const alert = await within(await screen.findByRole('radiogroup', { name: /動画/ })).findByRole('alert')
    expect(screen.getByRole('tab', { name: /動画/ })).toHaveAttribute('aria-selected', 'true')
    expect(alert.textContent).toContain('壊れています')
    // 中の名前（video）を画面に出さない。
    expect(document.body.textContent).not.toContain('video')
    expect(value.closeDialog).not.toHaveBeenCalled()
  })

  /** ADR-0066（制作者 2026-10-28「トークン消費激しすぎるから、切り替え可能にしてデフォルトは OFF」）。 */
  it('Claude のチェックは、初めはどちらも切った状態で出す', async () => {
    await open()

    expect(screen.getByRole('switch', { name: /描いた絵をチェックする/ })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: /Take をチェックする/ })).not.toBeChecked()
    // 入れると Claude の利用枠を使うことを、切り替えの横で言う。
    expect(screen.getByRole('switch', { name: /描いた絵/ })).toHaveAccessibleDescription(/1 枚描くごとに Claude の利用枠/)
    expect(screen.getByRole('switch', { name: /Take/ })).toHaveAccessibleDescription(/Take 1 本ごとに Claude の利用枠/)
  })

  it('絵と Take のチェックを別々に入れて保存する', async () => {
    const { api } = await open()

    await userEvent.click(screen.getByRole('switch', { name: /描いた絵をチェックする/ }))
    await userEvent.click(screen.getByRole('button', { name: 'この設定で使う' }))

    await waitFor(() => {
      expect(api.saveAiSettings).toHaveBeenCalledWith(expect.objectContaining({ checks: { image: true, video: false } }))
    })
  })

  it('保存してあるチェックの入り切りをそのまま出す', async () => {
    await open(
      fakeApi({
        getAiSettings: vi.fn(() =>
          Promise.resolve({ settings: { ...RECOMMENDED, checks: { image: false, video: true } }, source: 'saved' as const }),
        ),
      }),
    )

    expect(screen.getByRole('switch', { name: /描いた絵をチェックする/ })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: /Take をチェックする/ })).toBeChecked()
  })

  it('テキストの AI が Claude でなければ、入れても働かないと言う', async () => {
    await open()
    expect(screen.queryByText(/いまは入れても働きません/)).toBeNull()

    await userEvent.click(within(await panel(/テキスト/)).getByRole('radio', { name: /お試し/ }))

    expect(screen.getByText(/いまは入れても働きません/)).toBeInTheDocument()
  })

  it('「あとで」は保存せずに閉じる', async () => {
    const { api, value } = await open()

    await userEvent.click(screen.getByRole('button', { name: 'あとで' }))

    expect(api.saveAiSettings).not.toHaveBeenCalled()
    expect(value.closeDialog).toHaveBeenCalled()
  })

  /** 声と文字起こし（ADR-0038）。原稿が外に出る・お金が掛かる AI は、選ぶ前に知っておくことを見せる。 */
  it('声と文字起こしも選べ、使う前に知っておくことを AI の下に出す', async () => {
    const { api, value } = await open()

    expect(await panel(/文字起こし/)).toBeInTheDocument()
    const voice = await panel(/^声/)
    expect(within(voice).getByText(/製品の改善に使われます/)).toBeInTheDocument()

    await userEvent.click(within(voice).getByRole('radio', { name: /Gemini/ }))
    await userEvent.click(screen.getByRole('button', { name: 'この設定で使う' }))

    await waitFor(() => {
      expect(api.saveAiSettings).toHaveBeenCalledWith(expect.objectContaining({ voice: 'gemini_api' }))
      expect(value.closeDialog).toHaveBeenCalled()
    })
  })
})
