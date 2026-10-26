import { Character, CharacterId, ProjectId, WorkspaceId, newId, type DialogueLine, type Shot } from '@ixa/domain'
import { useState } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShotDialogueSection } from '@/components/workbench/inspector/shot-dialogue-section'
import { PROJECT_ID } from './fixtures'
import { aWorkbenchShot, assetStoreValue, renderInWorkbench } from './workbench-fixture'

/**
 * Shot のセリフの欄（ADR-0059）。行を足してセリフを書くと保存する。話し手は配役の人が先。
 * 呼び名や声の説明が無い話し手と、長すぎるセリフは、作る前にここで知らせる。
 */

const api = vi.hoisted(() => ({ listShotCast: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ createApiClient: () => api }))

const person = (name: string, speakerNo: number, voiced: boolean) =>
  Character.parse({
    id: newId(CharacterId),
    workspaceId: newId(WorkspaceId),
    projectId: ProjectId.parse(PROJECT_ID),
    name,
    displayName: name,
    speakerNo,
    ...(voiced ? { speechName: 'The cat', voiceDescription: 'a soft voice' } : {}),
    createdAt: new Date('2026-10-26T00:00:00.000Z'),
  })

const cat = person('ネコ', 1, true)
const mouse = person('ネズミ', 2, false)

const render = (shot = aWorkbenchShot(1), onSave = vi.fn(() => Promise.resolve())) => {
  renderInWorkbench(
    <ShotDialogueSection shot={shot} version={0} disabled={false} onSave={onSave} />,
    {},
    assetStoreValue({ characters: { state: 'ready', value: [cat, mouse] } }),
  )
  return onSave
}

beforeEach(() => {
  api.listShotCast.mockReset().mockResolvedValue([{ characterId: mouse.id }])
})

describe('ShotDialogueSection', () => {
  it('行を足してセリフを書くと、欄を離れたときに保存する。話し手は配役の人が先', async () => {
    const onSave = render()
    await userEvent.click(screen.getByRole('button', { name: '＋ セリフを足す' }))
    const speaker = await screen.findByRole('combobox', { name: '1 行目の話し手' })
    await waitFor(() => {
      expect((speaker as HTMLSelectElement).value).toBe(mouse.id)
    })
    await userEvent.selectOptions(speaker, cat.id)
    // セリフが空のうちは保存しない（domain が空のセリフを拒む）
    expect(onSave).not.toHaveBeenCalled()
    await userEvent.type(screen.getByRole('textbox', { name: '1 行目のセリフ' }), 'ねえ、ネズミくん。')
    await userEvent.tab()

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        dialogue: [{ speakerId: cat.id, text: 'ねえ、ネズミくん。', offscreen: false, translation: null }],
      })
    })
  })

  it('訳文（英語の字幕）を書くと、欄を離れたときに行の訳文として保存する。空にすると訳文なし', async () => {
    const saved: DialogueLine = { speakerId: cat.id, text: 'ねえ', offscreen: false, translation: null }
    const onSave = render(aWorkbenchShot(1, { dialogue: [saved] }))
    const field = screen.getByRole('textbox', { name: '1 行目の訳文' })
    await userEvent.type(field, '  Hey.  ')
    await userEvent.tab()
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ dialogue: [{ ...saved, translation: 'Hey.' }] })
    })
  })

  /**
   * 1 行を詰める（制作者 2026-10-26「インスペクターが縦長」）。話し手・画面外・並べ替え・消すを 1 列に並べ、
   * その下にセリフと訳文（1 行から伸びる）。
   */
  it('話し手・画面外・並べ替え・消すを 1 列に並べ、画面外を押すと保存する', async () => {
    const saved: DialogueLine = { speakerId: cat.id, text: 'ねえ', offscreen: false, translation: null }
    const onSave = render(aWorkbenchShot(1, { dialogue: [saved] }))
    const speaker = screen.getByRole('combobox', { name: '1 行目の話し手' })
    const offscreen = screen.getByRole('checkbox', { name: '画面外の声（映っている人の口は閉じたまま）' })
    const row = speaker.parentElement as HTMLElement
    expect(row.contains(offscreen)).toBe(true)
    expect(row.contains(screen.getByRole('button', { name: '1 行目を消す' }))).toBe(true)
    expect(screen.getByRole('textbox', { name: '1 行目の訳文' })).toHaveAttribute('placeholder', '英語の字幕（任意）')
    expect(screen.getByRole('textbox', { name: '1 行目のセリフ' })).toHaveAttribute('rows', '1')

    await userEvent.click(offscreen)
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ dialogue: [{ ...saved, offscreen: true }] })
    })
  })

  it('呼び名と声の説明が無い話し手を知らせる', () => {
    render(aWorkbenchShot(1, { dialogue: [{ speakerId: mouse.id, text: 'なに？', offscreen: false, translation: null }] }))
    expect(screen.getByText('セリフの話し手「ネズミ」に英語の呼び名がありません')).toBeTruthy()
    expect(screen.getByText('セリフの話し手「ネズミ」に声の説明（英語）がありません')).toBeTruthy()
  })

  it('5 行以上は長すぎると警告する', () => {
    const lines = Array.from({ length: 5 }, () => ({ speakerId: cat.id, text: 'あ', offscreen: false, translation: null }))
    render(aWorkbenchShot(1, { dialogue: lines }))
    expect(screen.getByText('長すぎます（10 秒に 3〜4 行まで）')).toBeTruthy()
  })

  /**
   * 打っている途中に、ほかの欄の保存などで Shot が読み直されても（中身が同じ・参照だけ新しい）、下書きを消さない。
   * サーバの値そのものが変わったとき（MCP・取り消し）だけ写す。
   */
  it('サーバの値が変わっていなければ、読み直しで書きかけを消さない。変わったら写す', async () => {
    const saved: DialogueLine = { speakerId: cat.id, text: 'ねえ', offscreen: false, translation: null }
    const Harness = () => {
      const [shot, setShot] = useState<Shot>(aWorkbenchShot(1, { dialogue: [saved] }))
      return (
        <>
          <button type="button" onClick={() => { setShot({ ...shot, dialogue: [{ ...saved }] }) }}>同じ中身で読み直す</button>
          <button type="button" onClick={() => { setShot({ ...shot, dialogue: [{ ...saved, text: 'ほかで直した' }] }) }}>ほかで直す</button>
          <ShotDialogueSection shot={shot} version={0} disabled={false} onSave={() => Promise.resolve()} />
        </>
      )
    }
    renderInWorkbench(<Harness />, {}, assetStoreValue({ characters: { state: 'ready', value: [cat, mouse] } }))
    const text = screen.getByRole('textbox', { name: '1 行目のセリフ' })
    await userEvent.type(text, '、ネズミくん')

    await userEvent.click(screen.getByRole('button', { name: '同じ中身で読み直す' }))
    expect(screen.getByRole('textbox', { name: '1 行目のセリフ' })).toHaveProperty('value', 'ねえ、ネズミくん')

    await userEvent.click(screen.getByRole('button', { name: 'ほかで直す' }))
    expect(screen.getByRole('textbox', { name: '1 行目のセリフ' })).toHaveProperty('value', 'ほかで直した')
  })

  it('消したキャラクターが話し手の行は、ほかの人を選んだように見せず「見つからない話し手」と出す', async () => {
    const gone = newId(CharacterId)
    render(aWorkbenchShot(1, { dialogue: [{ speakerId: gone, text: 'だれ？', offscreen: false, translation: null }] }))
    const speaker = await screen.findByRole('combobox', { name: '1 行目の話し手' })
    expect(speaker).toHaveProperty('value', gone)
    expect(screen.getByRole('option', { name: '見つからない話し手（選び直してください）' })).toBeTruthy()
  })
})

