import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CutterPanel } from '@/components/workbench/panels/cutter-panel'
import { renderInWorkbench } from './workbench-fixture'

/**
 * 曲の無い作品を、ナレーションの切れ目で区切って Shot にする（ADR-0038）。曲が無いと波形の上で区切れないので、
 * 置いた行の話し始めを区切りにする。
 */

vi.mock('@/components/image-uploader', () => ({ ImageUploader: () => null }))
vi.mock('@/components/media-image', () => ({ MediaImage: () => null }))

const line = (startSec: number, durationSec: number) => ({
  id: `01J9ZK3V8Q4W6N2T5R7Y1X3C${String(Math.round(startSec * 10)).padStart(2, '0')}`,
  projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  order: 0,
  text: '行',
  reading: '行',
  readingIsManual: false,
  voiceProfileId: null,
  direction: '',
  startSec,
  telop: true,
  selectedTakeId: null,
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
  estimatedSec: durationSec,
  durationSec,
  stale: false,
  takes: [],
  job: null,
})

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, data }), { status, headers: { 'content-type': 'application/json' } })

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/storyboard/cuts') && init?.method === 'POST') {
      return Promise.resolve(json({ shots: [], createdCount: 2, warnings: [] }, 201))
    }
    return Promise.resolve(json({ lines: [line(0.2, 2), line(2.5, 2)], totalEstimatedSec: 4, endSec: 4.5 }))
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('曲が無くて、置いたナレーションがあるとき', () => {
  it('行の切れ目で区切って Shot にする（先頭・話し始め・最後の行の終わり）', async () => {
    const { value } = renderInWorkbench(<CutterPanel visible />, { musicLoaded: true, track: null })

    await userEvent.click(await screen.findByRole('button', { name: 'ナレーションの切れ目で 2 カットを Shot にする' }))

    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(typeof call?.[1]?.body === 'string' ? call[1].body : '{}')).toEqual({ boundariesSec: [0, 2.5, 4.5], sequenceId: null })
    expect(await screen.findByText('2 個の Shot を作りました。')).toBeInTheDocument()
    expect(value.refresh).toHaveBeenCalled()
  })
})
