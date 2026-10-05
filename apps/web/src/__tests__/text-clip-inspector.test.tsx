import { MediaAssetId, TextStyleId, TimelineClip, TimelineClipId, type MusicTrack } from '@ixa/domain'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TextClipInspector } from '@/components/workbench/inspector/text-clip-inspector'
import { AudioClipInspector } from '@/components/workbench/inspector/audio-clip-inspector'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { DEFAULT_PREFERENCES, PREFERENCES_STORAGE_KEY } from '@/lib/preferences'
import { PreferencesRoot } from '@/components/preferences-root'
import { InspectorPanel } from '@/components/workbench/panels/inspector-panel'
import { ContextMenuHost } from '@/components/workbench/ui/context-menu'
import { WorkbenchContext } from '@/components/workbench/workbench-context'
import { WorkbenchTransportProvider } from '@/components/workbench/workbench-transport-provider'
import { STOPPED, aProject, renderInWorkbench, workbenchValue } from './workbench-fixture'

/**
 * テロップのインスペクター（ADR-0028）。欄を変えると、その項目だけを重ねた params を送る。
 * 文字・どのスタイルからか・他の項目は残す。
 */

const CLIP_ID = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB0')
const OTHER_TEXT = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB1')
const MEDIA_CLIP = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB2')
const PRESET_ID = TextStyleId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB3')

const clip = (id: string, content: TimelineClip['content'], span = { startSec: 1, durationSec: 2 }) =>
  TimelineClip.parse({
    id,
    projectId: aProject.id,
    track: content.type === 'media' ? 'VIDEO2' : 'TEXT',
    ...span,
    layer: 0,
    content,
    opacity: 1,
    createdAt: new Date(),
  })

const fake = vi.hoisted(() => ({
  listClips: vi.fn(),
  updateClip: vi.fn(),
  deleteClip: vi.fn(),
  listTextStyles: vi.fn(),
  createTextStyle: vi.fn(),
  updateTextStyle: vi.fn(),
  deleteTextStyle: vi.fn(),
  applyTextStyle: vi.fn(),
}))
vi.mock('@/lib/api-client', () => ({ createApiClient: () => fake }))

const preset = {
  id: PRESET_ID,
  projectId: aProject.id,
  name: '歌詞',
  style: { color: '#FFD100', anchor: 'bottom-center' },
  createdAt: new Date(),
  updatedAt: new Date(),
}