/** セリフの行の「差し替えの指定」（ADR-0062）。欄を離れたときに行の dub として保存する。規則に合わない値は送らない。 */
describe('ShotDialogueSection の差し替えの指定', () => {
  const saved: DialogueLine = { speakerId: cat.id, text: 'ねえ', offscreen: false, translation: null }

  it('距離を入れると、行の dub として保存する', async () => {
    const onSave = render(aWorkbenchShot(1, { dialogue: [saved] }))
    await userEvent.click(screen.getByText('差し替えの指定'))
    await userEvent.type(screen.getByRole('textbox', { name: '1 行目の距離（dB）' }), '-9.5')
    await userEvent.tab()
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ dialogue: [{ ...saved, dub: { levelDb: -9.5 } }] })
    })
  })

  it('範囲の外の距離・収める長さと切る長さの両方は保存せず、理由を出す', async () => {
    const onSave = render(aWorkbenchShot(1, { dialogue: [{ ...saved, dub: { fitSec: 1.2 } }] }))
    await userEvent.click(screen.getByText('差し替えの指定（あり）'))
    await userEvent.type(screen.getByRole('textbox', { name: '1 行目の距離（dB）' }), '13')
    await userEvent.tab()
    expect((await screen.findByRole('alert')).textContent).toBe('距離は -40〜12 dB で入れてください')
    await userEvent.type(screen.getByRole('textbox', { name: '1 行目の切る長さ' }), '0.8')
    await userEvent.tab()
    expect((await screen.findByRole('alert')).textContent).toBe('収める長さと切る長さは、どちらか 1 つだけにしてください')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('足す行は、置く時刻と音量を合わせる行を入れて保存する', async () => {
    const other: DialogueLine = { speakerId: mouse.id, text: 'ふふ', offscreen: true, translation: null }
    const onSave = render(aWorkbenchShot(1, { dialogue: [saved, { ...other, dub: { added: true, placeAtSec: 2 } }] }))
    await userEvent.click(screen.getByText('差し替えの指定（あり）'))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '2 行目の音量を合わせる行' }), '0')
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ dialogue: [saved, { ...other, dub: { added: true, placeAtSec: 2, levelLikeIndex: 0 } }] })
    })
  })

  it('前の差し替えが止まったときの行の区間の案を出し、「案を入れる」で保存する', async () => {
    const second: DialogueLine = { speakerId: mouse.id, text: 'なに？', offscreen: false, translation: null }
    const onSave = vi.fn(() => Promise.resolve())
    renderInWorkbench(
      <ShotDialogueSection
        shot={aWorkbenchShot(1, { dialogue: [saved, second] })}
        version={0}
        disabled={false}
        suggestedSpans={[
          { lineIndex: 0, startSec: 0.2, endSec: 0.65 },
          { lineIndex: 1, startSec: 0.65, endSec: 2 },
        ]}
        onSave={onSave}
      />,
      {},
      assetStoreValue({ characters: { state: 'ready', value: [cat, mouse] } }),
    )
    expect(screen.getByText('行の区間の案: 0:00.20〜0:00.65')).toBeTruthy()
    await userEvent.click(screen.getAllByRole('button', { name: '案を入れる' })[0] as HTMLElement)
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ dialogue: [{ ...saved, dub: { startSec: 0.2, endSec: 0.65 } }, second] })
    })
  })
})
