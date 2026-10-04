import type { MusicTrack } from '@ixa/domain'
import { waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MusicGate } from '@/components/workbench/panels/music-gate'
import { POLL_INTERVAL_MS } from '@/lib/poller'
import { aProject, renderInWorkbench } from './workbench-fixture'

/**
 * 楽曲の解析が終わったら、作品の方針を開く（制作者 2026-10-03「進捗ダイアログが出て波形が出るところまでは問題なし。
 * ここでまず次何したらいいんだ？ってなるので、作品の方針・歌詞を入力するインスペクターをアクティブにしたほうがよさそう」）。
 * 方針がもう済んでいれば動かさない（作業中に勝手に画面を替えない）。
 */

vi.mock('@/lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api-client')>()
  return {
    ...original,
    createApiClient: () => ({
      requestAnalysis: () => Promise.resolve({ accepted: true }),
      getAnalysis: () => Promise.resolve({ bpm: 120 }),
      getAnalysisFailure: () => Promise.resolve(null),
    }),
  }
})
const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const track = { id: 'track-1', title: 'iXA CUP' } as unknown as MusicTrack

describe('MusicGate: 解析が終わったら', () => {
  it('作品の方針がまだなら、インスペクターで作品の方針を開き、次にやることを知らせる', async () => {
    const { value } = renderInWorkbench(<MusicGate>{() => null}</MusicGate>, {
      track,
      analysis: null,
      concept: '',
      project: { ...aProject, lyrics: '', styleGuide: '' },
    })

    await waitFor(
      () => {
        expect(value.inspect).toHaveBeenCalledWith({ kind: 'project', id: value.projectId })
      },
      { timeout: POLL_INTERVAL_MS * 3 },
    )
    expect(value.focusPanel).toHaveBeenCalledWith('inspector')
    expect(value.notify).toHaveBeenCalledWith(expect.stringContaining('作品の方針'))
  })

  it('作品の方針が済んでいれば、画面を替えない', async () => {
    const { value } = renderInWorkbench(<MusicGate>{() => null}</MusicGate>, {
      track,
      analysis: null,
      concept: '夜明け',
      project: { ...aProject, lyrics: '一行目', styleGuide: '水彩' },
    })

    // 解析が終わった（画面を読み直させた）ことを確かめてから見る。
    await waitFor(
      () => {
        expect(refresh).toHaveBeenCalled()
      },
      { timeout: POLL_INTERVAL_MS * 2 },
    )
    expect(value.inspect).not.toHaveBeenCalled()
  }, POLL_INTERVAL_MS * 3)
})