beforeEach(() => {
  for (const fn of Object.values(fake)) fn.mockReset()
  fake.listClips.mockResolvedValue([
    clip(CLIP_ID, { type: 'text', templateKey: 'plain', params: { text: '一行目', style: { size: 0.05 }, styleId: null } }),
    clip(OTHER_TEXT, { type: 'text', templateKey: 'plain', params: { text: '二行目' } }, { startSec: 5, durationSec: 2 }),
    clip(MEDIA_CLIP, { type: 'media', mediaAssetId: MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB4'), inSec: 0, outSec: 2, volume: 1 }),
  ])
  fake.updateClip.mockImplementation(
    (id: string, patch: { content?: TimelineClip['content']; startSec?: number; durationSec?: number }) =>
      Promise.resolve(
        clip(id, patch.content ?? { type: 'text', templateKey: 'plain', params: { text: '一行目' } }, {
          startSec: patch.startSec ?? 1,
          durationSec: patch.durationSec ?? 2,
        }),
      ),
  )
  fake.deleteClip.mockResolvedValue(undefined)
  fake.listTextStyles.mockResolvedValue([preset])
  fake.applyTextStyle.mockResolvedValue([])
  fake.createTextStyle.mockImplementation((_project: string, body: { name: string; style: object }) =>
    Promise.resolve({ ...preset, id: TextStyleId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB5'), ...body }),
  )
})

const open = async () => {
  const { value } = renderInWorkbench(<TextClipInspector id={CLIP_ID} />)
  await screen.findByText('一行目')
  return value
}
const sentParams = () => (fake.updateClip.mock.calls.at(-1)?.[1] as { content: { params: unknown } }).content.params

describe('TextClipInspector', () => {
  it('ナレーションの行から作ったテロップなら、字と時刻は行で直すと言う（ここで直しても作り直される）', async () => {
    fake.listClips.mockResolvedValue([
      clip(CLIP_ID, { type: 'text', templateKey: 'plain', params: { text: '勝負の時が来た。', narrationLineId: '01ARZ3NDEKTSV4RRFFQ69G5FB6' } }),
    ])
    renderInWorkbench(<TextClipInspector id={CLIP_ID} />)

    expect(await screen.findByRole('note')).toHaveTextContent('ナレーションの行から作ったテロップです')
  })

  it('手で置いたテロップには、その知らせを出さない', async () => {
    await open()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('効果音（音のクリップ）はインスペクターで位置と音量を直せる', async () => {
    fake.listClips.mockResolvedValue([
      TimelineClip.parse({
        id: MEDIA_CLIP,
        projectId: aProject.id,
        track: 'SFX',
        startSec: 3,
        durationSec: 1.5,
        layer: 0,
        content: { type: 'media', mediaAssetId: MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB4'), inSec: 0, outSec: 1.5, volume: 1 },
        opacity: 1,
        createdAt: new Date(),
      }),
    ])
    renderInWorkbench(<AudioClipInspector id={MEDIA_CLIP} />)
    const volume = await screen.findByLabelText('音量')

    await userEvent.clear(volume)
    await userEvent.type(volume, '50%{Enter}')

    await waitFor(() => {
      expect(fake.updateClip.mock.calls.at(-1)).toMatchObject([MEDIA_CLIP, { content: { type: 'media', volume: 0.5 } }])
    })
  })

  it('書体を変えると、その項目だけを重ねて保存する（文字と他の見た目は残す）', async () => {
    await open()

    await userEvent.selectOptions(screen.getByLabelText('書体'), 'mincho')

    await waitFor(() => {
      expect(sentParams()).toEqual({ text: '一行目', style: { size: 0.05, font: 'mincho' }, styleId: null })
    })
  })

  it('定位置は 3×3 のボタンで選ぶ', async () => {
    await open()

    await userEvent.click(screen.getByRole('button', { name: '左上に置く' }))

    await waitFor(() => {
      expect(sentParams()).toMatchObject({ style: { anchor: 'top-left' } })
    })
  })

  it('大きさは画面の高さの %（空欄で自動に戻る）', async () => {
    await open()
    const size = screen.getByLabelText('大きさ（%）')
    expect((size as HTMLInputElement).value).toBe('5')

    await userEvent.clear(size)
    await userEvent.type(size, '8{Enter}')

    await waitFor(() => {
      expect(sentParams()).toMatchObject({ style: { size: 0.08 } })
    })
  })

  it('色はピッカーを閉じた（確定した）時点で保存する', async () => {
    await open()

    fireEvent.change(screen.getByLabelText('色'), { target: { value: '#ffd100' } })

    await waitFor(() => {
      expect(sentParams()).toMatchObject({ style: { color: '#FFD100' } })
    })
  })

  it('保存したスタイルをこのテロップに当てる', async () => {
    await open()

    await userEvent.click(await screen.findByRole('button', { name: 'このテロップに当てる' }))

    expect(fake.applyTextStyle).toHaveBeenCalledWith(aProject.id, {
      clipIds: [CLIP_ID],
      style: preset.style,
      styleId: PRESET_ID,
    })
  })

  it('TEXT 帯のすべてに当てるのは、確かめてから（テロップだけ・メディアは含めない）', async () => {
    await open()

    await userEvent.click(await screen.findByRole('button', { name: 'TEXT 帯のすべてに当てる' }))
    const dialog = screen.getByRole('alertdialog', { name: 'TEXT 帯のすべてに当てる' })
    expect(fake.applyTextStyle).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'すべてに当てる' }))

    expect(fake.applyTextStyle).toHaveBeenCalledWith(aProject.id, {
      clipIds: [CLIP_ID, OTHER_TEXT],
      style: preset.style,
      styleId: PRESET_ID,
    })
  })

  it('いまの見た目に名前を付けて保存し、このテロップをそのスタイルに紐づける', async () => {
    await open()

    await userEvent.type(screen.getByLabelText('新しい名前'), 'サビ')
    await userEvent.click(screen.getByRole('button', { name: 'いまの見た目を保存' }))

    await waitFor(() => {
      expect(fake.createTextStyle).toHaveBeenCalledWith(aProject.id, { name: 'サビ', style: { size: 0.05 } })
    })
    expect(fake.applyTextStyle).toHaveBeenCalledWith(aProject.id, {
      clipIds: [CLIP_ID],
      style: { size: 0.05 },
      styleId: '01ARZ3NDEKTSV4RRFFQ69G5FB5',
    })
  })

  it('文字を直しても見た目は残す', async () => {
    await open()
    const text = screen.getByLabelText('文字')

    await userEvent.clear(text)
    await userEvent.type(text, '直した{Enter}')

    await waitFor(() => {
      expect(sentParams()).toEqual({ text: '直した', style: { size: 0.05 }, styleId: null })
    })
  })
})

/**
 * 帯のテロップを押すと、小窓ではなくインスペクターで開く（2026-09-28、制作者の指摘「小窓は見切れて編集しづらい」）。
 * 小窓が受け持っていた開始・尺・削除も、ここで直せる。
 */
describe('TextClipInspector の時間と削除', () => {
  const retype = async (label: string, next: string) => {
    const field = screen.getByLabelText(label)
    await userEvent.clear(field)
    await userEvent.type(field, `${next}{Enter}`)
  }

  it('開始を直すと、開始だけを送る', async () => {
    await open()

    await retype('開始', '0:02.50')

    await waitFor(() => {
      expect(fake.updateClip).toHaveBeenCalledWith(CLIP_ID, { startSec: 2.5 })
    })
  })

  it('尺を直すと、尺だけを送る', async () => {
    await open()

    await retype('尺', '3.25s')

    await waitFor(() => {
      expect(fake.updateClip).toHaveBeenCalledWith(CLIP_ID, { durationSec: 3.25 })
    })
  })

  /** 制作者 2026-10-01「テロップ吸着繋ぎ」。引きずり・数値の一覧と同じ規則（拍・Shot の端・ほかのクリップの端）。 */
  describe('拍への吸着', () => {
    const withBeats = {
      track: { title: 'iXA CUP' } as unknown as MusicTrack,
      analysis: {
        beats: Array.from({ length: 21 }, (_unused, i) => i * 0.5),
        sections: [],
        drops: [],
      } as unknown as WireMusicAnalysis,
    }

    it('開始は近い拍へ寄せて送り、寄せたと言う', async () => {
      renderInWorkbench(<TextClipInspector id={CLIP_ID} />, withBeats)
      await screen.findByText('一行目')

      await retype('開始', '0:02.58')

      await waitFor(() => {
        expect(fake.updateClip).toHaveBeenCalledWith(CLIP_ID, { startSec: 2.5 })
      })
      expect(await screen.findByText(/ビートに吸着しました/)).toBeTruthy()
    })

    it('尺は開始を動かさず、終わりを近い拍へ寄せる', async () => {
      renderInWorkbench(<TextClipInspector id={CLIP_ID} />, withBeats)
      await screen.findByText('一行目')

      // 開始 1 + 尺 2.43 = 終わり 3.43 → 3.5 へ寄せて尺 2.5
      await retype('尺', '2.43s')

      await waitFor(() => {
        expect(fake.updateClip).toHaveBeenCalledWith(CLIP_ID, { durationSec: 2.5 })
      })
    })

    it('環境設定で吸着を切っていれば、入れた値のまま送る', async () => {
      localStorage.setItem(
        PREFERENCES_STORAGE_KEY,
        JSON.stringify({ ...DEFAULT_PREFERENCES, playback: { ...DEFAULT_PREFERENCES.playback, snapToBeat: false } }),
      )
      try {
        renderInWorkbench(<TextClipInspector id={CLIP_ID} />, withBeats)
        await screen.findByText('一行目')

        await retype('開始', '0:02.58')

        await waitFor(() => {
          expect(fake.updateClip).toHaveBeenCalledWith(CLIP_ID, { startSec: 2.58 })
        })
      } finally {
        localStorage.removeItem(PREFERENCES_STORAGE_KEY)
      }
    })
  })

  it('別のテロップと重なる開始は保存せず、理由を出す', async () => {
    await open()

    await retype('開始', '0:04.50')

    expect(await screen.findByText(/重なります/)).toBeTruthy()
    expect(fake.updateClip).not.toHaveBeenCalled()
  })

  it('削除は確かめてから。消したらインスペクターを閉じる', async () => {
    const value = await open()

    await userEvent.click(screen.getByRole('button', { name: 'テロップ「一行目」のその他の操作' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'テロップを削除' }))
    expect(fake.deleteClip).not.toHaveBeenCalled()
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'テロップを削除' }))

    await waitFor(() => {
      expect(fake.deleteClip).toHaveBeenCalledWith(CLIP_ID)
    })
    expect(value.inspect).toHaveBeenCalledWith(null)
  })
})

/**
 * テロップをまとめて変える（制作者 2026-10-02「テロップをまとめて、サイズやスタイルや位置を変えられるようにしたい」）。
 * 「変える範囲」を選ぶと、欄を 1 つ変えたとき**その項目だけ**が範囲の全部に当たる。変更の履歴から戻せる。
 */
describe('TextClipInspector の変える範囲', () => {
  const LYRIC_A = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC0')
  const LYRIC_B = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC1')
  const MANUAL = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC2')

  const lyricClips = () => [
    clip(LYRIC_A, { type: 'text', templateKey: 'plain', params: { text: 'ぼくは', style: { size: 0.05 }, lyricLine: 0 } }),
    clip(LYRIC_B, { type: 'text', templateKey: 'plain', params: { text: 'はると', lyricLine: 1 } }, { startSec: 4, durationSec: 2 }),
    clip(MANUAL, { type: 'text', templateKey: 'plain', params: { text: 'タイトル' } }, { startSec: 8, durationSec: 2 }),
  ]

  const openLyric = async () => {
    fake.listClips.mockResolvedValue(lyricClips())
    const { value } = renderInWorkbench(<TextClipInspector id={LYRIC_A} />)
    await screen.findByText('ぼくは')
    return value
  }

  it('このテロップだけ・歌詞のテロップすべて・テロップすべてを件数つきで出し、既定はこのテロップだけ', async () => {
    await openLyric()

    const scope = screen.getByRole('radiogroup', { name: '変える範囲' })
    expect(within(scope).getByRole('radio', { name: 'このテロップだけ' })).toBeChecked()
    expect(within(scope).getByRole('radio', { name: '歌詞のテロップすべて（2）' })).toBeTruthy()
    expect(within(scope).getByRole('radio', { name: 'テロップすべて（3）' })).toBeTruthy()
  })

  it('歌詞のテロップすべてで欄を変えると、歌詞のテロップに項目だけをまとめて送り、件数と「戻せます」を知らせる', async () => {
    fake.applyTextStyle.mockImplementation(() => Promise.resolve(lyricClips()))
    const value = await openLyric()

    await userEvent.click(screen.getByRole('radio', { name: '歌詞のテロップすべて（2）' }))
    await userEvent.selectOptions(screen.getByLabelText('書体'), 'mincho')

    await waitFor(() => {
      expect(fake.applyTextStyle).toHaveBeenCalledWith(aProject.id, {
        clipIds: [LYRIC_A, LYRIC_B],
        set: { font: 'mincho' },
        unset: [],
      })
    })
    expect(fake.updateClip).not.toHaveBeenCalled()
    expect(value.notify).toHaveBeenCalledWith('テロップ 2 件の書体を変えました（変更の履歴から戻せます）')
  })

  it('範囲が「このテロップだけ」以外なら、範囲の行を目立たせる', async () => {
    await openLyric()
    const scope = screen.getByRole('radiogroup', { name: '変える範囲' })
    expect(scope.className).not.toContain('bg-warn')

    await userEvent.click(screen.getByRole('radio', { name: 'テロップすべて（3）' }))

    expect(scope.className).toContain('bg-warn')
  })

  it('「型の既定に戻す」も範囲の全部に当てる（見た目の項目を全部外す）', async () => {
    fake.applyTextStyle.mockImplementation(() => Promise.resolve(lyricClips()))
    await openLyric()

    await userEvent.click(screen.getByRole('radio', { name: 'テロップすべて（3）' }))
    await userEvent.click(screen.getByRole('button', { name: '型の既定に戻す' }))

    await waitFor(() => {
      expect(fake.applyTextStyle).toHaveBeenCalledWith(
        aProject.id,
        expect.objectContaining({ clipIds: [LYRIC_A, LYRIC_B, MANUAL], set: {} }),
      )
    })
    const body = fake.applyTextStyle.mock.calls.at(-1)?.[1] as { unset: string[] }
    expect(body.unset).toContain('size')
    expect(body.unset).toContain('anchor')
  })

  it('別のテロップを開いても、選んだ範囲は残る（歌詞のテロップを続けて直せる）', async () => {
    fake.listClips.mockResolvedValue(lyricClips())
    const tree = (id: TimelineClipId) => (
      <PreferencesRoot>
        <WorkbenchContext.Provider value={workbenchValue({ inspected: { kind: 'text-clip', id } })}>
          <WorkbenchTransportProvider transport={STOPPED}>
            <ContextMenuHost>
              <InspectorPanel />
            </ContextMenuHost>
          </WorkbenchTransportProvider>
        </WorkbenchContext.Provider>
      </PreferencesRoot>
    )
    const { rerender } = render(tree(LYRIC_A))
    await screen.findByText('ぼくは')
    await userEvent.click(screen.getByRole('radio', { name: '歌詞のテロップすべて（2）' }))

    rerender(tree(LYRIC_B))
    await screen.findByText('はると')

    expect(screen.getByRole('radio', { name: '歌詞のテロップすべて（2）' })).toBeChecked()
  })

  it('歌詞のテロップが無ければ、その選択肢は出さない', async () => {
    await open()

    expect(screen.queryByRole('radio', { name: /歌詞のテロップすべて/ })).toBeNull()
    expect(screen.getByRole('radio', { name: 'テロップすべて（2）' })).toBeTruthy()
  })
})
